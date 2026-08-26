# IndexedDB persistence layer

Persistence for controller data that key-value storage handles badly. Two consumers:
`ActivityController` (transaction history, row-per-op) and `PhishingController` (one snapshot
document).

This file covers the **runtime picture**: what each module does, the order things happen in,
the invariants, and what each operation costs. For the step-by-step recipe to put a *new*
controller on IDB, see the "IndexedDB persistence" section of `src/controllers/AGENTS.md`.

## Why it exists

`accountsOps` used to live in one key-value blob. Every new transaction re-serialized the
entire history, and every service-worker wake-up read all of it back. For a heavy account
that is tens of MB per write. IDB replaces that with row-level writes and a **bounded**
startup read.

## Modules

| File | Responsibility |
|---|---|
| `idbSchema.ts` | Declarative manifest: stores, keyPaths, indexes, `dbVersion`. The single source of truth for *structure*. Read by `reconcileSchema()`; contains no logic. |
| `idbDatabase.ts` | Connection lifecycle (`openAmbireIdb()` singleton, `blocking`, `terminated`, invalidation) and upgrade orchestration (`reconcileSchema()`, `applyMigrations()`). |
| `accountOpsPersistence.ts` | **The coordinator `ActivityController` talks to.** Picks an adapter, runs the data migration, falls back on failure, and keeps the in-memory cache coherent with a partially-loaded backend. |
| `phishingPersistence.ts` | The coordinator `PhishingController` talks to. Simpler shape — no cache to keep coherent — and the better template to copy. |
| `activityIdb.ts` | Two `IActivityOpsBackend` adapters: `ActivityIdbStorage` (rows) and `ActivityKeyValueStorage` (blob, used on mobile). |
| `phishingIdb.ts` | The two `IPhishingOpsBackend` adapters. |
| `persistenceError.ts` | The `onError` contract both coordinators report through instead of throwing. |

## Adapters, and adding a service

Each controller has an adapter contract — `IActivityOpsBackend`, `IPhishingOpsBackend` — with
one implementation per storage service. A coordinator picks one in `#pickAdapter` and exposes
plain methods, so the controller never branches on which backend it got and holds no IDB logic
of its own.

One capability drives every behavioural difference:

```ts
readonly loadsPartially: boolean
```

`true` for IndexedDB, whose startup read is a window. `false` for key-value, which reads the
whole blob. Expansion markers, cache merging and the cached op total all exist only when it is
`true` — and callers test this flag, never the concrete class.

Adding **expo-sqlite** on mobile therefore means: write an `IActivityOpsBackend` adapter with
`loadsPartially = true`, and select it in `#pickAdapter`. Nothing in `ActivityController`
changes, and nothing else in this layer does either.

## Startup order

The ordering here is load-bearing, not incidental.

```
background.ts
  └─ await openAmbireIdb()          ← schema migrations complete inside this await
       ├─ reconcileSchema()         creates any missing store/index, idempotent
       └─ applyMigrations()         transforms existing rows, per version
  └─ new MainController({ idb })    nothing can read before the await resolves
       └─ new ActivityController
            └─ new AccountOpsPersistence   picks the adapter from `idb`
            └─ #load()
                 ├─ persistence.init()     data migration, then the bounded read
                 ├─ emitUpdate()           UI renders
                 └─ persistence.finalizeInit()   bookkeeping nothing renders
```

`openAmbireIdb()` is awaited **before** any controller is constructed. That is the whole
guarantee that no controller can observe a half-migrated schema. If it throws, `idb` is
`undefined` and every controller silently uses its key-value backend.

## Two different things called "migration"

Keeping these apart avoids most of the confusion in this layer.

|  | Schema migration | Data migration |
|---|---|---|
| Moves | Stores and indexes *inside* IDB | A controller's payload *into* IDB |
| Declared in | `idbSchema.ts` | the backend's `ensureMigrated()` |
| Runs during | `onupgradeneeded` | controller `#load()` |
| Frequency | once per `dbVersion` bump | once, ever |

## Structure is declarative

