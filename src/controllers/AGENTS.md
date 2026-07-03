This file contains information about the controllers in the Ambire wallet's business logic. Controllers are stateful classes that manage specific domains of the wallet's functionality, such as accounts, networks, transactions, etc. They extend from a common `EventEmitter` base class that allows them to propagate updates to the UI and other parts of the application.

## MainController
The **MainController** is the central orchestrator. It constructs every sub-controller in its constructor, wires their dependencies, and exposes the top-level public API that consumers invoke.

- MainController reads from sub-controllers directly via the public references it holds (e.g. `this.accounts.accounts`, `this.selectedAccount.account`).
- MainController updates sub-controllers either by **calling their public methods directly** (e.g. `this.keystore.lock()`) or by **passing callbacks into their constructors** (e.g. `portfolioUpdate`, `onBroadcastSuccess`, `onAddOrUpdateNetworks`). Use callbacks when the sub-controller needs to trigger a side-effect that spans multiple other controllers.

## Reading from other controllers
1. Pass the required controller (or interface) into the constructor.
2. Store it in a **private field** (`#controllerName`).
3. Read from it inside your methods.

```ts
export class MyController extends EventEmitter {
  #accounts: IAccountsController

  constructor(accounts: IAccountsController) {
    super()
    this.#accounts = accounts
  }

  doWork() {
    const acc = this.#accounts.accounts[0]
  }
}
```

## Updating other controllers
There are two patterns:

1. **Direct method call** – use when the caller already knows the target and the logic is simple:
   ```ts
   this.keystore.lock()
   ```

2. **Callback injected via constructor** – use when the sub-controller needs to call a main method or when calling methods of multiple controllers that are not otherwise present in the sub-controller:
   ```ts
   // In MainController
   new SwapAndBridgeController({
     portfolioUpdate: (chainIds) => {
       this.updateSelectedAccountPortfolio({ networks })
     },
     onBroadcastSuccess: this.commonHandlerForBroadcastSuccess.bind(this)
   })
   ```

## `withStatus`
`withStatus` is defined on the `EventEmitter` base class. It wraps an async method so the UI can track its lifecycle.

### How to use it
1. Declare a `STATUS_WRAPPED_METHODS` object at the top of the file:
   ```ts
   export const STATUS_WRAPPED_METHODS = {
     addAccounts: 'INITIAL',
     updateNetwork: 'INITIAL'
   } as const
   ```
2. Assign it to the `statuses` property on the controller:
   ```ts
   statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS> = STATUS_WRAPPED_METHODS
   ```
3. Wrap the public method:
   ```ts
   async addAccounts(accounts: Account[]) {
     await this.withStatus('addAccounts', async () => this.#addAccounts(accounts), true)
   }
   ```

### When to use it
- For **UI-facing async operations** that should show a loader and prevent duplicate submissions (e.g. unlocking the keystore, adding a network, selecting an account).
- Pass `allowConcurrentActions = true` when multiple independent actions need to run simultaneously.

### When NOT to use it
- **Never wrap methods that can hang** (e.g. transaction signing, hardware-wallet prompts, or any flow where the controller cannot abort or guarantee completion).
- Do not wrap internal helper methods; wrap the public entry-point only.
- Do not wrap background-interval handlers or fire-and-forget side effects.

## initialLoadPromise
Most controllers have `initialLoadPromise` that resolves when the controller finishes its initial loading (e.g., fetching data, initializing state, reading from storage). 

### When to use it
- In the `initialLoadPromise` of another controller that depends on the state of the first controller. 
- In methods a controller that depends on the `initialLoadPromise` of that controller.

### Example:
The networks controller that reads the network list from storage (which is async) exposes an `initialLoadPromise` that resolves when the networks are loaded. Then, the providers controller awaits the networks controller's `initialLoadPromise` in its own `initialLoadPromise` before initializing the providers, ensuring it has the network data available. The networks controller also awaits its own `initialLoadPromise` in its methods that read the network list, to ensure the data is loaded before accessing it.

