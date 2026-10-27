# Privacy Pools controller

`PrivacyPoolsController` holds one Privacy Pools account per stored recovery phrase. It syncs the account's notes and builds its deposits and withdrawals. The note secrets are derived from the phrase, so most of the state here must not outlive a lock or the account. This file is about how that is kept true across the modules.

## Modules

The controller is the only `EventEmitter`. The work is done by plain classes that it holds in `#` fields:

| Module | Holds |
| --- | --- |
| `protocolRegistry.ts` | The SDK plugins, one per chain and phrase, their keystores, and the chain versions |
| `sync.ts` | The sync queue, the first read of each chain's shared state, account states (notes), and sync epochs |
| `deposits.ts` | Deposit requirements, the next deposit's precommitment, and prepared and broadcast deposits |
| `withdrawal.ts` | The operation, the proved-but-unsent withdrawal, and the preparation queue and its cancellation |
| `ragequit.ts` | Nothing of its own. Lists the deposits still being verified with the account each came from, and builds their public reclaim |
| `sendForm.ts` | The Send form, and which view changes leave it |
| `errors.ts` | The errors the actions throw |

The controller keeps the parts that need the whole picture:

- whether Privacy Pools is available for the selected account;
- the subscriptions to other controllers;
- the account list;
- the steps that span modules (sending a withdrawal clears the form, then syncs);
- `toJSON`.

Modules never get the controller. They get a `PrivacyPoolsContext` (see `context.ts`), and the modules they build on:

```
registry ← sync ← deposits
                ← withdrawal
                ← ragequit
```

They never see which account is selected: the controller resolves it and passes `seedId`. When two modules share state, the controller wires it. For example, the registry's prover reads the withdrawal's proving signal through a callback, for the 'withdraw' circuit only, so a ragequit's proof is never cancelled with a withdrawal.

## Lock and account removal

Every module holding phrase-derived state implements `PhraseScopedModule`:

- **`clear()`** runs on lock (`#teardown`). The controller first bumps `LockGeneration`, then clears the modules in the order of `#phraseScopedModules`. The withdrawal comes first, so a proof is cancelled before its plugin is dropped.
- **`forgetSeed(seedId)`** runs when an account is removed, or its phrase is deleted.
- **`hasPhraseDerivedState()`** decides whether a keystore update while locked must tear down.

Teardown runs only when there is something to drop. `clear()` must therefore empty everything `hasPhraseDerivedState()` counts, or teardown would run on every keystore update.

Some state is kept on purpose, because none of it comes from a phrase, or because dropping it would break something:

| Kept | Why |
| --- | --- |
| The first read of each chain (`sync.ts`), chain versions (`protocolRegistry.ts`) | The chain's shared state, the same for every phrase. It takes minutes to read the first time |
| Prepared and broadcast deposits (`deposits.ts`) | A deposit made before a lock may be sent or land after it. It must still be recognised, and still block another deposit from reusing its precommitment |
| Deposit requirements, prices, the account list, the Send form | Not derived from a phrase |

A new module that holds anything derived from a phrase must implement `PhraseScopedModule` and be added to `#phraseScopedModules`.

## Stale results

A sync or a proof cannot be stopped midway, so each one checks, before it writes, that its result still applies:

- **`LockGeneration`** - a sync captures the generation when it starts. `#writeAccountState` writes nothing after a lock, nor for a removed account.
- **Operation id** - a withdrawal updates the operation only while it is still the current one. A lock, a cancel or a newer withdrawal replaces it. A proved withdrawal is not sent if a lock came while it was checked again.
- **Chain versions** - a sync that persists a chain's history bumps its version. The other phrases' plugins on that chain are rebuilt on next use, so they start from the stored history instead of reading it again.
- **Sync epochs** - the next deposit's precommitment is cached until the account's next sync, which may have seen a deposit land.
- **First chain read** - only the first sync of a chain reads its shared state. The other syncs of that chain wait for it, and a failed read is retried by the next sync.
- **Preparation queue** - a cancelled withdrawal may still be proving. The next one waits for it rather than prove beside it on the same plugin.

## Updates to the UI

Updates are sent from one place, so the same rules hold for every module:

- A module calls `ctx.emitUpdate()` where its own flow changes what the UI shows. Examples: a sync starting or ending, a withdrawal moving to its next phase.
- A method the controller calls from a subscription, or together with other changes, does not emit. Examples: `dropUnsent`, `dismiss`, the Send form's `clear`. At most it returns whether it changed anything, and the controller emits once. Subscription handlers pass updates on with `propagateUpdate(forceEmit)`.
- `toJSON` spreads `...this`. That leaves out the `#` fields, so the modules (plugins, keystores, proofs) never reach the UI. Getters are listed explicitly. The test "state sent to the UI" pins the exact keys.

## Persistence

- **The account list** is stored under `PRIVACY_POOLS_ACCOUNTS_STORAGE_KEY`.
- **The plugins' state** (pool history and notes) is stored by the SDK under `privacyPoolsState`. All plugins share one storage adapter (`kohakuStorage`). Adapters per plugin would overwrite each other's progress.
- **Deposits and withdrawals are not persisted**, as a local log would link a deposit to its withdrawal.

## Ragequit

A deposit still being verified can only be taken back publicly, in full, by the account that made it (the pool checks `msg.sender`). Verified deposits are sent from the Privacy Pools account instead, so they are never offered.

- **Depositors are read locally.** Each note's `depositor` (and its deposit index, which orders them newest first) comes with `notes()` in `sync.ts`, from the pools' history synced in bulk. Never use the SDK's `history()` or the pool's `depositors(label)`: both ask the network about single deposits, which tells it which ones are the user's.
- **No deposit dates.** `INote` has no block, and asking for a deposit's block or its time would single it out. Once Kohaku exposes the block on `INote`, the Rage quit sheet can show when each deposit was made again.
- **The SDK's call is checked** against the deposit (label, amount, and a pool in `PrivacyPoolsChainConfig.pools` holding its token), as the SDK picks the pool and drops a deposit it could not prove for with only a warning.
- **The SDK syncs before proving**, outside the queue, so a ragequit waits for the running sync first, as a withdrawal does. Then the deposit is read again through the queue: if it was verified while being proved, it is refused, as it can now be sent privately instead of going back publicly. A failed read refuses it too.
- **The account is switched by `MainController.privacyPoolsRagequit`**, which selects the depositor (refusing one not in the wallet or view-only) and adds the call as a regular request.
