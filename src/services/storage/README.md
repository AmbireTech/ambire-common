# IndexedDB persistence layer

Persistence for controller data that key-value storage handles badly. One consumer today,
`ActivityController`:

| | `ActivityController` |
|---|---|
| Layout | one row per op |
| Read | bounded window, one page at a time |
| Write | one row per broadcast |
| What it buys | row-level reads and writes on data that grows without bound |

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
| `activityIdb.ts` | Two `IActivityOpsBackend` adapters: `ActivityIdbStorage` (rows) and `ActivityKeyValueStorage` (blob, used on mobile). |
| `persistenceError.ts` | The `onError` contract both coordinators report through instead of throwing. |

## Adapters, and adding a service

A controller declares an adapter contract — `IActivityOpsBackend` — with
one implementation per storage service. A coordinator picks one in `#pickAdapter` and exposes
plain methods, so the controller never branches on which backend it got and holds no IDB logic
of its own.

One capability drives every behavioural difference:

```ts
readonly loadsPartially: boolean
```

`true` for IndexedDB, whose startup read is a window. `false` for key-value, which reads the
whole blob. Paginated reads, cache merging and the cached op total all exist only when it is
`true` — and callers test this flag, never the concrete class.

Adding **expo-sqlite** on mobile therefore means: write an `IActivityOpsBackend` adapter with
`loadsPartially = true`, and select it in `#pickAdapter`. Nothing in `ActivityController`
changes, and nothing else in this layer does either.

## Adding IDB persistence to a controller

1. Add the store to `AMBIRE_IDB_SCHEMA`. `reconcileSchema()` creates it and its indexes — never create them by hand in a handler. Bump `dbVersion` by 1 **only if the current version has shipped**; a store added before release joins the existing version. See the one-way warning below.
2. Add an entry to `migrationHandlers` in `idbDatabase.ts` for the new version. A no-op is fine; handlers exist only to transform existing rows. The entry is mandatory so a version bump is always deliberate — a test enforces it.
3. Declare a backend interface with the data methods the controller actually calls, plus `ensureMigrated(getStoredData, removeStoredData)` typed against the shape currently held in key-value storage. See `IActivityOpsBackend` (`interfaces/activity.ts`) for the pattern. Keep the interface to what is used _polymorphically_: `isEmpty()` and `migrateFromStorage()` are how the IDB implementation decides whether to migrate, so declare them on that class only. Putting them on the shared interface forces the key-value class to carry dead stub methods it never uses.
4. Implement it twice — once on IDB, once on key-value. `ensureMigrated` on the IDB implementation must, in order: return early if the store is not empty; return early if the legacy payload has no meaningful data (a blank payload would make the store non-empty and permanently skip a later real migration); write the payload; only THEN call `removeStoredData`, so a failed removal still leaves the migrated data in place and doesn't lose it. The key-value implementation makes `ensureMigrated` an outright no-op, since its data already lives in its final location.
5. Add a coordinator in `services/storage/` that picks the adapter, runs `ensureMigrated()` as its **first await** (or a later read can observe a store the migration has not filled yet), and reports failures through an injected `onError` instead of throwing. The controller calls its methods and holds no IDB knowledge — see the rule above.
6. **If the IDB backend loads only a subset at startup, audit every in-memory consumer.** This is the easiest way to introduce a silent bug. `ActivityController`'s startup read returns only the 20 most recent finalized ops per chain (plus all pending ones), which quietly weakened address-poisoning detection. Anything that reasons over the _full_ history must not scan the cache — give it a **separate durable index** instead, kept up to date on write and backfilled once from existing data. `sentToHistory.recipients` is the reference: expanding the cache on demand worked but reloaded the whole history into memory on a user-facing path, so it was replaced. Note that such an index outlives the rows it was derived from, which is usually desirable (a recipient evicted from history still raises a lookalike warning) but means "no rows" no longer implies "no index entries".

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
that version. A store added pre-release joins the existing one, which is how `accountsOps` reached
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
   history needs a durable index (see `sentToHistory`) or an explicit backend read — never a
   scan of the cache. This is the easiest way to introduce a silent bug here.
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

Two consequences:

- totals come from the backend, never from group lengths — `countOpsForAccount()`, cached per
  account and adjusted by the delta `putSingleOp()` reports.
- a page load **merges** into the cache by id and keeps the *cached* object on a collision.
  The cache can hold ops IDB does not have yet (a just-broadcast op is in memory before
  `putSingleOp` writes it), and objects that in-flight work still mutates in place.
  Replacing the array would drop the former and detach the latter.

## Cost model

| Operation | Cost |
|---|---|
| `loadStartupOps()` | 2 transactions. Key-only cursor enumerates groups, then per-group queries run in parallel. Bounded by group count, not history size. |
| `putSingleOp()` | 1 row write, plus one `count()` when the caller passed no `trimmedId` (the common case on IDB, since groups start at 20 and rarely hit the in-memory cap). |
| `getRecentOps()` | Backwards cursor over `by-account-chain-timestamp`, one step per row, stopping at `limit`. Run once per rendered chain per pagination call. IDB indexes only sort ascending, so newest-first needs a reverse walk. |
| `getOpsForAccountAndChain()` | Full group read. Called by `addExternalAccountOp`'s duplicate guard, which has to compare against the whole group rather than the loaded window. Deliberately not a txnId index: an internal op can carry a txnId per call (MultipleTxns), which a row-level index on `op.txnId` cannot see. |
| `countOpsForAccount()` | `count()` over a key range — served from the index without deserializing rows. |
| `hasAccountOpsSentTo()` | No backend read at all. Answers from `sentToHistory.recipients` — an O(1) key lookup, plus an O(recipients) comparison only for a first-time address. |

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

**A storage migration is what makes the map authoritative.** `recordRecipient()` only writes on
broadcast, so a user with pre-existing history would start with it empty — every known
recipient flagged as first-time and poisoning warnings silently gone.
`#indexSentToHistoryFromAccountsOps()` in `StorageController` seeds it from existing history,
guarded by `passedMigrations` like every other migration there.

It lives there rather than in `ActivityController` for a reason beyond consistency: storage
migrations complete before any controller reads, which is also the last moment `accountsOps`
still holds the full history in key-value storage — `ActivityController` moves it into IDB
during its own load. Both it and the controller call the same `recordRecipient()` from
`libs/activity/sentToHistory.ts`, so the domain-recency rule has one implementation.

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
| `activityIdbMigration.test.ts` | `ActivityController` wiring: migration, startup read, paginated reads, op counts, the recipient backfill |
| `idbDatabase.test.ts` | Singleton, schema reconciliation, handler-chain consistency |
| `activity.test.ts` | Pre-existing suite built without an `idb`, so it runs the key-value path — the **mobile regression guard**. They should keep passing untouched. |
