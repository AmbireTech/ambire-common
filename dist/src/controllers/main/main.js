"use strict";
/* eslint-disable @typescript-eslint/brace-style */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MainController = void 0;
const tslib_1 = require("tslib");
const eth_rpc_errors_1 = require("eth-rpc-errors");
const ethers_1 = require("ethers");
const AmbireAccount_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/AmbireAccount.json"));
const AmbireFactory_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/AmbireFactory.json"));
const EmittableError_1 = tslib_1.__importDefault(require("../../classes/EmittableError"));
const SwapAndBridgeError_1 = tslib_1.__importDefault(require("../../classes/SwapAndBridgeError"));
const dappCommunication_1 = require("../../consts/dappCommunication");
const deploy_1 = require("../../consts/deploy");
const derivation_1 = require("../../consts/derivation");
const account_1 = require("../../libs/account/account");
const accountOp_1 = require("../../libs/accountOp/accountOp");
const submittedAccountOp_1 = require("../../libs/accountOp/submittedAccountOp");
const actions_1 = require("../../libs/actions/actions");
const banners_1 = require("../../libs/banners/banners");
const erc7677_1 = require("../../libs/erc7677/erc7677");
const errorHumanizer_1 = require("../../libs/errorHumanizer");
const errors_1 = require("../../libs/errorHumanizer/errors");
const estimate_1 = require("../../libs/estimate/estimate");
const gasPrice_1 = require("../../libs/gasPrice/gasPrice");
const humanizer_1 = require("../../libs/humanizer");
const keyIterator_1 = require("../../libs/keyIterator/keyIterator");
const main_1 = require("../../libs/main/main");
const networks_1 = require("../../libs/networks/networks");
const relayerCall_1 = require("../../libs/relayerCall/relayerCall");
const richJson_1 = require("../../libs/richJson/richJson");
const selectedAccount_1 = require("../../libs/selectedAccount/selectedAccount");
const signMessage_1 = require("../../libs/signMessage/signMessage");
const swapAndBridge_1 = require("../../libs/swapAndBridge/swapAndBridge");
const debugTraceCall_1 = require("../../libs/tracer/debugTraceCall");
const userRequest_1 = require("../../libs/transfer/userRequest");
const userOperation_1 = require("../../libs/userOperation/userOperation");
const getBundler_1 = require("../../services/bundlers/getBundler");
const paymaster_1 = require("../../services/paymaster");
const FailedPaymasters_1 = require("../../services/paymaster/FailedPaymasters");
const api_1 = require("../../services/socket/api");
const accounts_1 = require("../../utils/accounts");
const shortenAddress_1 = tslib_1.__importDefault(require("../../utils/shortenAddress"));
const wait_1 = tslib_1.__importDefault(require("../../utils/wait"));
const accountAdder_1 = require("../accountAdder/accountAdder");
const accounts_2 = require("../accounts/accounts");
const actions_2 = require("../actions/actions");
const activity_1 = require("../activity/activity");
const addressBook_1 = require("../addressBook/addressBook");
const dapps_1 = require("../dapps/dapps");
const defiPositions_1 = require("../defiPositions/defiPositions");
const domains_1 = require("../domains/domains");
const emailVault_1 = require("../emailVault/emailVault");
const eventEmitter_1 = tslib_1.__importDefault(require("../eventEmitter/eventEmitter"));
const invite_1 = require("../invite/invite");
const keystore_1 = require("../keystore/keystore");
const networks_2 = require("../networks/networks");
const portfolio_1 = require("../portfolio/portfolio");
const providers_1 = require("../providers/providers");
/* eslint-disable @typescript-eslint/no-floating-promises */
const selectedAccount_2 = require("../selectedAccount/selectedAccount");
/* eslint-disable no-underscore-dangle */
const signAccountOp_1 = require("../signAccountOp/signAccountOp");
const signMessage_2 = require("../signMessage/signMessage");
const swapAndBridge_2 = require("../swapAndBridge/swapAndBridge");
const STATUS_WRAPPED_METHODS = {
    onAccountAdderSuccess: 'INITIAL',
    signAccountOp: 'INITIAL',
    broadcastSignedAccountOp: 'INITIAL',
    removeAccount: 'INITIAL',
    handleAccountAdderInitLedger: 'INITIAL',
    handleAccountAdderInitLattice: 'INITIAL',
    importSmartAccountFromDefaultSeed: 'INITIAL',
    buildSwapAndBridgeUserRequest: 'INITIAL',
    importSmartAccountFromSavedSeed: 'INITIAL',
    selectAccount: 'INITIAL'
};
class MainController extends eventEmitter_1.default {
    #storage;
    fetch;
    // Holds the initial load promise, so that one can wait until it completes
    #initialLoadPromise;
    callRelayer;
    isReady = false;
    invite;
    keystore;
    /**
     * Hardware wallets (usually) need an additional (external signer) controller,
     * that is app-specific (web, mobile) and is used to interact with the device.
     * (example: LedgerController, TrezorController, LatticeController)
     */
    #externalSignerControllers = {};
    // Subcontrollers
    networks;
    providers;
    accountAdder;
    portfolio;
    defiPositions;
    dapps;
    actions;
    // Public sub-structures
    // @TODO emailVaults
    emailVault;
    signMessage;
    swapAndBridge;
    signAccountOp = null;
    signAccOpInitError = null;
    activity;
    addressBook;
    domains;
    accounts;
    selectedAccount;
    userRequests = [];
    userRequestWaitingAccountSwitch = [];
    // network => GasRecommendation[]
    gasPrices = {};
    // network => BundlerGasPrice
    bundlerGasPrices = {};
    accountOpsToBeConfirmed = {};
    // TODO: Temporary solution to expose the fee payer key during Account Op broadcast.
    feePayerKey = null;
    lastUpdate = new Date();
    isOffline = false;
    statuses = STATUS_WRAPPED_METHODS;
    #windowManager;
    #notificationManager;
    #signAccountOpSigningPromise;
    #signAccountOpBroadcastPromise;
    constructor({ storage, fetch, relayerUrl, velcroUrl, socketApiKey, keystoreSigners, externalSignerControllers, windowManager, notificationManager }) {
        super();
        this.#storage = storage;
        this.fetch = fetch;
        this.#windowManager = windowManager;
        this.#notificationManager = notificationManager;
        this.invite = new invite_1.InviteController({ relayerUrl, fetch, storage: this.#storage });
        this.keystore = new keystore_1.KeystoreController(this.#storage, keystoreSigners, windowManager);
        this.#externalSignerControllers = externalSignerControllers;
        this.networks = new networks_2.NetworksController(this.#storage, this.fetch, async (network) => {
            this.providers.setProvider(network);
            await this.reloadSelectedAccount({ networkId: network.id });
        }, (networkId) => {
            this.providers.removeProvider(networkId);
        });
        this.providers = new providers_1.ProvidersController(this.networks);
        this.accounts = new accounts_2.AccountsController(this.#storage, this.providers, this.networks, async (accounts) => {
            const defaultSelectedAccount = (0, account_1.getDefaultSelectedAccount)(accounts);
            if (defaultSelectedAccount) {
                await this.#selectAccount(defaultSelectedAccount.addr);
            }
        }, this.providers.updateProviderIsWorking.bind(this.providers), this.#updateIsOffline.bind(this));
        this.selectedAccount = new selectedAccount_2.SelectedAccountController({
            storage: this.#storage,
            accounts: this.accounts
        });
        this.portfolio = new portfolio_1.PortfolioController(this.#storage, this.fetch, this.providers, this.networks, this.accounts, relayerUrl, velcroUrl);
        this.defiPositions = new defiPositions_1.DefiPositionsController({
            fetch: this.fetch,
            storage,
            selectedAccount: this.selectedAccount,
            networks: this.networks,
            providers: this.providers
        });
        this.emailVault = new emailVault_1.EmailVaultController(this.#storage, this.fetch, relayerUrl, this.keystore);
        this.accountAdder = new accountAdder_1.AccountAdderController({
            accounts: this.accounts,
            keystore: this.keystore,
            networks: this.networks,
            providers: this.providers,
            relayerUrl,
            fetch: this.fetch
        });
        this.addressBook = new addressBook_1.AddressBookController(this.#storage, this.accounts, this.selectedAccount);
        this.signMessage = new signMessage_2.SignMessageController(this.keystore, this.providers, this.networks, this.accounts, this.#externalSignerControllers);
        const socketAPI = new api_1.SocketAPI({ apiKey: socketApiKey, fetch: this.fetch });
        this.dapps = new dapps_1.DappsController(this.#storage);
        this.actions = new actions_2.ActionsController({
            selectedAccount: this.selectedAccount,
            windowManager,
            notificationManager,
            onActionWindowClose: () => {
                const userRequestsToRejectOnWindowClose = this.userRequests.filter((r) => r.action.kind !== 'calls');
                userRequestsToRejectOnWindowClose.forEach((r) => r.dappPromise?.reject(eth_rpc_errors_1.ethErrors.provider.userRejectedRequest()));
                this.userRequests = this.userRequests.filter((r) => r.action.kind === 'calls');
                this.userRequestWaitingAccountSwitch = [];
                this.emitUpdate();
            }
        });
        this.selectedAccount.initControllers({
            portfolio: this.portfolio,
            defiPositions: this.defiPositions,
            actions: this.actions,
            networks: this.networks,
            providers: this.providers
        });
        this.callRelayer = relayerCall_1.relayerCall.bind({ url: relayerUrl, fetch: this.fetch });
        this.activity = new activity_1.ActivityController(this.#storage, this.fetch, this.callRelayer, this.accounts, this.selectedAccount, this.providers, this.networks, async (network) => {
            await this.setContractsDeployedToTrueIfDeployed(network);
        });
        this.swapAndBridge = new swapAndBridge_2.SwapAndBridgeController({
            selectedAccount: this.selectedAccount,
            networks: this.networks,
            activity: this.activity,
            invite: this.invite,
            socketAPI,
            storage: this.#storage,
            actions: this.actions
        });
        this.domains = new domains_1.DomainsController(this.providers.providers);
        this.#initialLoadPromise = this.#load();
        paymaster_1.paymasterFactory.init(relayerUrl, fetch, (e) => {
            if (!this.signAccountOp)
                return;
            this.emitError(e);
        });
    }
    /**
     * - Updates the selected account's account state, portfolio and defi positions
     * - Calls batchReverseLookup for all accounts
     *
     * It's not a problem to call it many times consecutively as all methods have internal
     * caching mechanisms to prevent unnecessary calls.
     */
    onPopupOpen() {
        const FIVE_MINUTES = 1000 * 60 * 5;
        const selectedAccountAddr = this.selectedAccount.account?.addr;
        this.domains.batchReverseLookup(this.accounts.accounts.map((a) => a.addr));
        if (!this.activity.broadcastedButNotConfirmed.length) {
            // Update defi positions together with the portfolio for simplicity
            this.defiPositions.updatePositions({ maxDataAgeMs: FIVE_MINUTES });
            this.updateSelectedAccountPortfolio(undefined, undefined, FIVE_MINUTES);
        }
        if (selectedAccountAddr && !this.accounts.areAccountStatesLoading)
            this.accounts.updateAccountState(selectedAccountAddr);
    }
    async #load() {
        this.isReady = false;
        // #load is called in the constructor which is synchronous
        // we await (1 ms/next tick) for the constructor to extend the EventEmitter class
        // and then we call it's methods
        await (0, wait_1.default)(1);
        this.emitUpdate();
        await this.networks.initialLoadPromise;
        await this.providers.initialLoadPromise;
        await this.accounts.initialLoadPromise;
        await this.selectedAccount.initialLoadPromise;
        this.defiPositions.updatePositions();
        this.updateSelectedAccountPortfolio();
        this.domains.batchReverseLookup(this.accounts.accounts.map((a) => a.addr));
        /**
         * Listener that gets triggered as a finalization step of adding new
         * accounts via the AccountAdder controller flow.
         *
         * VIEW-ONLY ACCOUNTS: In case of changes in this method, make sure these
         * changes are reflected for view-only accounts as well. Because the
         * view-only accounts import flow bypasses the AccountAdder, this method
         * won't click for them. Their on add success flow continues in the
         * MAIN_CONTROLLER_ADD_VIEW_ONLY_ACCOUNTS action case.
         */
        const onAccountAdderSuccess = () => {
            if (this.accountAdder.addAccountsStatus !== 'SUCCESS')
                return;
            return this.withStatus('onAccountAdderSuccess', async () => {
                // Add accounts first, because some of the next steps have validation
                // if accounts exists.
                await this.accounts.addAccounts(this.accountAdder.readyToAddAccounts);
                // Then add keys, because some of the next steps could have validation
                // if keys exists. Should be separate (not combined in Promise.all,
                // since firing multiple keystore actions is not possible
                // (the #wrapKeystoreAction listens for the first one to finish and
                // skips the parallel one, if one is requested).
                await this.keystore.addKeys(this.accountAdder.readyToAddKeys.internal);
                await this.keystore.addKeysExternallyStored(this.accountAdder.readyToAddKeys.external);
                // Update the saved seed `hdPathTemplate` if accounts were added from
                // the saved seed, so when user opts in to "Import a new Smart Account
                // from the saved Seed Phrase" the next account is derived based
                // on the latest `hdPathTemplate` chosen in the AccountAdder.
                if (this.accountAdder.isInitializedWithSavedSeed)
                    this.keystore.changeSavedSeedHdPathTemplateIfNeeded(this.accountAdder.hdPathTemplate);
                if (this.keystore.hasKeystoreTempSeed)
                    this.keystore.changeTempSeedHdPathTemplateIfNeeded(this.accountAdder.hdPathTemplate);
            }, true);
        };
        this.accountAdder.onUpdate(onAccountAdderSuccess);
        this.isReady = true;
        this.emitUpdate();
    }
    lock() {
        this.keystore.lock();
        this.emailVault.cleanMagicAndSessionKeys();
        this.selectedAccount.setDashboardNetworkFilter(null);
    }
    async selectAccount(toAccountAddr) {
        await this.withStatus('selectAccount', async () => this.#selectAccount(toAccountAddr), true);
    }
    async #selectAccount(toAccountAddr) {
        await this.#initialLoadPromise;
        if (!toAccountAddr) {
            await this.selectedAccount.setAccount(null);
            this.emitUpdate();
            return;
        }
        const accountToSelect = this.accounts.accounts.find((acc) => acc.addr === toAccountAddr);
        if (!accountToSelect) {
            console.error(`Account with address ${toAccountAddr} does not exist`);
            return;
        }
        this.isOffline = false;
        // call closeActionWindow while still on the currently selected account to allow proper
        // state cleanup of the controllers like actionsCtrl, signAccountOpCtrl, signMessageCtrl...
        if (this.actions?.currentAction?.type !== 'switchAccount') {
            this.actions.closeActionWindow();
        }
        this.selectedAccount.setAccount(accountToSelect);
        this.swapAndBridge.onAccountChange();
        this.dapps.broadcastDappSessionEvent('accountsChanged', [toAccountAddr]);
        // forceEmitUpdate to update the getters in the FE state of the ctrl
        await this.forceEmitUpdate();
        await this.actions.forceEmitUpdate();
        await this.addressBook.forceEmitUpdate();
        // Don't await these as they are not critical for the account selection
        // and if the user decides to quickly change to another account withStatus
        // will block the UI until these are resolved.
        this.reloadSelectedAccount({ forceUpdate: false });
        this.emitUpdate();
    }
    async importSmartAccountFromSavedSeed(seed) {
        await this.withStatus('importSmartAccountFromSavedSeed', async () => {
            if (this.accountAdder.isInitialized)
                this.accountAdder.reset();
            if (seed && !this.keystore.hasKeystoreSavedSeed) {
                await this.keystore.addSeed({ seed, hdPathTemplate: derivation_1.BIP44_STANDARD_DERIVATION_TEMPLATE });
            }
            const savedSeed = await this.keystore.getSavedSeed();
            if (!savedSeed) {
                throw new EmittableError_1.default({
                    message: 'Failed to retrieve saved seed phrase from keystore. Please try again or contact Ambire support if the issue persists.',
                    level: 'major',
                    error: new Error('failed to retrieve saved seed phrase from keystore')
                });
            }
            const keyIterator = new keyIterator_1.KeyIterator(savedSeed.seed);
            await this.accountAdder.init({
                keyIterator,
                hdPathTemplate: savedSeed.hdPathTemplate,
                pageSize: 1,
                shouldGetAccountsUsedOnNetworks: false,
                shouldSearchForLinkedAccounts: false
            });
            let currentPage = 1;
            let isAccountAlreadyAdded;
            let nextSmartAccount;
            const findNextSmartAccount = async () => {
                do {
                    // eslint-disable-next-line no-await-in-loop
                    await this.accountAdder.setPage({ page: currentPage });
                    nextSmartAccount = this.accountAdder.accountsOnPage.find(({ isLinked, account }) => !isLinked && (0, account_1.isSmartAccount)(account))?.account;
                    if (!nextSmartAccount)
                        break;
                    isAccountAlreadyAdded = !!this.accounts.accounts.find(
                    // eslint-disable-next-line @typescript-eslint/no-loop-func
                    (a) => a.addr === nextSmartAccount.addr);
                    currentPage++;
                } while (isAccountAlreadyAdded);
            };
            await findNextSmartAccount();
            if (!nextSmartAccount) {
                throw new EmittableError_1.default({
                    message: 'Internal error while looking for account to add. Please start the process all over again and if the issue persists contact Ambire support.',
                    level: 'major',
                    error: new Error('Internal error: Failed to find a smart account to add')
                });
            }
            this.accountAdder.selectAccount(nextSmartAccount);
            const readyToAddKeys = this.accountAdder.retrieveInternalKeysOfSelectedAccounts();
            await this.accountAdder.addAccounts(this.accountAdder.selectedAccounts, {
                internal: readyToAddKeys,
                external: []
            });
        }, true);
    }
    initSignAccOp(actionId) {
        const accountOp = (0, actions_1.getAccountOpFromAction)(actionId, this.actions.actionsQueue);
        if (!accountOp) {
            this.signAccOpInitError =
                'We cannot initiate the signing process because no transaction has been found for the specified account and network.';
            return null;
        }
        const network = this.networks.networks.find((net) => net.id === accountOp.networkId);
        if (!this.selectedAccount.account ||
            this.selectedAccount.account.addr !== accountOp.accountAddr) {
            this.signAccOpInitError =
                'Attempting to initialize an accountOp for an account other than the currently selected one.';
            return null;
        }
        if (!network) {
            this.signAccOpInitError =
                'We cannot initiate the signing process as we are unable to locate the specified network.';
            return null;
        }
        // on init, set the accountOp nonce to the latest one we know
        // it could happen that the user inits a userRequest with an old
        // accountState and therefore caching the old nonce in the accountOp.
        // we make sure the latest nonce is set when initing signAccountOp
        const state = this.accounts.accountStates?.[accountOp.accountAddr]?.[accountOp.networkId];
        if (state)
            accountOp.nonce = state.nonce;
        this.signAccOpInitError = null;
        this.signAccountOp = new signAccountOp_1.SignAccountOpController(this.accounts, this.keystore, this.portfolio, this.#externalSignerControllers, this.selectedAccount.account, network, actionId, accountOp, () => {
            this.estimateSignAccountOp();
        }, () => {
            return this.isSignRequestStillActive;
        });
        this.emitUpdate();
        this.updateSignAccountOpGasPrice();
        this.estimateSignAccountOp();
    }
    async handleSignAndBroadcastAccountOp() {
        await this.withStatus('signAccountOp', async () => {
            const wasAlreadySigned = this.signAccountOp?.status?.type === signAccountOp_1.SigningStatus.Done;
            if (wasAlreadySigned)
                return Promise.resolve();
            if (!this.signAccountOp) {
                const message = 'The signing process was not initialized as expected. Please try again later or contact Ambire support if the issue persists.';
                const error = new Error('SignAccountOp is not initialized');
                this.emitError({ level: 'major', message, error });
                return Promise.reject(error);
            }
            // Reset the promise in the `finally` block to ensure it doesn't remain unresolved if an error is thrown
            this.#signAccountOpSigningPromise = this.signAccountOp.sign().finally(() => {
                this.#signAccountOpSigningPromise = undefined;
            });
            return this.#signAccountOpSigningPromise;
        }, true);
        // Error handling on the prev step will notify the user, it's fine to return here
        if (this.signAccountOp?.status?.type !== signAccountOp_1.SigningStatus.Done)
            return;
        return this.withStatus('broadcastSignedAccountOp', async () => {
            // Reset the promise in the `finally` block to ensure it doesn't remain unresolved if an error is thrown
            this.#signAccountOpBroadcastPromise = this.#broadcastSignedAccountOp().finally(() => {
                this.#signAccountOpBroadcastPromise = undefined;
            });
            return this.#signAccountOpBroadcastPromise;
        }, true);
    }
    destroySignAccOp() {
        if (!this.signAccountOp)
            return;
        this.feePayerKey = null;
        this.signAccountOp = null;
        this.signAccOpInitError = null;
        // NOTE: no need to update the portfolio here as an update is
        // fired upon removeUserRequest
        this.emitUpdate();
    }
    async traceCall(estimation) {
        const accountOp = this.signAccountOp?.accountOp;
        if (!accountOp)
            return;
        const network = this.networks.networks.find((net) => net.id === accountOp?.networkId);
        if (!network)
            return;
        try {
            const account = this.accounts.accounts.find((acc) => acc.addr === accountOp.accountAddr);
            const state = this.accounts.accountStates[accountOp.accountAddr][accountOp.networkId];
            const provider = this.providers.providers[network.id];
            const gasPrice = this.gasPrices[network.id];
            const { tokens, nfts } = await (0, debugTraceCall_1.debugTraceCall)(account, accountOp, provider, state, estimation.gasUsed, gasPrice, !network.rpcNoStateOverride);
            const learnedNewTokens = this.portfolio.addTokensToBeLearned(tokens, network.id);
            const learnedNewNfts = await this.portfolio.learnNfts(nfts, network.id);
            // update the portfolio only if new tokens were found through tracing
            if (learnedNewTokens || learnedNewNfts) {
                this.portfolio
                    .updateSelectedAccount(accountOp.accountAddr, network, (0, main_1.getAccountOpsForSimulation)(account, this.actions.visibleActionsQueue, network, accountOp), { forceUpdate: true })
                    // fire an update request to refresh the warnings if any
                    .then(() => this.signAccountOp?.update({}));
            }
        }
        catch (e) {
            this.emitError({
                level: 'silent',
                message: 'Error in main.traceCall',
                error: e
            });
        }
    }
    async handleSignMessage() {
        const accountAddr = this.signMessage.messageToSign?.accountAddr;
        const networkId = this.signMessage.messageToSign?.networkId;
        // Could (rarely) happen if not even a single account state is fetched yet
        const shouldForceUpdateAndWaitForAccountState = accountAddr && networkId && !this.accounts.accountStates?.[accountAddr]?.[networkId];
        if (shouldForceUpdateAndWaitForAccountState)
            await this.accounts.updateAccountState(accountAddr, 'latest', [networkId]);
        const isAccountStateStillMissing = !accountAddr || !networkId || !this.accounts.accountStates?.[accountAddr]?.[networkId];
        if (isAccountStateStillMissing) {
            const message = 'Unable to sign the message. During the preparation step, required account data failed to get received. Please try again later or contact Ambire support.';
            const error = new Error(`The account state of ${accountAddr} is missing for the network with id ${networkId}.`);
            return this.emitError({ level: 'major', message, error });
        }
        await this.signMessage.sign();
        const signedMessage = this.signMessage.signedMessage;
        // Error handling on the prev step will notify the user, it's fine to return here
        if (!signedMessage)
            return;
        if (signedMessage.fromActionId === userOperation_1.ENTRY_POINT_AUTHORIZATION_REQUEST_ID) {
            const accountOpAction = (0, main_1.makeSmartAccountOpAction)({
                account: this.accounts.accounts.filter((a) => a.addr === signedMessage.accountAddr)[0],
                networkId: signedMessage.networkId,
                nonce: this.accounts.accountStates[signedMessage.accountAddr][signedMessage.networkId].nonce,
                userRequests: this.userRequests,
                actionsQueue: this.actions.actionsQueue
            });
            if (!accountOpAction.accountOp.meta)
                accountOpAction.accountOp.meta = {};
            accountOpAction.accountOp.meta.entryPointAuthorization = (0, signMessage_1.adjustEntryPointAuthorization)(signedMessage.signature);
            this.actions.addOrUpdateAction(accountOpAction, 'first');
        }
        await this.activity.addSignedMessage(signedMessage, signedMessage.accountAddr);
        await this.resolveUserRequest({ hash: signedMessage.signature }, signedMessage.fromActionId);
        await this.#notificationManager.create({
            title: 'Done!',
            message: 'The Message was successfully signed.'
        });
    }
    async #handleAccountAdderInitLedger(LedgerKeyIterator // TODO: KeyIterator type mismatch
    ) {
        if (this.accountAdder.isInitialized)
            this.accountAdder.reset();
        try {
            const ledgerCtrl = this.#externalSignerControllers.ledger;
            if (!ledgerCtrl) {
                const message = 'Could not initialize connection with your Ledger device. Please try again later or contact Ambire support.';
                throw new EmittableError_1.default({ message, level: 'major', error: new Error(message) });
            }
            // Once a session with the Ledger device gets initiated, the user might
            // use the device with another app. In this scenario, when coming back to
            // Ambire (the second time a connection gets requested onwards),
            // the Ledger device throws with "invalid channel" error.
            // To overcome this, always make sure to clean up before starting
            // a new session when retrieving keys, in case there already is one.
            if (ledgerCtrl.walletSDK)
                await ledgerCtrl.cleanUp();
            const hdPathTemplate = derivation_1.BIP44_LEDGER_DERIVATION_TEMPLATE;
            await ledgerCtrl.unlock(hdPathTemplate);
            if (!ledgerCtrl.walletSDK) {
                const message = 'Could not establish connection with the Ledger device';
                throw new EmittableError_1.default({ message, level: 'major', error: new Error(message) });
            }
            const keyIterator = new LedgerKeyIterator({ controller: ledgerCtrl });
            await this.accountAdder.init({ keyIterator, hdPathTemplate });
            return await this.accountAdder.setPage({ page: 1 });
        }
        catch (error) {
            const message = error?.message || 'Could not unlock the Ledger device. Please try again.';
            throw new EmittableError_1.default({ message, level: 'major', error });
        }
    }
    async handleAccountAdderInitLedger(LedgerKeyIterator /* TODO: KeyIterator type mismatch */) {
        await this.withStatus('handleAccountAdderInitLedger', async () => this.#handleAccountAdderInitLedger(LedgerKeyIterator));
    }
    async #handleAccountAdderInitLattice(LatticeKeyIterator /* TODO: KeyIterator type mismatch */) {
        if (this.accountAdder.isInitialized)
            this.accountAdder.reset();
        try {
            const latticeCtrl = this.#externalSignerControllers.lattice;
            if (!latticeCtrl) {
                const message = 'Could not initialize connection with your Lattice1 device. Please try again later or contact Ambire support.';
                throw new EmittableError_1.default({ message, level: 'major', error: new Error(message) });
            }
            const hdPathTemplate = derivation_1.BIP44_STANDARD_DERIVATION_TEMPLATE;
            await latticeCtrl.unlock(hdPathTemplate, undefined, true);
            const { walletSDK } = latticeCtrl;
            await this.accountAdder.init({
                keyIterator: new LatticeKeyIterator({ walletSDK }),
                hdPathTemplate
            });
            return await this.accountAdder.setPage({ page: 1 });
        }
        catch (error) {
            const message = error?.message || 'Could not unlock the Lattice1 device. Please try again.';
            throw new EmittableError_1.default({ message, level: 'major', error });
        }
    }
    async handleAccountAdderInitLattice(LatticeKeyIterator /* TODO: KeyIterator type mismatch */) {
        await this.withStatus('handleAccountAdderInitLattice', async () => this.#handleAccountAdderInitLattice(LatticeKeyIterator));
    }
    async updateAccountsOpsStatuses() {
        await this.#initialLoadPromise;
        const { shouldEmitUpdate, shouldUpdatePortfolio, updatedAccountsOps, newestOpTimestamp } = await this.activity.updateAccountsOpsStatuses();
        if (shouldEmitUpdate) {
            this.emitUpdate();
            if (shouldUpdatePortfolio) {
                this.updateSelectedAccountPortfolio(true);
            }
        }
        updatedAccountsOps.forEach((op) => {
            this.swapAndBridge.handleUpdateActiveRouteOnSubmittedAccountOpStatusUpdate(op);
        });
        return { newestOpTimestamp };
    }
    // call this function after a call to the singleton has been made
    // it will check if the factory has been deployed and update the network settings if it has been
    async setContractsDeployedToTrueIfDeployed(network) {
        await this.#initialLoadPromise;
        if (network.areContractsDeployed)
            return;
        const provider = this.providers.providers[network.id];
        if (!provider)
            return;
        const factoryCode = await provider.getCode(deploy_1.AMBIRE_ACCOUNT_FACTORY);
        if (factoryCode === '0x')
            return;
        await this.networks.updateNetwork({ areContractsDeployed: true }, network.id);
    }
    #removeAccountKeyData(address) {
        // Compute account keys that are only associated with this account
        const accountAssociatedKeys = this.accounts.accounts.find((acc) => acc.addr === address)?.associatedKeys || [];
        const keysInKeystore = this.keystore.keys;
        const importedAccountKeys = keysInKeystore.filter((key) => accountAssociatedKeys.includes(key.addr));
        const solelyAccountKeys = importedAccountKeys.filter((key) => {
            const isKeyAssociatedWithOtherAccounts = this.accounts.accounts.some((acc) => acc.addr !== address && acc.associatedKeys.includes(key.addr));
            return !isKeyAssociatedWithOtherAccounts;
        });
        // Remove account keys from the keystore
        solelyAccountKeys.forEach((key) => {
            this.keystore.removeKey(key.addr, key.type).catch((e) => {
                throw new EmittableError_1.default({
                    level: 'major',
                    message: 'Failed to remove account key',
                    error: e
                });
            });
        });
    }
    async removeAccount(address) {
        await this.withStatus('removeAccount', async () => {
            try {
                this.#removeAccountKeyData(address);
                // Remove account data from sub-controllers
                await this.accounts.removeAccountData(address);
                this.portfolio.removeAccountData(address);
                await this.activity.removeAccountData(address);
                this.actions.removeAccountData(address);
                this.signMessage.removeAccountData(address);
                this.defiPositions.removeAccountData(address);
                if (this.selectedAccount.account?.addr === address) {
                    await this.#selectAccount(this.accounts.accounts[0]?.addr);
                }
                if (this.signAccountOp?.account.addr === address) {
                    this.destroySignAccOp();
                }
                this.emitUpdate();
            }
            catch (e) {
                throw new EmittableError_1.default({
                    level: 'major',
                    message: 'Failed to remove account',
                    error: e || new Error('Failed to remove account')
                });
            }
        });
    }
    async #ensureAccountInfo(accountAddr, networkId) {
        await this.#initialLoadPromise;
        // Initial sanity check: does this account even exist?
        if (!this.accounts.accounts.find((x) => x.addr === accountAddr)) {
            this.signAccOpInitError = `Account ${accountAddr} does not exist`;
            return;
        }
        // If this still didn't work, re-load
        if (!this.accounts.accountStates[accountAddr]?.[networkId])
            await this.accounts.updateAccountState(accountAddr, 'pending', [networkId]);
        // If this still didn't work, throw error: this prob means that we're calling for a non-existent acc/network
        if (!this.accounts.accountStates[accountAddr]?.[networkId])
            this.signAccOpInitError = `Failed to retrieve account info for ${networkId}, because of one of the following reasons: 1) network doesn't exist, 2) RPC is down for this network`;
    }
    #batchCallsFromUserRequests(accountAddr, networkId) {
        // Note: we use reduce instead of filter/map so that the compiler can deduce that we're checking .kind
        return this.userRequests.filter((r) => r.action.kind === 'calls').reduce((uCalls, req) => {
            if (req.meta.networkId === networkId && req.meta.accountAddr === accountAddr) {
                const { calls } = req.action;
                calls.map((call) => uCalls.push({ ...call, fromUserRequestId: req.id }));
            }
            return uCalls;
        }, []);
    }
    async reloadSelectedAccount(options) {
        const { forceUpdate = true, networkId } = options || {};
        const networkToUpdate = networkId
            ? this.networks.networks.find((n) => n.id === networkId)
            : undefined;
        if (!this.selectedAccount.account)
            return;
        this.selectedAccount.resetSelectedAccountPortfolio();
        await Promise.all([
            // When we trigger `reloadSelectedAccount` (for instance, from Dashboard -> Refresh balance icon),
            // it's very likely that the account state is already in the process of being updated.
            // If we try to run the same action, `withStatus` validation will throw an error.
            // So, we perform this safety check to prevent the error.
            // However, even if we don't trigger an update here, it's not a big problem,
            // as the account state will be updated anyway, and its update will be very recent.
            !this.accounts.areAccountStatesLoading && this.selectedAccount.account?.addr
                ? this.accounts.updateAccountState(this.selectedAccount.account.addr, 'pending', networkId ? [networkId] : undefined)
                : Promise.resolve(),
            // `updateSelectedAccountPortfolio` doesn't rely on `withStatus` validation internally,
            // as the PortfolioController already exposes flags that are highly sufficient for the UX.
            // Additionally, if we trigger the portfolio update twice (i.e., running a long-living interval + force update from the Dashboard),
            // there won't be any error thrown, as all portfolio updates are queued and they don't use the `withStatus` helper.
            this.updateSelectedAccountPortfolio(forceUpdate, networkToUpdate),
            this.defiPositions.updatePositions({ networkId })
        ]);
    }
    #updateIsOffline() {
        const oldIsOffline = this.isOffline;
        const accountAddr = this.selectedAccount.account?.addr;
        if (!accountAddr)
            return;
        // We have to make calculations based on the state of the portfolio
        // and not the selected account portfolio the flag isOffline
        // and the errors of the selected account portfolio should
        // come in the same tick. Otherwise the UI may flash the wrong error.
        const latestState = this.portfolio.getLatestPortfolioState(accountAddr);
        const latestStateKeys = Object.keys(latestState);
        const isAllReady = latestStateKeys.every((networkId) => {
            return (0, selectedAccount_1.isNetworkReady)(latestState[networkId]);
        });
        if (!isAllReady)
            return;
        const allPortfolioNetworksHaveErrors = latestStateKeys.every((networkId) => {
            const state = latestState[networkId];
            return !!state?.criticalError;
        });
        const allNetworkRpcsAreDown = Object.keys(this.providers.providers).every((networkId) => {
            const provider = this.providers.providers[networkId];
            const isWorking = provider.isWorking;
            return typeof isWorking === 'boolean' && !isWorking;
        });
        // Update isOffline if either all portfolio networks have errors or we've failed to fetch
        // the account state for every account. This is because either update may fail first.
        this.isOffline = !!allNetworkRpcsAreDown || !!allPortfolioNetworksHaveErrors;
        if (oldIsOffline !== this.isOffline) {
            this.emitUpdate();
        }
    }
    // TODO: Refactor this to accept an optional object with options
    async updateSelectedAccountPortfolio(
    // eslint-disable-next-line default-param-last
    forceUpdate = false, network, maxDataAgeMs) {
        await this.#initialLoadPromise;
        if (!this.selectedAccount.account)
            return;
        const signAccountOpNetworkId = this.signAccountOp?.accountOp.networkId;
        const networkData = network || this.networks.networks.find((n) => n.id === signAccountOpNetworkId);
        const accountOpsToBeSimulatedByNetwork = (0, main_1.getAccountOpsForSimulation)(this.selectedAccount.account, this.actions.visibleActionsQueue, networkData, this.signAccountOp?.accountOp);
        await this.portfolio.updateSelectedAccount(this.selectedAccount.account.addr, network, accountOpsToBeSimulatedByNetwork, { forceUpdate, maxDataAgeMs });
        this.#updateIsOffline();
    }
    #getUserRequestAccountError(dappOrigin, fromAccountAddr) {
        if (dappCommunication_1.ORIGINS_WHITELISTED_TO_ALL_ACCOUNTS.includes(dappOrigin)) {
            const isAddressInAccounts = this.accounts.accounts.some((a) => a.addr === fromAccountAddr);
            if (isAddressInAccounts)
                return null;
            return 'The dApp is trying to sign using an address that is not imported in the extension.';
        }
        const isAddressSelected = this.selectedAccount.account?.addr === fromAccountAddr;
        if (isAddressSelected)
            return null;
        return 'The dApp is trying to sign using an address that is not selected in the extension.';
    }
    async buildUserRequestFromDAppRequest(request, dappPromise) {
        await this.#initialLoadPromise;
        let userRequest = null;
        let actionPosition = 'last';
        const kind = (0, actions_1.dappRequestMethodToActionKind)(request.method);
        const dapp = this.dapps.getDapp(request.origin);
        if (kind === 'calls') {
            if (!this.selectedAccount.account)
                throw eth_rpc_errors_1.ethErrors.rpc.internal();
            const network = this.networks.networks.find((n) => Number(n.chainId) === Number(dapp?.chainId));
            if (!network) {
                throw eth_rpc_errors_1.ethErrors.provider.chainDisconnected('Transaction failed - unknown network');
            }
            const isWalletSendCalls = !!request.params[0].calls;
            const accountAddr = (0, ethers_1.getAddress)(request.params[0].from);
            const calls = isWalletSendCalls
                ? request.params[0].calls
                : [request.params[0]];
            const paymasterService = isWalletSendCalls
                ? (0, erc7677_1.getPaymasterService)(network.chainId, request.params[0].capabilities)
                : null;
            userRequest = {
                id: new Date().getTime(),
                action: {
                    kind,
                    calls: calls.map((call) => ({
                        to: call.to,
                        data: call.data || '0x',
                        value: call.value ? (0, ethers_1.getBigInt)(call.value) : 0n
                    }))
                },
                meta: {
                    isSignAction: true,
                    isWalletSendCalls,
                    accountAddr,
                    networkId: network.id,
                    paymasterService
                },
                dappPromise
            };
            if (!this.selectedAccount.account.creation) {
                const otherUserRequestFromSameDapp = this.userRequests.find((r) => r.dappPromise?.session?.origin === dappPromise?.session?.origin);
                if (!otherUserRequestFromSameDapp && !!dappPromise?.session?.origin) {
                    actionPosition = 'first';
                }
            }
        }
        else if (kind === 'message') {
            if (!this.selectedAccount.account)
                throw eth_rpc_errors_1.ethErrors.rpc.internal();
            const msg = request.params;
            if (!msg) {
                throw eth_rpc_errors_1.ethErrors.rpc.invalidRequest('No msg request to sign');
            }
            const msgAddress = (0, ethers_1.getAddress)(msg?.[1]);
            const network = this.networks.networks.find((n) => Number(n.chainId) === Number(dapp?.chainId));
            if (!network) {
                throw eth_rpc_errors_1.ethErrors.provider.chainDisconnected('Transaction failed - unknown network');
            }
            userRequest = {
                id: new Date().getTime(),
                action: {
                    kind: 'message',
                    message: msg[0]
                },
                session: request.session,
                meta: {
                    isSignAction: true,
                    accountAddr: msgAddress,
                    networkId: network.id
                },
                dappPromise
            };
        }
        else if (kind === 'typedMessage') {
            if (!this.selectedAccount.account)
                throw eth_rpc_errors_1.ethErrors.rpc.internal();
            const msg = request.params;
            if (!msg) {
                throw eth_rpc_errors_1.ethErrors.rpc.invalidRequest('No msg request to sign');
            }
            const msgAddress = (0, ethers_1.getAddress)(msg?.[0]);
            const network = this.networks.networks.find((n) => Number(n.chainId) === Number(dapp?.chainId));
            if (!network) {
                throw eth_rpc_errors_1.ethErrors.provider.chainDisconnected('Transaction failed - unknown network');
            }
            let typedData = msg?.[1];
            try {
                typedData = (0, richJson_1.parse)(typedData);
            }
            catch (error) {
                throw eth_rpc_errors_1.ethErrors.rpc.invalidRequest('Invalid typedData provided');
            }
            if (!typedData?.types ||
                !typedData?.domain ||
                !typedData?.message ||
                !typedData?.primaryType) {
                throw eth_rpc_errors_1.ethErrors.rpc.methodNotSupported('Invalid typedData format - only typedData v4 is supported');
            }
            if (msgAddress === this.selectedAccount.account.addr &&
                (typedData.primaryType === 'AmbireOperation' || !!typedData.types.AmbireOperation)) {
                throw eth_rpc_errors_1.ethErrors.rpc.methodNotSupported('Signing an AmbireOperation is not allowed');
            }
            userRequest = {
                id: new Date().getTime(),
                action: {
                    kind: 'typedMessage',
                    types: typedData.types,
                    domain: typedData.domain,
                    message: typedData.message,
                    primaryType: typedData.primaryType
                },
                session: request.session,
                meta: {
                    isSignAction: true,
                    accountAddr: msgAddress,
                    networkId: network.id
                },
                dappPromise
            };
        }
        else {
            userRequest = {
                id: new Date().getTime(),
                session: request.session,
                action: { kind, params: request.params },
                meta: { isSignAction: false },
                dappPromise
            };
        }
        if (userRequest.action.kind !== 'calls') {
            const otherUserRequestFromSameDapp = this.userRequests.find((r) => r.dappPromise?.session?.origin === dappPromise?.session?.origin);
            if (!otherUserRequestFromSameDapp && !!dappPromise?.session?.origin) {
                actionPosition = 'first';
            }
        }
        if (!userRequest)
            return;
        const isASignOperationRequestedForAnotherAccount = userRequest.meta.isSignAction &&
            userRequest.meta.accountAddr !== this.selectedAccount.account?.addr;
        // We can simply add the user request if it's not a sign operation
        // for another account
        if (!isASignOperationRequestedForAnotherAccount) {
            await this.addUserRequest(userRequest, actionPosition, actionPosition === 'first' || (0, account_1.isSmartAccount)(this.selectedAccount.account)
                ? 'open-action-window'
                : 'queue-but-open-action-window');
            return;
        }
        const accountError = this.#getUserRequestAccountError(dappPromise.session.origin, userRequest.meta.accountAddr);
        if (accountError) {
            dappPromise.reject(eth_rpc_errors_1.ethErrors.provider.userRejectedRequest(accountError));
            return;
        }
        const network = this.networks.networks.find((n) => Number(n.chainId) === Number(dapp?.chainId));
        if (!network) {
            throw eth_rpc_errors_1.ethErrors.provider.chainDisconnected('Transaction failed - unknown network');
        }
        this.userRequestWaitingAccountSwitch.push(userRequest);
        await this.addUserRequest((0, main_1.buildSwitchAccountUserRequest)({
            nextUserRequest: userRequest,
            networkId: network.id,
            selectedAccountAddr: userRequest.meta.accountAddr,
            session: dappPromise.session,
            dappPromise
        }), 'last', 'open-action-window');
    }
    async buildTransferUserRequest(amount, recipientAddress, selectedToken, actionExecutionType = 'open-action-window') {
        await this.#initialLoadPromise;
        if (!this.selectedAccount.account)
            return;
        const userRequest = (0, userRequest_1.buildTransferUserRequest)({
            selectedAccount: this.selectedAccount.account.addr,
            amount,
            selectedToken,
            recipientAddress
        });
        if (!userRequest) {
            this.emitError({
                level: 'major',
                message: 'Unexpected error while building transfer request',
                error: new Error('buildUserRequestFromTransferRequest: bad parameters passed to buildTransferUserRequest')
            });
            return;
        }
        await this.addUserRequest(userRequest, 'last', actionExecutionType);
    }
    async buildSwapAndBridgeUserRequest(activeRouteId) {
        await this.withStatus('buildSwapAndBridgeUserRequest', async () => {
            if (!this.selectedAccount.account)
                return;
            let transaction = null;
            const activeRoute = this.swapAndBridge.activeRoutes.find((r) => r.activeRouteId === activeRouteId);
            if (this.swapAndBridge.formStatus === swapAndBridge_2.SwapAndBridgeFormStatus.ReadyToSubmit) {
                transaction = await this.swapAndBridge.getRouteStartUserTx();
            }
            if (activeRoute) {
                this.removeUserRequest(activeRoute.activeRouteId, {
                    shouldRemoveSwapAndBridgeRoute: false,
                    shouldOpenNextRequest: false
                });
                this.swapAndBridge.updateActiveRoute(activeRoute.activeRouteId, { error: undefined });
                if (!(0, account_1.isSmartAccount)(this.selectedAccount.account)) {
                    this.removeUserRequest(`${activeRouteId}-revoke-approval`, {
                        shouldRemoveSwapAndBridgeRoute: false,
                        shouldOpenNextRequest: false
                    });
                    this.removeUserRequest(`${activeRouteId}-approval`, {
                        shouldRemoveSwapAndBridgeRoute: false,
                        shouldOpenNextRequest: false
                    });
                }
                transaction = await this.swapAndBridge.getNextRouteUserTx(activeRoute.activeRouteId);
            }
            if (!this.selectedAccount.account || !transaction) {
                const errorDetails = `missing ${this.selectedAccount.account ? 'selected account' : 'transaction'} info`;
                const error = new SwapAndBridgeError_1.default(`Something went wrong when preparing your request. Please try again later or contact Ambire support. Error details: <${errorDetails}>`);
                throw new EmittableError_1.default({ message: error.message, level: 'major', error });
            }
            const network = this.networks.networks.find((n) => Number(n.chainId) === transaction.chainId);
            // TODO: Consider refining the error handling in here, because this
            // swallows errors and doesn't provide any feedback to the user.
            const swapAndBridgeUserRequests = await (0, swapAndBridge_1.buildSwapAndBridgeUserRequests)(transaction, network.id, this.selectedAccount.account, this.providers.providers[network.id]);
            for (let i = 0; i < swapAndBridgeUserRequests.length; i++) {
                if (i === 0) {
                    this.addUserRequest(swapAndBridgeUserRequests[i], 'last', 'open-action-window');
                }
                else {
                    // eslint-disable-next-line no-await-in-loop
                    await this.addUserRequest(swapAndBridgeUserRequests[i], 'last', 'queue');
                }
            }
            if (this.swapAndBridge.formStatus === swapAndBridge_2.SwapAndBridgeFormStatus.ReadyToSubmit) {
                await this.swapAndBridge.addActiveRoute({
                    activeRouteId: transaction.activeRouteId,
                    userTxIndex: transaction.userTxIndex
                });
            }
            if (activeRouteId) {
                this.swapAndBridge.updateActiveRoute(activeRouteId, {
                    userTxIndex: transaction.userTxIndex,
                    userTxHash: null
                }, true);
            }
        }, true);
    }
    buildClaimWalletUserRequest(token) {
        if (!this.selectedAccount.account)
            return;
        const claimableRewardsData = this.selectedAccount.portfolio.latest.rewards?.result?.claimableRewardsData;
        if (!claimableRewardsData)
            return;
        const userRequest = (0, userRequest_1.buildClaimWalletRequest)({
            selectedAccount: this.selectedAccount.account.addr,
            selectedToken: token,
            claimableRewardsData
        });
        this.addUserRequest(userRequest);
    }
    buildMintVestingUserRequest(token) {
        if (!this.selectedAccount.account)
            return;
        const addrVestingData = this.selectedAccount.portfolio.latest.rewards?.result?.addrVestingData;
        if (!addrVestingData)
            return;
        const userRequest = (0, userRequest_1.buildMintVestingRequest)({
            selectedAccount: this.selectedAccount.account.addr,
            selectedToken: token,
            addrVestingData
        });
        this.addUserRequest(userRequest);
    }
    resolveUserRequest(data, requestId) {
        const userRequest = this.userRequests.find((r) => r.id === requestId);
        if (!userRequest)
            return; // TODO: emit error
        userRequest.dappPromise?.resolve(data);
        // These requests are transitionary initiated internally (not dApp requests) that block dApp requests
        // before being resolved. The timeout prevents the action-window from closing before the actual dApp request arrives
        if (['unlock', 'dappConnect'].includes(userRequest.action.kind)) {
            setTimeout(() => {
                this.removeUserRequest(requestId);
                this.emitUpdate();
            }, 300);
        }
        else {
            this.removeUserRequest(requestId);
            this.emitUpdate();
        }
    }
    rejectUserRequest(err, requestId) {
        const userRequest = this.userRequests.find((r) => r.id === requestId);
        if (!userRequest)
            return;
        if (requestId === userOperation_1.ENTRY_POINT_AUTHORIZATION_REQUEST_ID) {
            this.userRequests = this.userRequests.filter((r) => !(r.action.kind === 'calls' &&
                r.meta.accountAddr === userRequest.meta.accountAddr &&
                r.meta.networkId === userRequest.meta.networkId));
        }
        // if the userRequest that is about to be removed is an approval request
        // find and remove the associated pending transaction request if there is any
        // this is valid scenario for a swap & bridge txs with a BA
        if (userRequest.action.kind === 'calls') {
            const acc = this.accounts.accounts.find((a) => a.addr === userRequest.meta.accountAddr);
            if (!(0, account_1.isSmartAccount)(acc) && userRequest.meta.isSwapAndBridgeCall) {
                this.removeUserRequest(userRequest.meta.activeRouteId);
                this.removeUserRequest(`${userRequest.meta.activeRouteId}-approval`);
                this.removeUserRequest(`${userRequest.meta.activeRouteId}-revoke-approval`);
            }
        }
        userRequest.dappPromise?.reject(eth_rpc_errors_1.ethErrors.provider.userRejectedRequest(err));
        this.removeUserRequest(requestId);
    }
    rejectSignAccountOpCall(callId) {
        if (!this.signAccountOp)
            return;
        const { calls, networkId, accountAddr } = this.signAccountOp.accountOp;
        const requestId = calls.find((c) => c.id === callId)?.fromUserRequestId;
        if (requestId) {
            const userRequestIndex = this.userRequests.findIndex((r) => r.id === requestId);
            const userRequest = this.userRequests[userRequestIndex];
            if (userRequest.action.kind === 'calls') {
                ;
                userRequest.action.calls = userRequest.action.calls.filter((c) => c.id !== callId);
                if (userRequest.action.calls.length === 0) {
                    // the reject will remove the userRequest which will rebuild the action and update the signAccountOp
                    this.rejectUserRequest('User rejected the transaction request.', userRequest.id);
                }
                else {
                    const accountOpAction = (0, main_1.makeSmartAccountOpAction)({
                        account: this.accounts.accounts.find((a) => a.addr === accountAddr),
                        networkId,
                        nonce: this.accounts.accountStates[accountAddr][networkId].nonce,
                        userRequests: this.userRequests,
                        actionsQueue: this.actions.actionsQueue
                    });
                    this.actions.addOrUpdateAction(accountOpAction);
                    this.signAccountOp?.update({ calls: accountOpAction.accountOp.calls });
                    this.estimateSignAccountOp();
                }
            }
        }
        else {
            this.emitError({
                message: 'Reject call: the call was not found or was not linked to a user request',
                level: 'major',
                error: new Error(`Error: rejectAccountOpCall: userRequest for call with id ${callId} was not found`)
            });
        }
    }
    removeActiveRoute(activeRouteId) {
        const userRequest = this.userRequests.find((r) => [activeRouteId, `${activeRouteId}-approval`, `${activeRouteId}-revoke-approval`].includes(r.id));
        if (userRequest) {
            this.rejectUserRequest('User rejected the transaction request.', userRequest.id);
        }
        else {
            this.swapAndBridge.removeActiveRoute(activeRouteId);
        }
    }
    async addUserRequest(req, actionPosition = 'last', actionExecutionType = 'open-action-window') {
        if (req.action.kind === 'calls') {
            ;
            req.action.calls.forEach((_, i) => {
                ;
                req.action.calls[i].id = `${req.id}-${i}`;
            });
        }
        if (actionPosition === 'first') {
            this.userRequests.unshift(req);
        }
        else {
            this.userRequests.push(req);
        }
        const { id, action, meta } = req;
        if (action.kind === 'calls') {
            // @TODO
            // one solution would be to, instead of checking, have a promise that we always await here, that is responsible for fetching
            // account data; however, this won't work with EOA accountOps, which have to always pick the first userRequest for a particular acc/network,
            // and be recalculated when one gets dismissed
            // although it could work like this: 1) await the promise, 2) check if exists 3) if not, re-trigger the promise;
            // 4) manage recalc on removeUserRequest too in order to handle EOAs
            // @TODO consider re-using this whole block in removeUserRequest
            await this.#ensureAccountInfo(meta.accountAddr, meta.networkId);
            if (this.signAccOpInitError) {
                return req.dappPromise?.reject(eth_rpc_errors_1.ethErrors.provider.custom({
                    code: 1001,
                    message: this.signAccOpInitError
                }));
            }
            if (this.#signAccountOpSigningPromise)
                await this.#signAccountOpSigningPromise;
            if (this.#signAccountOpBroadcastPromise)
                await this.#signAccountOpBroadcastPromise;
            const account = this.accounts.accounts.find((x) => x.addr === meta.accountAddr);
            const accountState = this.accounts.accountStates[meta.accountAddr][meta.networkId];
            if ((0, account_1.isSmartAccount)(account)) {
                const network = this.networks.networks.find((n) => n.id === meta.networkId);
                // find me the accountOp for the network if any, it's always 1 for SA
                const currentAccountOpAction = this.actions.actionsQueue.find((a) => a.type === 'accountOp' &&
                    a.accountOp.accountAddr === account.addr &&
                    a.accountOp.networkId === network.id);
                const entryPointAuthorizationMessageFromHistory = await this.activity.findMessage(account.addr, (message) => message.fromActionId === userOperation_1.ENTRY_POINT_AUTHORIZATION_REQUEST_ID &&
                    message.networkId === network.id);
                const hasAuthorized = !!currentAccountOpAction?.accountOp?.meta?.entryPointAuthorization ||
                    !!entryPointAuthorizationMessageFromHistory;
                if ((0, userOperation_1.shouldAskForEntryPointAuthorization)(network, account, accountState, hasAuthorized)) {
                    await this.addEntryPointAuthorization(req, network, accountState, actionExecutionType);
                    this.emitUpdate();
                    return;
                }
                const accountOpAction = (0, main_1.makeSmartAccountOpAction)({
                    account,
                    networkId: meta.networkId,
                    nonce: accountState.nonce,
                    userRequests: this.userRequests,
                    actionsQueue: this.actions.actionsQueue,
                    entryPointAuthorizationSignature: entryPointAuthorizationMessageFromHistory?.signature ?? undefined
                });
                this.actions.addOrUpdateAction(accountOpAction, actionPosition, actionExecutionType);
                if (this.signAccountOp) {
                    if (this.signAccountOp.fromActionId === accountOpAction.id) {
                        this.signAccountOp.update({ calls: accountOpAction.accountOp.calls });
                        this.estimateSignAccountOp();
                    }
                }
                else {
                    // Even without an initialized SignAccountOpController or Screen, we should still update the portfolio and run the simulation.
                    // It's necessary to continue operating with the token `amountPostSimulation` amount.
                    this.updateSelectedAccountPortfolio(true, network);
                }
            }
            else {
                const accountOpAction = (0, main_1.makeBasicAccountOpAction)({
                    account,
                    networkId: meta.networkId,
                    nonce: accountState.nonce,
                    userRequest: req
                });
                this.actions.addOrUpdateAction(accountOpAction, actionPosition, actionExecutionType);
            }
        }
        else {
            let actionType = 'dappRequest';
            if (req.action.kind === 'typedMessage' || req.action.kind === 'message') {
                actionType = 'signMessage';
                if (this.actions.visibleActionsQueue.find((a) => a.type === 'signMessage')) {
                    const msgReq = this.userRequests.find((uReq) => uReq.id === id);
                    if (!msgReq)
                        return;
                    msgReq.dappPromise?.reject(eth_rpc_errors_1.ethErrors.provider.custom({
                        code: 1001,
                        message: 'Rejected: Please complete your pending message request before initiating a new one.'
                    }));
                    this.userRequests.splice(this.userRequests.indexOf(msgReq), 1);
                    return;
                }
            }
            if (req.action.kind === 'benzin')
                actionType = 'benzin';
            if (req.action.kind === 'switchAccount')
                actionType = 'switchAccount';
            this.actions.addOrUpdateAction({
                id,
                type: actionType,
                userRequest: req
            }, actionPosition, actionExecutionType);
        }
        this.emitUpdate();
    }
    // @TODO allow this to remove multiple OR figure out a way to debounce re-estimations
    // first one sounds more reasonable
    // although the second one can't hurt and can help (or no debounce, just a one-at-a-time queue)
    removeUserRequest(id, options = {
        shouldRemoveSwapAndBridgeRoute: true,
        shouldUpdateAccount: true,
        shouldOpenNextRequest: true
    }) {
        const req = this.userRequests.find((uReq) => uReq.id === id);
        if (!req)
            return;
        // remove from the request queue
        this.userRequests.splice(this.userRequests.indexOf(req), 1);
        // update the pending stuff to be signed
        const { action, meta } = req;
        if (action.kind === 'calls') {
            const network = this.networks.networks.find((net) => net.id === meta.networkId);
            const account = this.accounts.accounts.find((x) => x.addr === meta.accountAddr);
            if (!account)
                throw new Error(`batchCallsFromUserRequests: tried to run for non-existent account ${meta.accountAddr}`);
            if ((0, account_1.isSmartAccount)(account)) {
                const accountOpIndex = this.actions.actionsQueue.findIndex((a) => a.type === 'accountOp' && a.id === `${meta.accountAddr}-${meta.networkId}`);
                const accountOpAction = this.actions.actionsQueue[accountOpIndex];
                // accountOp has just been rejected or broadcasted
                if (!accountOpAction) {
                    if (options.shouldUpdateAccount)
                        this.updateSelectedAccountPortfolio(true, network);
                    if (this.swapAndBridge.activeRoutes.length && options.shouldRemoveSwapAndBridgeRoute) {
                        this.swapAndBridge.removeActiveRoute(meta.activeRouteId);
                    }
                    this.emitUpdate();
                    return;
                }
                accountOpAction.accountOp.calls = this.#batchCallsFromUserRequests(meta.accountAddr, meta.networkId);
                if (accountOpAction.accountOp.calls.length) {
                    this.actions.addOrUpdateAction(accountOpAction);
                    if (this.signAccountOp && this.signAccountOp.fromActionId === accountOpAction.id) {
                        this.signAccountOp.update({ calls: accountOpAction.accountOp.calls, estimation: null });
                        this.estimateSignAccountOp();
                    }
                }
                else {
                    if (this.signAccountOp && this.signAccountOp.fromActionId === accountOpAction.id) {
                        this.destroySignAccOp();
                    }
                    this.actions.removeAction(`${meta.accountAddr}-${meta.networkId}`, options.shouldOpenNextRequest);
                    if (options.shouldUpdateAccount)
                        this.updateSelectedAccountPortfolio(true, network);
                }
            }
            else {
                if (this.signAccountOp && this.signAccountOp.fromActionId === req.id) {
                    this.destroySignAccOp();
                }
                this.actions.removeAction(id, options.shouldOpenNextRequest);
                if (options.shouldUpdateAccount)
                    this.updateSelectedAccountPortfolio(true, network);
            }
            if (this.swapAndBridge.activeRoutes.length && options.shouldRemoveSwapAndBridgeRoute) {
                this.swapAndBridge.removeActiveRoute(meta.activeRouteId);
            }
        }
        else if (id === main_1.ACCOUNT_SWITCH_USER_REQUEST) {
            const requestsToAdd = this.userRequestWaitingAccountSwitch.filter((r) => r.meta.accountAddr === this.selectedAccount.account.addr);
            this.actions.removeAction(id, this.selectedAccount.account?.addr !== action.params.switchToAccountAddr);
            (async () => {
                // eslint-disable-next-line no-restricted-syntax
                for (const r of requestsToAdd) {
                    this.userRequestWaitingAccountSwitch.splice(this.userRequests.indexOf(r), 1);
                    // eslint-disable-next-line no-await-in-loop
                    await this.addUserRequest(r);
                }
            })();
        }
        else {
            this.actions.removeAction(id, options.shouldOpenNextRequest);
        }
        this.emitUpdate();
    }
    async addEntryPointAuthorization(req, network, accountState, actionExecutionType = 'open-action-window') {
        if (this.actions.visibleActionsQueue.find((a) => a.id === userOperation_1.ENTRY_POINT_AUTHORIZATION_REQUEST_ID &&
            a.userRequest.meta.networkId === req.meta.networkId)) {
            this.actions.setCurrentActionById(userOperation_1.ENTRY_POINT_AUTHORIZATION_REQUEST_ID);
            return;
        }
        const typedMessageAction = await (0, signMessage_1.getEntryPointAuthorization)(req.meta.accountAddr, network.chainId, BigInt(accountState.nonce));
        await this.addUserRequest({
            id: userOperation_1.ENTRY_POINT_AUTHORIZATION_REQUEST_ID,
            action: typedMessageAction,
            meta: {
                isSignAction: true,
                accountAddr: req.meta.accountAddr,
                networkId: req.meta.networkId
            },
            session: req.session,
            dappPromise: req?.dappPromise
                ? { reject: req?.dappPromise?.reject, resolve: () => { } }
                : undefined
        }, 'first', actionExecutionType);
    }
    async addNetwork(network) {
        await this.networks.addNetwork(network);
        await this.updateSelectedAccountPortfolio();
    }
    async removeNetwork(id) {
        await this.networks.removeNetwork(id);
        this.portfolio.removeNetworkData(id);
        this.defiPositions.removeNetworkData(id);
        this.accountAdder.removeNetworkData(id);
    }
    async resolveAccountOpAction(data, actionId) {
        const accountOpAction = this.actions.actionsQueue.find((a) => a.id === actionId);
        if (!accountOpAction)
            return;
        const { accountOp } = accountOpAction;
        const network = this.networks.networks.find((n) => n.id === accountOp.networkId);
        if (!network)
            return;
        const meta = {
            isSignAction: true,
            accountAddr: accountOp.accountAddr,
            chainId: network.chainId,
            networkId: '',
            txnId: null,
            userOpHash: null
        };
        if (data.submittedAccountOp) {
            // can be undefined, check submittedAccountOp.ts
            meta.txnId = data.submittedAccountOp.txnId;
            meta.identifiedBy = data.submittedAccountOp.identifiedBy;
            meta.submittedAccountOp = data.submittedAccountOp;
        }
        const benzinUserRequest = {
            id: new Date().getTime(),
            action: { kind: 'benzin' },
            meta
        };
        await this.addUserRequest(benzinUserRequest, 'first');
        this.actions.removeAction(actionId);
        // handle wallet_sendCalls before pollTxnId as 1) it's faster
        // 2) the identifier is different
        // eslint-disable-next-line no-restricted-syntax
        for (const call of accountOp.calls) {
            const walletSendCallsUserReq = this.userRequests.find((r) => r.id === call.fromUserRequestId && r.meta.isWalletSendCalls);
            if (walletSendCallsUserReq) {
                walletSendCallsUserReq.dappPromise?.resolve({
                    hash: (0, submittedAccountOp_1.getDappIdentifier)(data.submittedAccountOp)
                });
                // eslint-disable-next-line no-await-in-loop
                this.removeUserRequest(walletSendCallsUserReq.id, {
                    shouldRemoveSwapAndBridgeRoute: false,
                    // Since `resolveAccountOpAction` is invoked only when we broadcast a transaction,
                    // we don't want to update the account portfolio immediately, as we would lose the simulation.
                    // The simulation is required to calculate the pending badges (see: calculatePendingAmounts()).
                    // Once the transaction is confirmed, delayed, or the user manually refreshes the portfolio,
                    // the account will be updated automatically.
                    shouldUpdateAccount: false
                });
            }
        }
        // Note: this may take a while!
        const txnId = await (0, submittedAccountOp_1.pollTxnId)(data.submittedAccountOp.identifiedBy, network, this.fetch, this.callRelayer);
        // eslint-disable-next-line no-restricted-syntax
        for (const call of accountOp.calls) {
            const uReq = this.userRequests.find((r) => r.id === call.fromUserRequestId);
            if (uReq) {
                if (txnId) {
                    uReq.dappPromise?.resolve({ hash: txnId });
                }
                else {
                    uReq.dappPromise?.reject(eth_rpc_errors_1.ethErrors.rpc.transactionRejected({
                        message: 'Transaction rejected by the bundler'
                    }));
                }
                // eslint-disable-next-line no-await-in-loop
                this.removeUserRequest(uReq.id, {
                    shouldRemoveSwapAndBridgeRoute: false,
                    // Since `resolveAccountOpAction` is invoked only when we broadcast a transaction,
                    // we don't want to update the account portfolio immediately, as we would lose the simulation.
                    // The simulation is required to calculate the pending badges (see: calculatePendingAmounts()).
                    // Once the transaction is confirmed, delayed, or the user manually refreshes the portfolio,
                    // the account will be updated automatically.
                    shouldUpdateAccount: false
                });
            }
        }
        this.emitUpdate();
    }
    rejectAccountOpAction(err, actionId, shouldOpenNextAction) {
        const accountOpAction = this.actions.actionsQueue.find((a) => a.id === actionId);
        if (!accountOpAction)
            return;
        const { accountOp, id } = accountOpAction;
        if (this.signAccountOp && this.signAccountOp.fromActionId === id) {
            this.destroySignAccOp();
        }
        this.actions.removeAction(actionId, shouldOpenNextAction);
        // eslint-disable-next-line no-restricted-syntax
        for (const call of accountOp.calls) {
            if (call.fromUserRequestId)
                this.rejectUserRequest(err, call.fromUserRequestId);
        }
        this.emitUpdate();
    }
    async #updateGasPrice() {
        await this.#initialLoadPromise;
        // if there's no signAccountOp initialized, we don't want to fetch gas
        const accOp = this.signAccountOp?.accountOp ?? null;
        if (!accOp)
            return undefined;
        const network = this.networks.networks.find((net) => net.id === accOp.networkId);
        if (!network)
            return undefined; // shouldn't happen
        const account = this.accounts.accounts.find((x) => x.addr === accOp.accountAddr);
        if (!account)
            return undefined; // shouldn't happen
        const is4337 = (0, userOperation_1.isErc4337Broadcast)(account, network, this.accounts.accountStates[accOp.accountAddr][accOp.networkId]);
        const bundler = this.signAccountOp
            ? this.signAccountOp.bundlerSwitcher.getBundler()
            : (0, getBundler_1.getDefaultBundler)(network);
        const bundlerFetch = async () => {
            if (!is4337)
                return null;
            const errorCallback = (e) => {
                if (!this.signAccountOp)
                    return;
                this.emitError(e);
            };
            return bundler.fetchGasPrices(network, errorCallback).catch((e) => {
                this.emitError({
                    level: 'silent',
                    message: "Failed to fetch the bundler's gas price",
                    error: e
                });
            });
        };
        const [gasPriceData, bundlerGas] = await Promise.all([
            (0, gasPrice_1.getGasPriceRecommendations)(this.providers.providers[network.id], network).catch((e) => {
                this.emitError({
                    level: 'major',
                    message: `Unable to get gas price for ${network.id}`,
                    error: new Error(`Failed to fetch gas price: ${e?.message}`)
                });
                return null;
            }),
            bundlerFetch()
        ]);
        if (gasPriceData && gasPriceData.gasPrice)
            this.gasPrices[network.id] = gasPriceData.gasPrice;
        if (bundlerGas)
            this.bundlerGasPrices[network.id] = { speeds: bundlerGas, bundler: bundler.getName() };
        return {
            blockGasLimit: gasPriceData?.blockGasLimit
        };
    }
    async updateSignAccountOpGasPrice() {
        if (!this.signAccountOp)
            return;
        const accOp = this.signAccountOp.accountOp;
        const gasData = await this.#updateGasPrice();
        // there's a chance signAccountOp gets destroyed between the time
        // the first "if (!this.signAccountOp) return" is performed and
        // the time we get here. To prevent issues, we check one more time
        if (!this.signAccountOp)
            return;
        this.signAccountOp.update({
            gasPrices: this.gasPrices[accOp.networkId],
            bundlerGasPrices: this.bundlerGasPrices[accOp.networkId],
            blockGasLimit: gasData && gasData.blockGasLimit ? gasData.blockGasLimit : undefined
        });
        this.emitUpdate();
    }
    // @TODO: protect this from race conditions/simultanous executions
    async estimateSignAccountOp() {
        try {
            if (!this.signAccountOp)
                return;
            // make a local copy to avoid updating the main reference
            const localAccountOp = { ...this.signAccountOp.accountOp };
            await this.#initialLoadPromise;
            // new accountOps should have spoof signatures so that they can be easily simulated
            // this is not used by the Estimator, because it iterates through all associatedKeys and
            // it knows which ones are authenticated, and it can generate it's own spoofSig
            // @TODO
            // accountOp.signature = `${}03`
            // TODO check if needed data in accountStates are available
            // this.accountStates[accountOp.accountAddr][accountOp.networkId].
            const account = this.accounts.accounts.find((x) => x.addr === localAccountOp.accountAddr);
            // Here, we list EOA accounts for which you can also obtain an estimation of the AccountOp payment.
            // In the case of operating with a smart account (an account with creation code), all other EOAs can pay the fee.
            //
            // If the current account is an EOA, only this account can pay the fee,
            // and there's no need for checking other EOA accounts native balances.
            // This is already handled and estimated as a fee option in the estimate library, which is why we pass an empty array here.
            //
            // we're excluding the view only accounts from the natives to check
            // in all cases EXCEPT the case where we're making an estimation for
            // the view only account itself. In all other, view only accounts options
            // should not be present as the user cannot pay the fee with them (no key)
            const nativeToCheck = account?.creation
                ? this.accounts.accounts
                    .filter((acc) => !(0, account_1.isSmartAccount)(acc) &&
                    (acc.addr === localAccountOp.accountAddr ||
                        !(0, accounts_1.getIsViewOnly)(this.keystore.keys, acc.associatedKeys)))
                    .map((acc) => acc.addr)
                : [];
            if (!account)
                throw new Error(`estimateSignAccountOp: ${localAccountOp.accountAddr}: account does not exist`);
            const network = this.networks.networks.find((x) => x.id === localAccountOp.networkId);
            if (!network)
                throw new Error(`estimateSignAccountOp: ${localAccountOp.networkId}: network does not exist`);
            // Take the fee tokens from two places: the user's tokens and his gasTank
            // The gasTank tokens participate on each network as they belong everywhere
            // NOTE: at some point we should check all the "?" signs below and if
            // an error pops out, we should notify the user about it
            const networkFeeTokens = this.portfolio.getLatestPortfolioState(localAccountOp.accountAddr)?.[localAccountOp.networkId]?.result?.feeTokens ?? [];
            const gasTankFeeTokens = this.portfolio.getLatestPortfolioState(localAccountOp.accountAddr)?.gasTank?.result
                ?.tokens ?? [];
            const feeTokens = [...networkFeeTokens, ...gasTankFeeTokens].filter((t) => t.flags.isFeeToken) || [];
            // can be read from the UI
            const humanization = (0, humanizer_1.humanizeAccountOp)(localAccountOp, {});
            humanization.forEach((call) => {
                if (!call.fullVisualization)
                    return;
                call.fullVisualization.forEach(async (visualization) => {
                    if (visualization.type !== 'address' || !visualization.address)
                        return;
                    await this.domains.reverseLookup(visualization.address);
                });
            });
            const additionalHints = humanization
                .map((call) => !call.fullVisualization
                ? []
                : call.fullVisualization.map((vis) => vis.address && (0, ethers_1.isAddress)(vis.address) ? (0, ethers_1.getAddress)(vis.address) : ''))
                .flat()
                .filter((x) => (0, ethers_1.isAddress)(x));
            this.portfolio.addTokensToBeLearned(additionalHints, network.id);
            const accountOpsToBeSimulatedByNetwork = (0, main_1.getAccountOpsForSimulation)(account, this.actions.visibleActionsQueue, network, this.signAccountOp.accountOp);
            const [, estimation] = await Promise.all([
                // NOTE: we are not emitting an update here because the portfolio controller will do that
                // NOTE: the portfolio controller has it's own logic of constructing/caching providers, this is intentional, as
                // it may have different needs
                this.portfolio.updateSelectedAccount(localAccountOp.accountAddr, network, accountOpsToBeSimulatedByNetwork, { forceUpdate: true }),
                (0, estimate_1.estimate)(this.providers.providers[localAccountOp.networkId], network, account, localAccountOp, this.accounts.accountStates, nativeToCheck, 
                // @TODO - first time calling this, portfolio is still not loaded.
                feeTokens, (e) => {
                    if (!this.signAccountOp)
                        return;
                    this.emitError(e);
                }, this.signAccountOp.bundlerSwitcher, {
                    is4337Broadcast: (0, userOperation_1.isErc4337Broadcast)(account, network, this.accounts.accountStates[localAccountOp.accountAddr][localAccountOp.networkId])
                }).catch((e) => {
                    const { message } = (0, errorHumanizer_1.getHumanReadableEstimationError)(e);
                    this.emitError({
                        level: 'major',
                        message,
                        error: e
                    });
                    return null;
                })
            ]);
            // @race
            // if the signAccountOp has been deleted, don't continue as the request has already finished
            if (!this.signAccountOp)
                return;
            if (estimation) {
                const currentNonceAhead = BigInt(estimation.currentAccountNonce) > (localAccountOp.nonce ?? 0n);
                // if the nonce from the estimation is bigger than the one in localAccountOp,
                // override the accountState and accountOp with the newly detected nonce
                if (currentNonceAhead) {
                    localAccountOp.nonce = BigInt(estimation.currentAccountNonce);
                    this.signAccountOp.accountOp.nonce = BigInt(estimation.currentAccountNonce);
                    if (this.accounts.accountStates?.[localAccountOp.accountAddr]?.[localAccountOp.networkId])
                        this.accounts.accountStates[localAccountOp.accountAddr][localAccountOp.networkId].nonce = localAccountOp.nonce;
                }
                const hasNonceDiscrepancy = estimation.error?.cause === 'NONCE_FAILURE';
                const lastTxn = this.activity.getLastTxn(localAccountOp.networkId);
                const SAHasOldNonceOnARelayerNetwork = (0, account_1.isSmartAccount)(account) &&
                    !network.erc4337.enabled &&
                    lastTxn &&
                    localAccountOp.nonce === lastTxn.nonce &&
                    lastTxn.success &&
                    lastTxn.status === accountOp_1.AccountOpStatus.Success;
                if (hasNonceDiscrepancy || SAHasOldNonceOnARelayerNetwork) {
                    this.accounts
                        .updateAccountState(localAccountOp.accountAddr, 'pending', [localAccountOp.networkId])
                        .then(() => this.estimateSignAccountOp())
                        .catch((error) => this.emitError({
                        level: 'major',
                        message: 'Failed to refetch the account state. Please try again to initialize your transaction',
                        error
                    }));
                    return;
                }
            }
            if (estimation &&
                estimation.nonFatalErrors &&
                estimation.nonFatalErrors.find((err) => err.cause === '4337_INVALID_NONCE') &&
                this.accounts.accountStates?.[localAccountOp.accountAddr]?.[localAccountOp.networkId]) {
                this.accounts
                    .updateAccountState(localAccountOp.accountAddr, 'pending', [localAccountOp.networkId])
                    .then(() => this.estimateSignAccountOp())
                    .catch((error) => this.emitError({
                    level: 'major',
                    message: 'Failed to refetch the account state. Please try again to initialize your transaction',
                    error
                }));
                // returning here means estimation will not be set => better UX as
                // the user will not see the warning but instead
                // just wait for the new estimation
                return;
            }
            // check if an RBF should be applied for the incoming transaction
            // for SA conditions are: take the last broadcast but not confirmed accOp
            // and check if the nonce is the same as the current nonce (non 4337 txns)
            // for EOA: check the last broadcast but not confirmed txn across SA
            // as the EOA could've broadcast a txn there + it's own history and
            // compare the highest found nonce
            const rbfAccountOps = {};
            nativeToCheck.push(localAccountOp.accountAddr);
            nativeToCheck.forEach((accId) => {
                const notConfirmedOp = this.activity.getNotConfirmedOpIfAny(accId, localAccountOp.networkId);
                // the accountState of the nativeToCheck may no be initialized
                const currentNonce = this.accounts.accountStates &&
                    this.accounts.accountStates[accId] &&
                    this.accounts.accountStates[accId][localAccountOp.networkId]
                    ? this.accounts.accountStates[accId][localAccountOp.networkId].nonce
                    : null;
                rbfAccountOps[accId] =
                    notConfirmedOp &&
                        !notConfirmedOp.gasFeePayment?.isERC4337 &&
                        currentNonce &&
                        currentNonce === notConfirmedOp.nonce
                        ? notConfirmedOp
                        : null;
            });
            // if there's an estimation error, override the pending results
            if (estimation && estimation.error) {
                this.portfolio.overridePendingResults(localAccountOp);
            }
            // update the signAccountOp controller once estimation finishes;
            // this eliminates the infinite loading bug if the estimation comes slower
            if (this.signAccountOp && estimation) {
                this.signAccountOp.update({ estimation, rbfAccountOps });
            }
        }
        catch (error) {
            this.signAccountOp?.calculateWarnings();
            this.emitError({
                level: 'silent',
                message: 'Estimation error',
                error
            });
        }
    }
    /**
     * There are 4 ways to broadcast an AccountOp:
     *   1. For basic accounts (EOA), there is only one way to do that. After
     *   signing the transaction, the serialized signed transaction object gets
     *   send to the network.
     *   2. For smart accounts, when EOA pays the fee. Two signatures are needed
     *   for this. The first one is the signature of the AccountOp itself. The
     *   second one is the signature of the transaction that will be executed
     *   by the smart account.
     *   3. For smart accounts that broadcast the ERC-4337 way.
     *   4. for smart accounts, when the Relayer does the broadcast.
     *
     */
    async #broadcastSignedAccountOp() {
        const accountOp = this.signAccountOp?.accountOp;
        const estimation = this.signAccountOp?.estimation;
        const actionId = this.signAccountOp?.fromActionId;
        const bundlerSwitcher = this.signAccountOp?.bundlerSwitcher;
        const contactSupportPrompt = 'Please try again or contact support if the problem persists.';
        if (!accountOp ||
            !estimation ||
            !actionId ||
            !accountOp.signingKeyAddr ||
            !accountOp.signingKeyType ||
            !accountOp.signature ||
            !bundlerSwitcher) {
            const message = `Missing mandatory transaction details. ${contactSupportPrompt}`;
            return this.throwBroadcastAccountOp({ message });
        }
        const provider = this.providers.providers[accountOp.networkId];
        const account = this.accounts.accounts.find((acc) => acc.addr === accountOp.accountAddr);
        const network = this.networks.networks.find((n) => n.id === accountOp.networkId);
        if (!provider) {
            const networkName = network?.name || `network with id ${accountOp.networkId}`;
            const message = `Provider for ${networkName} not found. ${contactSupportPrompt}`;
            return this.throwBroadcastAccountOp({ message });
        }
        if (!account) {
            const addr = (0, shortenAddress_1.default)(accountOp.accountAddr, 13);
            const message = `Account with address ${addr} not found. ${contactSupportPrompt}`;
            return this.throwBroadcastAccountOp({ message });
        }
        if (!network) {
            const message = `Network with id ${accountOp.networkId} not found. ${contactSupportPrompt}`;
            return this.throwBroadcastAccountOp({ message });
        }
        const accountState = this.accounts.accountStates[accountOp.accountAddr][accountOp.networkId];
        let transactionRes = null;
        // Basic account (EOA)
        if (!(0, account_1.isSmartAccount)(account)) {
            try {
                const feePayerKeys = this.keystore.keys.filter((key) => key.addr === accountOp.gasFeePayment.paidBy);
                const feePayerKey = 
                // Temporarily prioritize the key with the same type as the signing key.
                // TODO: Implement a way to choose the key type to broadcast with.
                feePayerKeys.find((key) => key.type === accountOp.signingKeyType) || feePayerKeys[0];
                if (!feePayerKey) {
                    const missingKeyAddr = (0, shortenAddress_1.default)(accountOp.gasFeePayment.paidBy, 13);
                    const accAddr = (0, shortenAddress_1.default)(accountOp.accountAddr, 13);
                    const message = `Key with address ${missingKeyAddr} for account with address ${accAddr} not found. ${contactSupportPrompt}`;
                    return await this.throwBroadcastAccountOp({ message, accountState });
                }
                this.feePayerKey = feePayerKey;
                this.emitUpdate();
                const signer = await this.keystore.getSigner(feePayerKey.addr, feePayerKey.type);
                if (signer.init)
                    signer.init(this.#externalSignerControllers[feePayerKey.type]);
                const gasFeePayment = accountOp.gasFeePayment;
                const { to, value, data } = accountOp.calls[0];
                const rawTxn = {
                    to: to ?? undefined,
                    value,
                    data,
                    chainId: network.chainId,
                    nonce: await provider.getTransactionCount(accountOp.accountAddr),
                    gasLimit: gasFeePayment.simulatedGasLimit
                };
                // if it's eip1559, send it as such. If no, go to legacy
                if (gasFeePayment.maxPriorityFeePerGas !== undefined) {
                    rawTxn.maxFeePerGas = gasFeePayment.gasPrice;
                    rawTxn.maxPriorityFeePerGas = gasFeePayment.maxPriorityFeePerGas;
                    rawTxn.type = 2;
                }
                else {
                    rawTxn.gasPrice = gasFeePayment.gasPrice;
                    rawTxn.type = 0;
                }
                const signedTxn = await signer.signRawTransaction(rawTxn);
                const broadcastRes = await provider.broadcastTransaction(signedTxn);
                transactionRes = {
                    txnId: broadcastRes.hash,
                    nonce: broadcastRes.nonce,
                    identifiedBy: {
                        type: 'Transaction',
                        identifier: broadcastRes.hash
                    }
                };
            }
            catch (error) {
                return this.throwBroadcastAccountOp({ error, accountState });
            }
        }
        // Smart account but EOA pays the fee
        else if (account.creation &&
            accountOp.gasFeePayment &&
            accountOp.gasFeePayment.paidBy !== account.addr) {
            const feePayerKeys = this.keystore.keys.filter((key) => key.addr === accountOp.gasFeePayment.paidBy);
            const feePayerKey = 
            // Temporarily prioritize the key with the same type as the signing key.
            // TODO: Implement a way to choose the key type to broadcast with.
            feePayerKeys.find((key) => key.type === accountOp.signingKeyType) || feePayerKeys[0];
            if (!feePayerKey) {
                const missingKeyAddr = (0, shortenAddress_1.default)(accountOp.gasFeePayment.paidBy, 13);
                const accAddr = (0, shortenAddress_1.default)(accountOp.accountAddr, 13);
                const message = `Key with address ${missingKeyAddr} for account with address ${accAddr} not found.`;
                return this.throwBroadcastAccountOp({ message, accountState });
            }
            this.feePayerKey = feePayerKey;
            this.emitUpdate();
            let data;
            let to;
            if (accountState.isDeployed) {
                const ambireAccount = new ethers_1.Interface(AmbireAccount_json_1.default.abi);
                to = accountOp.accountAddr;
                data = ambireAccount.encodeFunctionData('execute', [
                    (0, accountOp_1.getSignableCalls)(accountOp),
                    accountOp.signature
                ]);
            }
            else {
                const ambireFactory = new ethers_1.Interface(AmbireFactory_json_1.default.abi);
                to = account.creation.factoryAddr;
                data = ambireFactory.encodeFunctionData('deployAndExecute', [
                    account.creation.bytecode,
                    account.creation.salt,
                    (0, accountOp_1.getSignableCalls)(accountOp),
                    accountOp.signature
                ]);
            }
            try {
                const signer = await this.keystore.getSigner(feePayerKey.addr, feePayerKey.type);
                if (signer.init)
                    signer.init(this.#externalSignerControllers[feePayerKey.type]);
                const rawTxn = {
                    to,
                    data,
                    // We ultimately do a smart contract call, which means we don't need
                    // to send any `value` from the EOA address. The actual `value` will
                    // get taken from the value encoded in the `data` field.
                    value: BigInt(0),
                    chainId: network.chainId,
                    nonce: await provider.getTransactionCount(accountOp.gasFeePayment.paidBy),
                    gasLimit: accountOp.gasFeePayment.simulatedGasLimit
                };
                if (accountOp.gasFeePayment.maxPriorityFeePerGas !== undefined) {
                    rawTxn.maxFeePerGas = accountOp.gasFeePayment.gasPrice;
                    rawTxn.maxPriorityFeePerGas = accountOp.gasFeePayment.maxPriorityFeePerGas;
                    rawTxn.type = 2;
                }
                else {
                    rawTxn.gasPrice = accountOp.gasFeePayment.gasPrice;
                    rawTxn.type = 0;
                }
                const signedTxn = await signer.signRawTransaction(rawTxn);
                const broadcastRes = await provider.broadcastTransaction(signedTxn);
                transactionRes = {
                    txnId: broadcastRes.hash,
                    nonce: broadcastRes.nonce,
                    identifiedBy: {
                        type: 'Transaction',
                        identifier: broadcastRes.hash
                    }
                };
            }
            catch (error) {
                return this.throwBroadcastAccountOp({ error, accountState });
            }
        }
        // Smart account, the ERC-4337 way
        else if (accountOp.gasFeePayment && accountOp.gasFeePayment.isERC4337) {
            const userOperation = accountOp.asUserOperation;
            if (!userOperation) {
                const accAddr = (0, shortenAddress_1.default)(accountOp.accountAddr, 13);
                const message = `Trying to broadcast an ERC-4337 request but userOperation is not set for the account with address ${accAddr}`;
                return this.throwBroadcastAccountOp({ message, accountState });
            }
            // broadcast through bundler's service
            let userOperationHash;
            const bundler = bundlerSwitcher.getBundler();
            try {
                userOperationHash = await bundler.broadcast(userOperation, network);
            }
            catch (e) {
                let retryMsg;
                // if the signAccountOp is still active (it should be)
                // try to switch the bundler and ask the user to try again
                // TODO: explore more error case where we switch the bundler
                if (this.signAccountOp) {
                    const decodedError = bundler.decodeBundlerError(e);
                    const humanReadable = (0, errorHumanizer_1.getHumanReadableBroadcastError)(decodedError);
                    const switcher = this.signAccountOp.bundlerSwitcher;
                    this.signAccountOp.updateStatus(signAccountOp_1.SigningStatus.ReadyToSign);
                    if (switcher.canSwitch(humanReadable)) {
                        switcher.switch();
                        this.estimateSignAccountOp();
                        this.#updateGasPrice();
                        retryMsg = 'Broadcast failed because bundler was down. Please try again';
                    }
                }
                return this.throwBroadcastAccountOp({
                    error: e,
                    accountState,
                    provider,
                    network,
                    message: retryMsg
                });
            }
            if (!userOperationHash) {
                return this.throwBroadcastAccountOp({
                    message: 'Bundler broadcast failed. Please try broadcasting by an EOA or contact support.'
                });
            }
            transactionRes = {
                nonce: Number(userOperation.nonce),
                identifiedBy: {
                    type: 'UserOperation',
                    identifier: userOperationHash,
                    bundler: bundler.getName()
                }
            };
        }
        // Smart account, the Relayer way
        else {
            try {
                const body = {
                    gasLimit: Number(accountOp.gasFeePayment.simulatedGasLimit),
                    txns: (0, accountOp_1.getSignableCalls)(accountOp),
                    signature: accountOp.signature,
                    signer: { address: accountOp.signingKeyAddr },
                    nonce: Number(accountOp.nonce)
                };
                const additionalRelayerNetwork = networks_1.relayerAdditionalNetworks.find((net) => net.chainId === network.chainId);
                const relayerNetworkId = additionalRelayerNetwork
                    ? additionalRelayerNetwork.name
                    : accountOp.networkId;
                const response = await this.callRelayer(`/identity/${accountOp.accountAddr}/${relayerNetworkId}/submit`, 'POST', body);
                if (!response.success)
                    throw new Error(response.message);
                transactionRes = {
                    txnId: response.txId,
                    nonce: Number(accountOp.nonce),
                    identifiedBy: {
                        type: 'Relayer',
                        identifier: response.id
                    }
                };
            }
            catch (error) {
                return this.throwBroadcastAccountOp({ error, accountState, isRelayer: true });
            }
        }
        if (!transactionRes)
            return this.throwBroadcastAccountOp({
                message: 'No transaction response received after being broadcasted.'
            });
        this.portfolio.markSimulationAsBroadcasted(account.addr, network.id);
        const submittedAccountOp = {
            ...accountOp,
            status: accountOp_1.AccountOpStatus.BroadcastedButNotConfirmed,
            txnId: transactionRes.txnId,
            nonce: BigInt(transactionRes.nonce),
            identifiedBy: transactionRes.identifiedBy,
            timestamp: new Date().getTime(),
            isSingletonDeploy: !!accountOp.calls.find((call) => call.to && (0, ethers_1.getAddress)(call.to) === deploy_1.SINGLETON)
        };
        await this.activity.addAccountOp(submittedAccountOp);
        this.swapAndBridge.handleUpdateActiveRouteOnSubmittedAccountOpStatusUpdate(submittedAccountOp);
        await this.resolveAccountOpAction({
            networkId: network.id,
            isUserOp: !!accountOp?.asUserOperation,
            submittedAccountOp
        }, actionId);
        await this.#notificationManager.create({
            title: 'Done!',
            message: 'The transaction was successfully signed and broadcasted to the network.'
        });
        return Promise.resolve(submittedAccountOp);
    }
    // ! IMPORTANT !
    // Banners that depend on async data from sub-controllers should be implemented
    // in the sub-controllers themselves. This is because updates in the sub-controllers
    // will not trigger emitUpdate in the MainController, therefore the banners will
    // remain the same until a subsequent update in the MainController.
    get banners() {
        if (!this.selectedAccount.account || !this.networks.isInitialized)
            return [];
        const activeSwapAndBridgeRoutesForSelectedAccount = (0, swapAndBridge_1.getActiveRoutesForAccount)(this.selectedAccount.account.addr, this.swapAndBridge.activeRoutes);
        const swapAndBridgeRoutesPendingSignature = activeSwapAndBridgeRoutesForSelectedAccount.filter((r) => r.routeStatus === 'ready');
        const accountOpBanners = (0, banners_1.getAccountOpBanners)({
            accountOpActionsByNetwork: (0, actions_1.getAccountOpActionsByNetwork)(this.selectedAccount.account.addr, this.actions.actionsQueue),
            selectedAccount: this.selectedAccount.account.addr,
            accounts: this.accounts.accounts,
            networks: this.networks.networks,
            swapAndBridgeRoutesPendingSignature
        });
        return [...accountOpBanners];
    }
    // Technically this is an anti-pattern, but it's the only way to
    // test the error handling in the method.
    throwBroadcastAccountOp({ message: humanReadableMessage, error: _err, accountState, isRelayer = false, provider = undefined, network = undefined }) {
        const originalMessage = _err?.message;
        let message = humanReadableMessage;
        let isReplacementFeeLow = false;
        if (originalMessage) {
            if (originalMessage.includes('replacement fee too low')) {
                message =
                    'Replacement fee is insufficient. Fees have been automatically adjusted so please try submitting your transaction again.';
                isReplacementFeeLow = true;
                this.estimateSignAccountOp();
            }
            else if (originalMessage.includes('pimlico_getUserOperationGasPrice') ||
                originalMessage.includes('preVerificationGas')) {
                message =
                    'Transaction fee underpriced. Please select a higher transaction speed and try again';
                this.updateSignAccountOpGasPrice();
            }
            else if (originalMessage.includes('INSUFFICIENT_PRIVILEGE')) {
                message = `Signer key not supported on this network.${!accountState?.isV2
                    ? 'You can add/change signers from the web wallet or contact support.'
                    : 'Please contact support.'}`;
            }
            else if (originalMessage.includes('underpriced')) {
                message =
                    'Transaction fee underpriced. Please select a higher transaction speed and try again';
                this.updateSignAccountOpGasPrice();
                this.estimateSignAccountOp();
            }
            else if (originalMessage.includes('Failed to fetch') && isRelayer) {
                message =
                    'Currently, the Ambire relayer seems to be down. Please try again a few moments later or broadcast with a Basic Account';
            }
        }
        if (!message) {
            message = (0, errorHumanizer_1.getHumanReadableBroadcastError)(_err || new Error('')).message;
            // if the message states that the paymaster doesn't have sufficient amount,
            // add it to the failedPaymasters to disable it until a top-up is made
            if (message.includes(errors_1.insufficientPaymasterFunds) && provider && network) {
                FailedPaymasters_1.failedPaymasters.addInsufficientFunds(provider, network).then(() => {
                    this.estimateSignAccountOp();
                });
            }
        }
        // To enable another try for signing in case of broadcast fail
        // broadcast is called in the FE only after successful signing
        this.signAccountOp?.updateStatus(signAccountOp_1.SigningStatus.ReadyToSign, isReplacementFeeLow);
        this.feePayerKey = null;
        return Promise.reject(new EmittableError_1.default({ level: 'major', message, error: _err || new Error(message) }));
    }
    get isSignRequestStillActive() {
        if (!this.signAccountOp)
            return false;
        return !!this.actions.actionsQueue.find((a) => a.id === this.signAccountOp.fromActionId);
    }
    // includes the getters in the stringified instance
    toJSON() {
        return {
            ...this,
            ...super.toJSON(),
            banners: this.banners,
            isSignRequestStillActive: this.isSignRequestStillActive
        };
    }
}
exports.MainController = MainController;
//# sourceMappingURL=main.js.map