## Other rules:
- Never use raw `setInterval`. Always use `RecurringTimeout` from `@common/utils/RecurringTimeout`.
- Long-running background intervals must be declared in `ContinuousUpdatesController`, which orchestrates their lifecycle based on app state and controller events. If you need a new background loop, add it there and wire its start/stop/restart logic through the existing event subscriptions.
- Never call `this.storage.set()` in parallel. Always await the previous call before making another one.
- Always use `this.emitError` for error handling in controllers; all emitted errors are reported to Sentry and logged, and non-silent errors are also displayed as toasts in the UI. Public methods must never let errors propagate — use `EmittableError` (thrown inside a `withStatus` wrapper, which auto-emits it) or `try/catch` + `emitError({ level, message, error })` otherwise.
- Public state is serialized and sent to the UI on every update, so it should be minimal and only include what's necessary for the UI. Do not store large data or sensitive data in public state. Use private fields for that and expose only derived non-sensitive data in public state if needed.
- NEVER write expensive calculations inside getters.
- NEVER emit updates in getters. Getters should be pure and side-effect free.
- Getter values are not automatically propagated to the UI. To update a getter value, you need to call `this.emitUpdate()`. Be VERY careful with this - you should NEVER write a getter that depends on data from another controller without subscribing to that controller's updates and calling `this.propagateUpdate(...)` in the subscription callback, otherwise the UI will not update when the underlying data changes.
- If a controller depends on the state of the UI (e.g., which screen it is on), it should subscribe to `this.ui.uiEvent.on`
- When retrying failed background fetches, use a retry counter with a maximum number of attempts (reset on success) and an increasing delay. For periodic polling with retry, use `RecurringTimeout` with adaptive intervals (shorter on failure, longer on success). See `PortfolioController.updateExchangeList()`, `DappsController.#retryFetchAndUpdateInterval`, and `ContractNamesController`'s `retryAfter` timestamps for examples.
- ALWAYS guard async operations that update state with appropriate stale-data checks, such as debounce, unique ID/version checks, or cancellation with `AbortController`, to prevent state corruption from out-of-order or concurrent operations. Examples of these patterns can be found in `SwapAndBridgeController` and `AccountPickerController`.
- ALWAYS Write to storage AFTER updating the in-memory state and emitting updates so the UI updates asap, NEVER before.

## Controller list
ALWAYS update this list when creating a new controller, and provide a one-sentence description of its responsibilities. 

- **MainController** – Orchestrates all controllers, wires their dependencies, and handles top-level actions.
- **EventEmitterRegistryController** – Maintains a registry of active controllers for external state synchronization.
- **EventEmitter** – Base class that all controllers extend; handles state propagation and error emission.
- **ActivityController** – Tracks submitted transactions, monitors their status, and updates portfolio when they finalize.
- **AddressBookController** – Manages user contacts, combining manually added entries with wallet accounts.
- **AccountPickerController** – Handles importing and deriving accounts from seeds, hardware wallets, and external keys.
- **AccountsController** – Stores and manages wallet accounts, their preferences, and on-chain account state.
- **AutoLoginController** – Manages SIWE auto-login policies and signatures for dApp sessions.
- **BannerController** – Aggregates in-app notification banners based on account and app state.
- **ContinuousUpdatesController** – Orchestrates periodic background updates for multiple controllers (e.g., portfolio and activity)
- **ContractNamesController** – Resolves human-readable names for smart-contract addresses via the relayer.
- **DappsController** – Manages dApp connections, sessions, verification status, and the dApp catalog.
- **DebugController** – Toggles per-controller debug logging at runtime (developer tool); persists toggles and hydrates the `debugLogger` module.
- **DomainsController** – Resolves and caches ENS, Namoshi and GNS names (and avatars) for addresses.
- **EmailVaultController** – Handles email-based recovery, magic-link flows, and vault secret management.
- **FeatureFlagsController** – Toggles application features at runtime for roll-outs and A/B testing.
- **EstimationController** – Estimates gas, fees, and payment options for smart-account transactions.
- **GasPriceController** – Fetches and formats gas-price recommendations and bundler gas speeds.
- **InviteController** – Manages invite codes and OG status (legacy; now used for status tracking only).
- **KeystoreController** – Encrypts seeds and private keys under a multi-secret–wrapped main key, manages unlock state, and routes signing to internal or hardware-backed keys.
- **NetworksController** – Manages blockchain networks and their configuration
- **ProvidersController** – Initializes and manages JSON-RPC providers for each configured network.
- **PhishingController** – Maintains and updates a list of phishing domains and addresses to protect users.
- **PortfolioController** – Fetches and caches token balances, DeFi positions, and price data per account.
- **RequestsController** – Handles all requests (e.g., signing, connecting to an app, etc.), which come from the app UI and dApps.
- **SafeController** – Integrates with Safe (Gnosis Safe) multisig wallets for transaction and message fetching.
- **SelectedAccountController** – Tracks the currently selected account and derives its data (e.g., portfolio and auto login policies)
- **SignAccountOpController** – Prepares and signs transactions (accountOps); uses `EstimationController` and `GasPriceController` internally
- **SignMessageController** – Used to sign offchain messages (e.g., personal_sign, EIP-712) and SIWE messages;
- **StorageController** – Persists and migrates application state across versions.
- **SurveyController** – Fetches and submits in-app survey questions and responses.
- **SwapAndBridgeController** – Manages swap and bridge quotes, routes, and active cross-chain transactions.
- **TransferController** – Builds and validates simple token-transfer transactions.
- **UiController** – Manages UI windows, popups, and view stacks.
- **TransfersScannerController** – Scans blockchain logs for incoming token transfers to user accounts.
- **TransactionManagerController** – Coordinates the transaction flow, delegating to form state and intent controllers
- **TransactionFormState** – Manages the shared transaction form state (amount, tokens, validation)
- **IntentController** – Handles intent-based transaction quotes and cross-chain swap parameters.