`AMBIRE_IDB_SCHEMA` is the single source of truth for stores and indexes. `reconcileSchema()`
creates anything in the manifest that does not exist yet, so a purely additive change needs a
manifest entry and nothing else hand-written — never a create-store handler.

It needs a `dbVersion` bump **only if the current version has shipped**: `reconcileSchema()`
runs during `onupgradeneeded`, so an unbumped version never reaches installs that already have
that version. A store added pre-release joins the existing one, which is how `phishing` reached
v1 without a bump.

It runs on **every** upgrade and is idempotent, which closes two gaps a per-version handler
leaves open:

- a fresh install and an upgrading install end up on identical structure
- a new index reaches users who already have the store, not just fresh installs

It only ever **adds**. Removing a store or index from the manifest does not remove it from
databases that already have it — that needs an explicit `deleteObjectStore`/`deleteIndex` in
the handler for the version that drops it.

## Writing a migration handler

Handlers live in `migrationHandlers` in `idbDatabase.ts`, keyed by the version they migrate
**to**. Upgrading v(n) → v(m) runs n+1..m in order, inside the single `onupgradeneeded`
transaction. They exist for **data** transformations — rewriting or backfilling rows.
Structure comes from `reconcileSchema()`, which runs first, so a handler can use stores and
indexes added by the same upgrade.

1. **Use `tx` for everything.** Only the versionchange transaction is valid inside a handler;
   opening a new one will not participate in the upgrade.
2. **Handlers are synchronous.** Chain off the read, never `await` it:
   ```ts
   store.getAll().then((rows) => rows.forEach((r) => store.put(migrate(r))))
   ```
   The versionchange transaction survives microtasks, so requests issued from a `.then()`
   still land inside the upgrade. Awaiting a non-IDB promise lets it commit and the writes
   vanish silently. **This is the single most dangerous rule in this layer** — no unit test
   catches it, because `fake-indexeddb` does not reproduce the commit timing.
3. **Never remove a handler.** The chain must stay walkable from any prior version.
4. **Every version `1..dbVersion` needs an entry**, even a no-op, so a bump is always
   deliberate. A test in `idbIntegration.test.ts` enforces this.
5. **A key already migrated into IDB is unreachable from a `StorageController` migration.**
   Transform it with a handler here instead — the legacy blob is a frozen copy nothing reads.

## Invariants

Breaking any of these is a silent data bug, not a crash. These are the ones that bite outside
a migration — for the ones inside one, see the handler rules above.

1. **A `dbVersion` bump cannot be rolled back.** An older build cannot open an upgraded
   database — `openDB` rejects with `VersionError` and every controller falls back to
   key-value. Ship bumps alone, and only when something reads the new structure.
2. **Bulk writes are atomic and tolerate malformed rows.** A legacy blob can be missing
   fields; those rows are dropped with a warning. A partial commit would make `isEmpty()`
   false and permanently disable the migration retry.
3. **The startup read is a window, not the history.** Anything reasoning over the *whole*
   history must expand first. This is the easiest way to introduce a silent bug here — see
   the cost table below.
4. **Account addresses are case-sensitive keys.** Rows are keyed on the address exactly as
   written, and an `IDBKeyRange` cannot match case-insensitively — unlike the in-memory
   `getAccountOpsAccountKey()` helper, which exists precisely because addresses are not
   always stored checksummed. A lookup with different casing than the stored row silently
   returns nothing. The same applies to `sentToHistory.recipients`, which is keyed by account
   address and read with a direct property lookup. Pre-existing rather than introduced here;
   noted so nobody assumes the in-memory workaround extends to either.

## The startup window, and who has to care

`loadStartupOps()` returns, per (account, chain): **all pending ops** plus the **20 most
recent finalized** ones. So in-memory group lengths are *not* totals.

Two mechanisms exist because of that:

- expansion markers — a per-`(account, chain)` flag marking groups expanded to full history
  this session. It must be an explicit flag: pending ops are exempt from the cap, so
  a group can exceed 20 without having been expanded, and a length check would be wrong.
