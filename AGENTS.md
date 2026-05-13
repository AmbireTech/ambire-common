You are an AI Agent working in the core business-logic repository for the Ambire wallet. This code is used by multiple environments (mobile, extension, standalone websites) and is a critical part of the wallet's security and functionality. Changes to this code can have wide-reaching implications across all platforms, so extreme caution is required when making updates.

## Tech stack
typescript, ethers, viem, jest, hardhat

## Project overview
- `src/controllers/` contains stateful classes that extend `EventEmitter`; they propagate updates via `this.emitUpdate()`
- `src/libs/` contains pure business logic without side effects
- `src/contracts/` contains Solidity contracts used by the wallet and relayer; compiled artifacts live in `contracts/compiled/`
- `src/services/` contains external service integrations (bundlers, RPC, ENS, etc.)

## Rules

### Repository specific:
- Use `npm` for package management
- All code must be environment-agnostic; do not use platform-specific APIs (e.g. `window`, `document`, `React Native` APIs)
- Always use `this.emitError` for error handling in controllers; All emitted errors are reported to Sentry and logged, and non-silent errors are also displayed as toasts in the UI. Do not throw errors in UI-facing public methods.
- Use `this.withStatus` to wrap methods that perform async operations that are needed by the UI. Use it only if the underlying method cannot hang. Example: Okay for unlocking the keystore, as the status can be used to show a loader and prevent multiple unlock attempts, but not for transaction signing as there isn't enough control for the controller to handle aborts and more statuses
- Public state is serialized and sent to the UI on every update, so it should be minimal and only include what's necessary for the UI. Do not store large data or sensitive data in public state. Use private fields for that and expose only derived non-sensitive data in public state if needed.
- NO new RPC providers should be constructed. ALWAYS use `ProviderController`.
- NEVER write expensive calculations inside getters.
- Getter values are not automatically propagated to the UI. To update a getter value, you need to call `this.emitUpdate()`. Be VERY careful with this - you should NEVER write a getter that depends on data from another controller without subscribing to that controller's updates and calling `this.propagateUpdate(...)` in the subscription callback, otherwise the UI will not update when the underlying data changes.
- Most controllers have `initialLoadPromise` that resolves when the controller finishes its initial loading (e.g., fetching data, initializing state). If you need to ensure that the controller is fully loaded before performing an action, await this promise first. Example: `await this.someController.initialLoadPromise`
- If a controller depends on the state of the UI (e.g., which screen it is on), it should subscribe to `this.ui.uiEvent.on`

### Code quality:
- Always ensure subscriptions, event listeners, timers and other side effects are properly cleaned up
- NEVER delete existing comments when updating a code block; update inaccurate comments instead. Delete a comment only if the logic it describes is completely removed or the new logic is entirely self-explanatory
- NEVER swallow errors; log them and handle appropriately.
- NEVER modify git config or run destructive git operations
- NEVER commit unless explicitly requested by user
- NEVER stage changes unless explicitly requested by user

## Tests:
- ALWAYS write/update existing tests for changes that you make. Propose missing test cases if you find gaps in the existing coverage. 
- ALWAYS write test cases that cover positive, negative, edge cases and security implications of the code you change or add.
- ALWAYS make a quick tool call to another controller/library when writing new code to check how tests are written there and follow the same patterns. NEVER invent new testing patterns before checking existing ones in the codebase.
- NEVER cover up bugs and security issues by writing tests that expect buggy behaviour. If you find a bug, write a test that fails because of it, prefix it with `BUG:`, and report it to the human in your answer.

## Controllers
ALWAYS update this list if a new controller is added. The list should include a one-line description of each controller's responsibility.

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
- **DomainsController** – Resolves and caches ENS and Namoshi names (and avatars) for addresses.
- **EmailVaultController** – Handles email-based recovery, magic-link flows, and vault secret management.
- **FeatureFlagsController** – Toggles application features at runtime for roll-outs and A/B testing.
- **EstimationController** – Estimates gas, fees, and payment options for smart-account transactions.
- **GasPriceController** – Fetches and formats gas-price recommendations and bundler gas speeds.
- **InviteController** – Manages invite codes and OG status (legacy; now used for status tracking only).
- **KeystoreController** – Encrypts, decrypts, and manages private keys, seeds, and key preferences.
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
- **TransactionManagerController** – Coordinates the transaction flow, delegating to form state and intent controllers
- **TransactionFormState** – Manages the shared transaction form state (amount, tokens, validation)
- **IntentController** – Handles intent-based transaction quotes and cross-chain swap parameters.
- **TransfersScannerController** – Scans blockchain logs for incoming token transfers to user accounts.
- **UiController** – Manages UI windows, popups, and view stacks.
