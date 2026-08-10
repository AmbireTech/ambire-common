# IndexedDB persistence layer

Row-level persistence for controller data that grows without bound. `ActivityController`
(transaction history) is the only consumer today.

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
| `activityIdb.ts` | The two interchangeable `ActivityController` backends: `ActivityIdbStorage` (rows) and `ActivityKeyValueStorage` (blob, used on mobile). |
| `phishingIdb.ts` | A second reference implementation. Fully tested, **not wired** — its store is deliberately absent from the manifest. |

## Startup order

The ordering here is load-bearing, not incidental.

```
background.ts
  └─ await openAmbireIdb()          ← schema migrations complete inside this await
       ├─ reconcileSchema()         creates any missing store/index, idempotent
       └─ applyMigrations()         transforms existing rows, per version
  └─ new MainController({ idb })    nothing can read before the await resolves
       └─ new ActivityController
            └─ #load()
                 ├─ ensureMigrated()        data migration: blob → rows, once
                 ├─ loadStartupOps()        the bounded read
                 └─ emitUpdate()            UI renders
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

## Invariants

Breaking any of these is a silent data bug, not a crash.

1. **Migration handlers are synchronous.** IDB keeps a versionchange transaction alive
   across microtasks, so chaining off a read (`store.getAll().then(...)`) stays inside the
   upgrade. `await`ing anything non-IDB lets the transaction commit and the writes vanish
   with no error. Verified against 14,000 rows in Chrome and Firefox.
2. **Every version `1..dbVersion` needs a handler entry**, even a no-op. A test enforces it,
   so a version bump is always deliberate.
3. **Never remove a handler.** The chain must stay walkable from any prior version.
4. **A `dbVersion` bump cannot be rolled back.** An older build cannot open an upgraded
   database — `openDB` rejects with `VersionError` and every controller falls back to
   key-value. Ship bumps alone, and only when something reads the new structure.
5. **Bulk writes are atomic and tolerate malformed rows.** A legacy blob can be missing
   fields; those rows are dropped with a warning. A partial commit would make `isEmpty()`
   false and permanently disable the migration retry.
6. **The startup read is a window, not the history.** Anything reasoning over the *whole*
   history must expand first. This is the easiest way to introduce a silent bug here — see
   the cost table below.

## The startup window, and who has to care

`loadStartupOps()` returns, per (account, chain): **all pending ops** plus the **20 most
recent finalized** ones. So in-memory group lengths are *not* totals.

Two mechanisms exist because of that:

- `#fullyLoadedGroups` — a per-`(account, chain)` flag marking groups expanded to full
  history this session. It must be an explicit flag: pending ops are exempt from the cap, so
  a group can exceed 20 without having been expanded, and a length check would be wrong.
- `#mergeOpsIntoCache()` — expansion **merges** by id and keeps the *cached* object on a
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
| `hasAccountOpsSentTo()` (first-time recipient) | **Expensive.** Expands the account's *entire* history into memory and scans every op. See below. |

### The one path that defeats the bounded read

`hasAccountOpsSentTo()` answers two questions — "have I sent here before?" and "does this
recipient mimic one I used before?" (address poisoning). Both are properties of the *whole*
history, so on a miss it calls `#ensureFullHistoryLoaded()` and scans everything. With an
empty `accountId` it does this for **every** account.

There is a fast path: `sentToHistory.recipients[accountId][address]`, a small durable map of
recipient → last-sent timestamp. When it hits, nothing is loaded.

But that map is only populated by `addAccountOp`, so it covers sends made *since the feature
shipped*. **There is no backfill from existing history.** For a user with pre-existing
history the map starts empty, so the expensive path runs on sends to recipients they have
used before — not only genuinely new ones. Once expanded, the memory stays inflated for the
session.

Backfilling `recipients` from full history once (at data-migration time) would let both
questions be answered from the small map and remove `#ensureFullHistoryLoaded()` from this
path. It is the highest-value optimization left in this layer, and is deliberately *not* part
of the initial IDB change: it alters security-relevant address-poisoning behaviour and
deserves its own review.

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
timing that invariant 1 is about — that was verified manually in both browsers.

| Suite | Covers |
|---|---|
| `activityIdb.test.ts` | Storage primitives, atomicity, malformed rows, reconnect |
| `idbIntegration.test.ts` | End-to-end wiring via a self-contained `DummyController` — the canonical template |
| `activityIdbMigration.test.ts` | Controller `#load()`: migration, startup read, expansion, counts |
| `idbDatabase.test.ts` | Singleton, schema reconciliation, handler-chain consistency |
| `phishingIdb.test.ts` | The unwired reference backend |