- the cache merge — expansion **merges** by id and keeps the *cached* object on a
  collision. The cache can hold ops IDB does not have yet (a just-broadcast op is in memory
  before `putSingleOp` writes it), and objects that in-flight work still mutates in place.
  Replacing the array would drop the former and detach the latter.

## Cost model

| Operation | Cost |
|---|---|
| `loadStartupOps()` | 2 transactions. Key-only cursor enumerates groups, then per-group queries run in parallel. Bounded by group count, not history size. |
| `putSingleOp()` | 1 row write, plus one `count()` when the caller passed no `trimmedId` (the common case on IDB, since groups start at 20 and rarely hit the in-memory cap). |
| `getOpsForAccountAndChain()` | Full group read. Triggered by pagination past the window, once per group per session. |
| `countOpsForAccount()` | `count()` over a key range — served from the index without deserializing rows. |
| `hasAccountOpsSentTo()` | No backend read at all. Answers from `sentToHistory.recipients` — an O(1) key lookup, plus an O(recipients) comparison only for a first-time address. |
| `getAllOps()` | Whole-store read. Called **once ever**, by the recipient backfill; never on a user-facing path. |

### The recipient index

`hasAccountOpsSentTo()` answers two questions — "have I sent here before?" and "does this
recipient mimic one I used before?" (address poisoning). Both are properties of the *whole*
history, so this used to load every op of every account into memory and scan them, which
defeated the point of the bounded startup read and left memory inflated for the session.

Both are now answered from `sentToHistory.recipients`: a small durable map of
`account => recipient => last-sent timestamp`, written by `#recordRecipient` on every
broadcast. It holds exactly the same information — the same `getAccountOpRecipients()` call
produces it — and is **strictly more complete**, because entries survive the
`MAX_OPS_PER_GROUP` eviction that drops old ops. A recipient you used 2,000 transactions ago
still raises a lookalike warning; under the old scan it had aged out.

**The backfill is what makes the map authoritative.** `#recordRecipient` only writes on
broadcast, so a user with pre-existing history would start with it empty — every known
recipient flagged as first-time and poisoning warnings silently gone. `#backfillSentToHistory()`
therefore reads the whole history once, guarded by a persisted `sentToHistoryBackfilled` flag
and run after the first `emitUpdate` so it never delays rendering. On a failed read the flag
stays **unset** so the next startup retries — recording it would strand the map
half-populated forever.

Because the map is durable and independent of op retention, clearing `accountsOps` does *not*
clear recipient memory. Anything that assumes "no history implies no recipients" — a test, a
reset flow — has to clear `sentToHistory` explicitly.

## Connection can die mid-session

The handle captured at construction is not permanently valid.

- `blocking()` — another context wants to upgrade. We close and drop the cached promise.
- `terminated()` — the browser killed the connection. We drop the cached promise.
- `#openTx()` — catches `InvalidStateError` on a dead handle, invalidates the singleton, and
  reopens once. Without this, every write after such a close would be lost while the
  controller still believed IDB was available.

The database itself survives all three, so a reopen recovers fully.

## Testing

`fake-indexeddb` backs the unit tests. It does **not** reproduce the versionchange commit
timing that handler rule 2 is about — that was verified manually in Chrome and Firefox.

| Suite | Covers |
|---|---|
| `activityIdb.test.ts` | Storage primitives, atomicity, malformed rows, reconnect |
| `idbIntegration.test.ts` | The infrastructure itself: `reconcileSchema`, the handler chain, manifest drift guards |
| `activityIdbMigration.test.ts` | `ActivityController` wiring: migration, startup read, expansion, op counts, the recipient backfill |
| `idbDatabase.test.ts` | Singleton, schema reconciliation, handler-chain consistency |
| `phishingIdb.test.ts` | Both phishing backends, against the real database |
| `phishingIdbMigration.test.ts` | `PhishingController` wiring: manifest entry, migration, restart, key-value path |
| `activity.test.ts`, `phishing.test.ts` | Pre-existing suites built without an `idb`, so they run the key-value path — the **mobile regression guard**. They should keep passing untouched. |
