"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MainController = void 0;
const tslib_1 = require("tslib");
/* eslint-disable @typescript-eslint/brace-style */
const eth_rpc_errors_1 = require("eth-rpc-errors");
const EmittableError_1 = tslib_1.__importDefault(require("../../classes/EmittableError"));
const deploy_1 = require("../../consts/deploy");
const derivation_1 = require("../../consts/derivation");
const humanizerInfo_json_1 = tslib_1.__importDefault(require("../../consts/humanizer/humanizerInfo.json"));
const intervals_1 = require("../../consts/intervals");
const accountPicker_1 = require("../accountPicker/accountPicker");
const accounts_1 = require("../accounts/accounts");
const activity_1 = require("../activity/activity");
const addressBook_1 = require("../addressBook/addressBook");
const autoLogin_1 = require("../autoLogin/autoLogin");
const banner_1 = require("../banner/banner");
const continuousUpdates_1 = require("../continuousUpdates/continuousUpdates");
const contractInfo_1 = require("../contractInfo/contractInfo");
const contractNames_1 = require("../contractNames/contractNames");
const dapps_1 = require("../dapps/dapps");
const domains_1 = require("../domains/domains");
const emailVault_1 = require("../emailVault/emailVault");
const types_1 = require("../estimation/types");
const eventEmitter_1 = tslib_1.__importDefault(require("../eventEmitter/eventEmitter"));
const featureFlags_1 = require("../featureFlags/featureFlags");
const invite_1 = require("../invite/invite");
const keystore_1 = require("../keystore/keystore");
const networks_1 = require("../networks/networks");
const phishing_1 = require("../phishing/phishing");
const portfolio_1 = require("../portfolio/portfolio");
const providers_1 = require("../providers/providers");
const requests_1 = require("../requests/requests");
const safe_1 = require("../safe/safe");
const selectedAccount_1 = require("../selectedAccount/selectedAccount");
const signMessage_1 = require("../signMessage/signMessage");
const storage_1 = require("../storage/storage");
const survey_1 = require("../survey/survey");
const swapAndBridge_1 = require("../swapAndBridge/swapAndBridge");
const transactionManager_1 = require("../transaction/transactionManager");
const transfer_1 = require("../transfer/transfer");
const transfersScanner_1 = require("../transfersScanner/transfersScanner");
const ui_1 = require("../ui/ui");
const main_1 = require("../../interfaces/main");
const signMessage_2 = require("../../interfaces/signMessage");
const account_1 = require("../../libs/account/account");
const submittedAccountOp_1 = require("../../libs/accountOp/submittedAccountOp");
const types_2 = require("../../libs/accountOp/types");
const keyIterator_1 = require("../../libs/keyIterator/keyIterator");
const keys_1 = require("../../libs/keys/keys");
const relayerCall_1 = require("../../libs/relayerCall/relayerCall");
const safe_2 = require("../../libs/safe/safe");
const selectedAccount_2 = require("../../libs/selectedAccount/selectedAccount");
const api_1 = require("../../services/lifi/api");
const paymaster_1 = require("../../services/paymaster");
const api_2 = require("../../services/socket/api");
const api_3 = require("../../services/squid/api");
const swapProviderParallelExecutor_1 = require("../../services/swapIntegrators/swapProviderParallelExecutor");
const hdPath_1 = require("../../utils/hdPath");
const wait_1 = tslib_1.__importDefault(require("../../utils/wait"));
class MainController extends eventEmitter_1.default {
    #storageAPI;
    #appVersion;
    fetch;
    // Holds the initial load promise, so that one can wait until it completes
    initialLoadPromise;
    callRelayer;
    isReady = false;
    /**
     * Hardware wallets (usually) need an additional (external signer) controller,
     * that is app-specific (web, mobile) and is used to interact with the device.
     * (example: LedgerController, TrezorController, LatticeController)
     */
    #externalSignerControllers = {};
    // sub-controllers
    storage;
    featureFlags;
    invite;
    keystore;
    networks;
    providers;
    accountPicker;
    portfolio;
    dapps;
    phishing;
    emailVault;
    signMessage;
    swapAndBridge;
    transactionManager;
    transfer;
    signAccOpInitError = null;
    activity;
    transferScanner;
    addressBook;
    domains;
    contractNames;
    contractInfo;
    autoLogin;
    accounts;
    selectedAccount;
    requests;
    banner;
    survey;
    accountOpsToBeConfirmed = {};
    lastUpdate = new Date();
    isOffline = false;
    statuses = main_1.STATUS_WRAPPED_METHODS;
    ui;
    #continuousUpdates;
    safe;
    get continuousUpdates() {
        return this.#continuousUpdates;
    }
    constructor({ eventEmitterRegistry, appVersion, platform, storageAPI, fetch, relayerUrl, velcroUrl, liFiApiKey, bungeeApiKey, squidIntegratorId, featureFlags, keystoreSigners, externalSignerControllers, uiManager }) {
        super(eventEmitterRegistry);
        this.#storageAPI = storageAPI;
        this.#appVersion = appVersion;
        this.fetch = fetch;
        this.storage = new storage_1.StorageController(this.#storageAPI, eventEmitterRegistry);
        this.featureFlags = new featureFlags_1.FeatureFlagsController(featureFlags, this.storage, eventEmitterRegistry);
        this.ui = new ui_1.UiController({ eventEmitterRegistry, uiManager });
        this.invite = new invite_1.InviteController({
            eventEmitterRegistry,
            relayerUrl,
            fetch,
            storage: this.storage
        });
        this.keystore = new keystore_1.KeystoreController(platform, this.storage, keystoreSigners, this.ui, eventEmitterRegistry);
        this.#externalSignerControllers = externalSignerControllers;
        this.networks = new networks_1.NetworksController({
            eventEmitterRegistry,
            defaultNetworksMode: this.featureFlags.isFeatureEnabled('testnetMode')
                ? 'testnet'
                : 'mainnet',
            storage: this.storage,
            fetch,
            relayerUrl,
            useTempProvider: async (props, callback) => {
                await this.providers.useTempProvider(props, callback);
            },
            onAddOrUpdateNetworks: async (networks) => {
                networks.forEach((n) => n.disabled && this.removeNetworkData(n.chainId));
                networks.filter((net) => !net.disabled).forEach((n) => this.providers.setProvider(n));
                await this.reloadSelectedAccount({ chainIds: networks.map((n) => n.chainId) });
            },
            onReady: async () => {
                await this.providers.init({ networks: this.networks.allNetworks });
            }
        });
        this.providers = new providers_1.ProvidersController({
            eventEmitterRegistry,
            storage: this.storage,
            getNetworks: () => this.networks.allNetworks,
            sendUiMessage: this.ui.message.sendUiMessage
        });
        this.accounts = new accounts_1.AccountsController(this.storage, this.providers, this.networks, this.keystore, async (accounts) => {
            const defaultSelectedAccount = (0, account_1.getDefaultSelectedAccount)(accounts);
            if (defaultSelectedAccount) {
                await this.#selectAccount(defaultSelectedAccount.addr);
            }
        }, this.providers.updateProviderIsWorking.bind(this.providers), this.#updateIsOffline.bind(this), relayerUrl, this.fetch, eventEmitterRegistry);
        this.autoLogin = new autoLogin_1.AutoLoginController(this.storage, this.keystore, this.providers, this.networks, this.accounts, this.#externalSignerControllers, this.invite, eventEmitterRegistry);
        this.safe = new safe_1.SafeController({
            eventEmitterRegistry,
            networks: this.networks,
            providers: this.providers,
            storage: this.storage,
            accounts: this.accounts
        });
        this.survey = new survey_1.SurveyController({
            fetch: this.fetch,
            relayerUrl,
            storage: this.storage,
            ui: this.ui,
            eventEmitterRegistry,
            dismissBanner: (bannerId) => {
                this.banner.dismissBanner(bannerId);
            }
        });
        this.banner = new banner_1.BannerController(this.storage, () => {
            const currentSelectedAcc = this.selectedAccount.account;
            if (!currentSelectedAcc)
                return { status: 'no-selected-account' };
            let totalUsdBalance = this.selectedAccount.portfolio.totalBalance;
            let numberOfTransactions = this.activity.getAccountOpsForAccount({
                accountAddr: currentSelectedAcc.addr,
                sortAccOps: false
            }).length;
            const hasKeys = (0, keys_1.getAccountKeysCount)({
                accountAddr: currentSelectedAcc.addr,
                keys: this.keystore.keys,
                accounts: this.accounts.accounts
            }) > 0;
            return {
                status: 'has-selected-account',
                numberOfTransactions,
                totalUsdBalance,
                hasKeys,
                address: currentSelectedAcc.addr,
                isBalanceReady: this.selectedAccount.portfolio.isAllReady
            };
        }, this.survey, this.#appVersion, eventEmitterRegistry);
        this.selectedAccount = new selectedAccount_1.SelectedAccountController({
            eventEmitterRegistry,
            storage: this.storage,
            accounts: this.accounts,
            autoLogin: this.autoLogin,
            banner: this.banner
        });
        this.portfolio = new portfolio_1.PortfolioController(this.storage, this.fetch, this.providers, this.networks, this.accounts, this.keystore, relayerUrl, velcroUrl, this.banner, this.featureFlags, eventEmitterRegistry);
        if (this.featureFlags.isFeatureEnabled('withEmailVaultController')) {
            this.emailVault = new emailVault_1.EmailVaultController(this.storage, this.fetch, relayerUrl, this.keystore, undefined, eventEmitterRegistry);
        }
        this.accountPicker = new accountPicker_1.AccountPickerController({
            eventEmitterRegistry,
            accounts: this.accounts,
            keystore: this.keystore,
            networks: this.networks,
            providers: this.providers,
            externalSignerControllers: this.#externalSignerControllers,
            relayerUrl,
            fetch: this.fetch,
            /**
             * callback that gets triggered as a finalization step of adding new
             * accounts via the AccountPickerController.
             *
             * VIEW-ONLY ACCOUNTS: In case of changes in this method, make sure these
             * changes are reflected for view-only accounts as well. Because the
             * view-only accounts import flow bypasses the AccountPicker, this method
             * won't click for them.
             */
            onAddAccountsSuccessCallback: this.#onAccountPickerSuccess.bind(this)
        });
        this.addressBook = new addressBook_1.AddressBookController(this.storage, this.accounts, this.selectedAccount, eventEmitterRegistry);
        this.phishing = new phishing_1.PhishingController({
            eventEmitterRegistry,
            fetch: this.fetch,
            storage: this.storage,
            addressBook: this.addressBook,
            ui: this.ui
        });
        this.dapps = new dapps_1.DappsController({
            eventEmitterRegistry,
            appVersion: this.#appVersion,
            fetch: this.fetch,
            storage: this.storage,
            networks: this.networks,
            phishing: this.phishing,
            ui: this.ui
        });
        this.signMessage = new signMessage_1.SignMessageController(this.keystore, this.providers, this.networks, this.accounts, this.#externalSignerControllers, this.invite, eventEmitterRegistry, this.dapps);
        this.callRelayer = relayerCall_1.relayerCall.bind({ url: relayerUrl, fetch: this.fetch });
        this.activity = new activity_1.ActivityController(this.storage, this.fetch, this.callRelayer, this.accounts, this.selectedAccount, this.providers, this.networks, this.portfolio, this.safe, async (network) => {
            await this.setContractsDeployedToTrueIfDeployed(network);
        }, eventEmitterRegistry);
        this.transferScanner = new transfersScanner_1.TransfersScannerController({
            activity: this.activity,
            networks: this.networks,
            portfolio: this.portfolio,
            providers: this.providers,
            eventEmitterRegistry
        });
        const LiFiProvider = new api_1.LiFiAPI({ fetch, apiKey: liFiApiKey });
        const SocketProvider = new api_2.SocketAPI({ fetch, apiKey: bungeeApiKey });
        const SquidProvider = new api_3.SquidAPI({ fetch, integratorId: squidIntegratorId });
        this.swapAndBridge = new swapAndBridge_1.SwapAndBridgeController({
            eventEmitterRegistry,
            callRelayer: this.callRelayer,
            accounts: this.accounts,
            keystore: this.keystore,
            portfolio: this.portfolio,
            externalSignerControllers: this.#externalSignerControllers,
            providers: this.providers,
            selectedAccount: this.selectedAccount,
            networks: this.networks,
            activity: this.activity,
            storage: this.storage,
            phishing: this.phishing,
            dapps: this.dapps,
            swapProvider: new swapProviderParallelExecutor_1.SwapProviderParallelExecutor([LiFiProvider, SocketProvider, SquidProvider]),
            relayerUrl,
            portfolioUpdate: (chainsToUpdate) => {
                if (chainsToUpdate.length) {
                    const networks = chainsToUpdate
                        ? this.networks.networks.filter((n) => chainsToUpdate.includes(n.chainId))
                        : undefined;
                    this.updateSelectedAccountPortfolio({ networks });
                }
            },
            isCurrentSignAccountOpThrowingAnEstimationError: (fromChainId, toChainId) => {
                const signAccountOp = this.requests.currentUserRequest?.kind === 'calls'
                    ? this.requests.currentUserRequest.signAccountOp
                    : undefined;
                return (signAccountOp &&
                    fromChainId &&
                    toChainId &&
                    signAccountOp.estimation.status === types_1.EstimationStatus.Error &&
                    signAccountOp.accountOp.chainId === BigInt(fromChainId) &&
                    fromChainId === toChainId);
            },
            getUserRequests: () => this.requests.userRequests || [],
            getVisibleUserRequests: () => this.requests.visibleUserRequests || [],
            onBroadcastSuccess: this.commonHandlerForBroadcastSuccess.bind(this),
            onBroadcastFailed: this.#handleBroadcastFailed.bind(this),
            ui: this.ui
        });
        this.transfer = new transfer_1.TransferController(this.callRelayer, this.storage, humanizerInfo_json_1.default, this.selectedAccount, this.networks, this.addressBook, this.accounts, this.keystore, this.portfolio, this.activity, this.#externalSignerControllers, this.providers, this.phishing, this.dapps, relayerUrl, this.commonHandlerForBroadcastSuccess.bind(this), this.ui, eventEmitterRegistry);
        this.domains = new domains_1.DomainsController({
            eventEmitterRegistry,
            providers: this.providers.providers,
            defaultNetworksMode: this.networks.defaultNetworksMode
        });
        this.contractNames = new contractNames_1.ContractNamesController({
            eventEmitterRegistry,
            fetch: this.fetch
        });
        if (this.featureFlags.isFeatureEnabled('withTransactionManagerController')) {
            // TODO: [WIP] - The manager should be initialized with transfer and swap and bridge controller dependencies.
            this.transactionManager = new transactionManager_1.TransactionManagerController({
                eventEmitterRegistry,
                accounts: this.accounts,
                keystore: this.keystore,
                portfolio: this.portfolio,
                externalSignerControllers: this.#externalSignerControllers,
                providers: this.providers,
                selectedAccount: this.selectedAccount,
                networks: this.networks,
                activity: this.activity,
                invite: this.invite,
                // TODO<Bobby>: will need help configuring this once the plan forward is clear
                serviceProviderAPI: LiFiProvider,
                storage: this.storage,
                portfolioUpdate: this.updateSelectedAccountPortfolio.bind(this)
            });
        }
        this.requests = new requests_1.RequestsController({
            eventEmitterRegistry,
            relayerUrl,
            callRelayer: this.callRelayer,
            portfolio: this.portfolio,
            externalSignerControllers: this.#externalSignerControllers,
            activity: this.activity,
            phishing: this.phishing,
            dapps: this.dapps,
            accounts: this.accounts,
            networks: this.networks,
            providers: this.providers,
            selectedAccount: this.selectedAccount,
            keystore: this.keystore,
            transfer: this.transfer,
            swapAndBridge: this.swapAndBridge,
            ui: this.ui,
            safe: this.safe,
            transactionManager: this.transactionManager,
            autoLogin: this.autoLogin,
            getDapp: async (id) => {
                await this.dapps.initialLoadPromise;
                return this.dapps.getDapp(id);
            },
            updateSelectedAccountPortfolio: async (networks) => {
                await this.updateSelectedAccountPortfolio({ networks });
            },
            addTokensToBeLearned: this.portfolio.addTokensToBeLearned.bind(this.portfolio),
            onSetCurrentUserRequest: (currentRequest) => {
                // eslint-disable-next-line @typescript-eslint/no-floating-promises
                this.dapps.setDappToConnectIfNeeded(currentRequest);
            },
            onBroadcastSuccess: async (props) => {
                const { submittedAccountOp, fromRequestId } = props;
                this.portfolio.markSimulationAsBroadcasted(submittedAccountOp.accountAddr, submittedAccountOp.chainId);
                await this.commonHandlerForBroadcastSuccess(props);
                // resolve dapp requests, open benzin and etc only if the main sign accountOp
                this.resolveAccountOpRequest(submittedAccountOp, fromRequestId);
                this.transactionManager?.formState.resetForm(); // TODO: the form should be reset in a success state in FE
            },
            onBroadcastFailed: this.#handleBroadcastFailed.bind(this)
        });
        this.contractInfo = new contractInfo_1.ContractInfoController({
            eventEmitterRegistry,
            fetch: this.fetch,
            storage: this.storage,
            featureFlags: this.featureFlags
        });
        this.initialLoadPromise = this.#load().finally(() => {
            this.initialLoadPromise = undefined;
        });
        if (this.featureFlags.isFeatureEnabled('withContinuousUpdatesController')) {
            this.#continuousUpdates = new continuousUpdates_1.ContinuousUpdatesController({
                eventEmitterRegistry,
                // Pass a read-only proxy of the main instance to ContinuousUpdatesController.
                // This gives it full access to read main’s state and call its methods,
                // but prevents any direct modification to the main state.
                main: new Proxy(this, {
                    get(target, prop, receiver) {
                        const value = Reflect.get(target, prop, receiver);
                        if (typeof value === 'function') {
                            return value.bind(target); // bind original instance to preserve `this`
                        }
                        return value;
                    },
                    set() {
                        throw new Error('Read-only');
                    }
                })
            });
        }
        paymaster_1.paymasterFactory.init(relayerUrl, fetch, (e) => {
            if (this.requests.currentUserRequest?.kind !== 'calls')
                return;
            this.emitError(e);
        });
        this.keystore.onUpdate(() => {
            if (this.keystore.statuses.unlockWithSecret === 'SUCCESS') {
                // eslint-disable-next-line @typescript-eslint/no-floating-promises
                this.storage.associateAccountKeysWithLegacySavedSeedMigration(() => new accountPicker_1.AccountPickerController({
                    eventEmitterRegistry,
                    accounts: this.accounts,
                    keystore: this.keystore,
                    networks: this.networks,
                    providers: this.providers,
                    externalSignerControllers: this.#externalSignerControllers,
                    relayerUrl,
                    fetch: this.fetch,
                    onAddAccountsSuccessCallback: async () => { }
                }), this.keystore, async () => {
                    await this.keystore.updateKeystoreKeys();
                });
                this.fetchSafeTxns().catch((e) => e); // we catch the error inside
            }
        });
        this.ui.uiEvent.on('addView', async (view) => {
            if (view.type === 'popup')
                await this.onPopupOpen(view.id);
        });
    }
    /**
     * - Updates the selected account's account state, portfolio and defi positions
     * - Calls batchReverseLookup for all accounts
     *
     * It's not a problem to call it many times consecutively as all methods have internal
     * caching mechanisms to prevent unnecessary calls.
     */
    async onPopupOpen(viewId) {
        const selectedAccountAddr = this.selectedAccount.account?.addr;
        if (selectedAccountAddr) {
            const FIVE_MINUTES = 1000 * 60 * 5;
            const ONE_HOUR = 1000 * 60 * 60;
            this.domains.batchReverseLookup(this.accounts.accounts.map((a) => a.addr));
            if (!(this.activity.broadcastedButNotConfirmed[selectedAccountAddr] || []).length) {
                this.updateSelectedAccountPortfolio({
                    maxDataAgeMs: FIVE_MINUTES,
                    maxDataAgeMsUnused: ONE_HOUR
                });
            }
            if (!this.accounts.areAccountStatesLoading) {
                this.accounts.updateAccountState(selectedAccountAddr);
            }
            this.fetchSafeTxns().catch((e) => e); // we catch the error inside
        }
        this.ui.updateView(viewId, { isReady: true });
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
        await this.portfolio.initialLoadPromise;
        await this.keystore.initialLoadPromise;
        await this.contractInfo.initialLoadPromise;
        this.selectedAccount.initControllers({
            portfolio: this.portfolio,
            networks: this.networks,
            providers: this.providers
        });
        await this.selectedAccount.initialLoadPromise;
        this.updateSelectedAccountPortfolio();
        this.domains.batchReverseLookup(this.accounts.accounts.map((a) => a.addr));
        await this.survey.initialLoadPromise;
        this.isReady = true;
        this.emitUpdate();
    }
    lock() {
        this.keystore.lock();
        this.emailVault?.cleanMagicAndSessionKeys();
        this.selectedAccount.setDashboardNetworkFilter(null);
        this.continuousUpdates?.updatePortfolioInterval.restart({
            timeout: intervals_1.LOCKED_EXTENSION_PORTFOLIO_UPDATE_INTERVAL
        });
    }
    async selectAccount(toAccountAddr) {
        await this.initialLoadPromise;
        await this.withStatus('selectAccount', async () => this.#selectAccount(toAccountAddr), true);
    }
    async #selectAccount(toAccountAddr) {
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
        // call closeRequestWindow while still on the currently selected account to allow proper
        // state cleanup of the controllers like requestsCtrl, signAccountOpCtrl, signMessageCtrl...
        if (this.requests.currentUserRequest?.kind !== 'switchAccount') {
            await this.requests.closeRequestWindow();
        }
        const swapAndBridgeSigningRequest = this.requests.visibleUserRequests.find(({ kind }) => kind === 'swapAndBridge');
        if (swapAndBridgeSigningRequest) {
            await this.requests.removeUserRequests([swapAndBridgeSigningRequest.id]);
        }
        await this.selectedAccount.setAccount(accountToSelect);
        this.#continuousUpdates?.updatePortfolioInterval.restart();
        this.#continuousUpdates?.accountStateLatestInterval.restart();
        this.#continuousUpdates?.accountsOpsStatusesInterval.restart({ runImmediately: true });
        this.swapAndBridge.updateActiveRoutesInterval.restart({ runImmediately: true });
        this.swapAndBridge.reset();
        this.transfer.reset({ destroyAccountOp: true });
        // Don't await this as it's not critical for the account selection
        // and if the user decides to quickly change to another account withStatus
        // will block the UI until these are resolved.
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.reloadSelectedAccount({
            maxDataAgeMs: 5 * 60 * 1000,
            maxDataAgeMsUnused: 60 * 60 * 1000
        });
        // forceEmitUpdate to update the getters in the FE state of the ctrls
        await Promise.all([
            this.activity.forceEmitUpdate(),
            this.requests.forceEmitUpdate(),
            this.addressBook.forceEmitUpdate(),
            this.swapAndBridge.forceEmitUpdate(),
            this.dapps.broadcastDappSessionEvent('accountsChanged', [toAccountAddr]),
            this.forceEmitUpdate()
        ]);
    }
    async #onAccountPickerSuccess() {
        if (this.keystore.isKeyIteratorInitializedWithTempSeed(this.accountPicker.keyIterator))
            await this.keystore.persistTempSeed();
        const storedSeed = await this.keystore.getKeystoreSeed(this.accountPicker.keyIterator);
        if (storedSeed) {
            await this.keystore.updateSeed({
                id: storedSeed.id,
                hdPathTemplate: this.accountPicker.hdPathTemplate
            });
            this.accountPicker.readyToAddKeys.internal = this.accountPicker.readyToAddKeys.internal.map((key) => ({ ...key, meta: { ...key.meta, fromSeedId: storedSeed.id } }));
        }
        // Should be separate (not combined in Promise.all, since firing multiple
        // keystore actions is not possible (the #wrapKeystoreAction listens for the
        // first one to finish and skips the parallel one, if one is requested).
        await this.keystore.addKeys(this.accountPicker.readyToAddKeys.internal);
        await this.keystore.addKeysExternallyStored(this.accountPicker.readyToAddKeys.external);
        if (this.accountPicker.readyToRemoveAccounts) {
            for (const acc of this.accountPicker.readyToRemoveAccounts) {
                await this.#removeAccount(acc.addr);
            }
        }
        // Add accounts as a final step, because some of the next steps check if accounts have keys.
        await this.accounts.addAccounts(this.accountPicker.readyToAddAccounts);
    }
    async commonHandlerForBroadcastSuccess({ submittedAccountOp, accountOp, fromRequestId }) {
        // add the txnIds from each transaction to each Call from the accountOp
        // if identifiedBy is MultipleTxns
        const isBasicAccountBroadcastingMultiple = submittedAccountOp.identifiedBy.type === 'MultipleTxns';
        if (isBasicAccountBroadcastingMultiple) {
            const txnIds = submittedAccountOp.identifiedBy.identifier.split('-');
            const calls = submittedAccountOp.calls.map((oneCall, i) => {
                const localCall = { ...oneCall };
                // if there's no tx id, we set it to Rejected and continue.
                // it means broadcast has failed
                if (!(i in txnIds)) {
                    localCall.status = types_2.AccountOpStatus.Rejected;
                    return localCall;
                }
                localCall.txnId = txnIds[i];
                localCall.status = types_2.AccountOpStatus.BroadcastedButNotConfirmed;
                return localCall;
            });
            submittedAccountOp.calls = calls;
            const userRequest = this.requests.userRequests.find((r) => r.id === fromRequestId);
            if (userRequest) {
                // Handle the calls that weren't signed
                const rejectedCalls = accountOp.calls.filter((call) => submittedAccountOp.calls.every((c) => c.id !== call.id));
                await this.requests.rejectCalls({ callIds: rejectedCalls.map((c) => c.id) });
            }
        }
        if (accountOp.meta?.swapTxn) {
            // we need a quote to be able to add an active route
            const quote = accountOp.meta.quote || this.swapAndBridge.quote;
            if (quote) {
                try {
                    this.swapAndBridge.addActiveRoute({
                        quote,
                        userTxIndex: accountOp.meta?.swapTxn.userTxIndex,
                        routeStatus: !!quote?.selectedRoute ? 'in-progress' : 'ready'
                    });
                    if (quote.selectedRoute) {
                        this.swapAndBridge.updateActiveRoute(quote.selectedRoute.routeId, {
                            userTxHash: submittedAccountOp.txnId,
                            identifiedBy: submittedAccountOp.identifiedBy
                        });
                    }
                }
                catch (e) {
                    console.log('failed to add an active route', e);
                }
            }
            // no need to keep it in storage
            delete accountOp.meta.quote;
        }
        this.swapAndBridge.handleUpdateActiveRouteOnSubmittedAccountOpStatusUpdate(submittedAccountOp);
        await this.activity.addAccountOp(submittedAccountOp);
        await this.ui.notification.create({
            title: 
            // different count can happen only on isBasicAccountBroadcastingMultiple
            submittedAccountOp.calls.length === accountOp.calls.length
                ? 'Done!'
                : 'Partially submitted',
            message: `${isBasicAccountBroadcastingMultiple
                ? `${submittedAccountOp.calls.length}/${accountOp.calls.length} transactions were`
                : 'The transaction was'} successfully signed and broadcast to the network.`
        });
    }
    async #handleBroadcastFailed(op) {
        // remove the active route on broadcast failure
        if (op.meta?.swapTxn)
            this.swapAndBridge.removeActiveRoute(op.meta.swapTxn.activeRouteId);
    }
    async handleSignAndBroadcastAccountOp(type, fromRequestId) {
        let signAccountOp = null;
        if (type === 'one-click-swap-and-bridge' &&
            this.swapAndBridge.signAccountOpController &&
            this.swapAndBridge.signAccountOpController.fromRequestId === fromRequestId) {
            signAccountOp = this.swapAndBridge.signAccountOpController;
        }
        else if (type === 'one-click-transfer' &&
            this.transfer.signAccountOpController &&
            this.transfer.signAccountOpController.fromRequestId === fromRequestId) {
            signAccountOp = this.transfer.signAccountOpController;
        }
        else if (this.requests.currentUserRequest?.kind === 'calls' &&
            this.requests.currentUserRequest.signAccountOp.fromRequestId === fromRequestId) {
            signAccountOp = this.requests.currentUserRequest.signAccountOp;
        }
        if (!signAccountOp) {
            return this.emitError({
                level: 'major',
                message: 'Internal error: The signing process was not initialized as expected. Please try again later or contact Ambire support if the issue persists.',
                error: new Error('Error: signAccountOp controller not initialized while trying to sign and broadcast')
            });
        }
        let isSignAndBroadcastInProgressOnThisAccountAndChain = false;
        if (this.requests.visibleUserRequests.some((r) => r.kind === 'calls' &&
            r.signAccountOp.accountOp.chainId === signAccountOp.accountOp.chainId &&
            r.signAccountOp.isSignAndBroadcastInProgress)) {
            isSignAndBroadcastInProgressOnThisAccountAndChain = true;
        }
        else if (type !== 'one-click-swap-and-bridge' &&
            this.swapAndBridge.signAccountOpController &&
            this.swapAndBridge.signAccountOpController.accountOp.accountAddr ===
                signAccountOp.accountOp.accountAddr &&
            this.swapAndBridge.signAccountOpController.accountOp.chainId ===
                signAccountOp.accountOp.chainId &&
            this.swapAndBridge.signAccountOpController.isSignAndBroadcastInProgress) {
            isSignAndBroadcastInProgressOnThisAccountAndChain = true;
        }
        else if (type !== 'one-click-transfer' &&
            this.transfer.signAccountOpController &&
            this.transfer.signAccountOpController.accountOp.accountAddr ===
                signAccountOp.accountOp.accountAddr &&
            this.transfer.signAccountOpController.accountOp.chainId === signAccountOp.accountOp.chainId &&
            this.transfer.signAccountOpController.isSignAndBroadcastInProgress) {
            isSignAndBroadcastInProgressOnThisAccountAndChain = true;
        }
        if (isSignAndBroadcastInProgressOnThisAccountAndChain) {
            return this.emitError({
                level: 'major',
                message: 'Please wait while the previous transaction is being processed.',
                error: new Error(`The signing/broadcasting process is already in progress. (handleSignAndBroadcastAccountOp). Signing key: ${signAccountOp?.accountOp.signingKeyType}. Fee payer key: ${signAccountOp?.accountOp.gasFeePayment?.paidByKeyType}. Type: ${type}.`)
            });
        }
        await signAccountOp.signAndBroadcast().catch(() => {
            // intentionally ignored - handled inside signAccountOp
        });
    }
    async resolveDappBroadcast(submittedAccountOp, dappHandlers) {
        // No need to fetch the transaction id when there are no dapp handlers
        if (!dappHandlers.length)
            return;
        // this could take a while
        // return the txnId to the dapp once it's confirmed as return a txId
        // that could be front ran would cause bad UX on the dapp side
        const txnId = await this.activity.getConfirmedTxId(submittedAccountOp);
        dappHandlers.forEach((handler) => {
            if (txnId) {
                // for MultipleTxns, the correct txnId is passed to the handler;
                // otherwise, use the confirmed txnId
                const finalTxnId = submittedAccountOp.identifiedBy.type === 'MultipleTxns' ? handler.txnId || txnId : txnId;
                handler.promise.resolve({ hash: finalTxnId });
            }
            else {
                handler.promise.reject(eth_rpc_errors_1.ethErrors.rpc.transactionRejected({
                    message: 'Transaction rejected by the bundler'
                }));
            }
        });
        this.emitUpdate();
    }
    async #resolveSignMessage(signedMessage) {
        // The user may sign an invalid siwe message. We don't want to create policies
        // for such messages
        if (signedMessage.content.kind === 'siwe' &&
            signedMessage.content.parsedMessage &&
            signedMessage.content.siweValidityStatus === 'valid') {
            await this.autoLogin.onSiweMessageSigned(signedMessage.content.parsedMessage, signedMessage.content.isAutoLoginEnabledByUser, signedMessage.content.autoLoginDuration);
        }
        // signing typed messages might trigger a txn
        if (signedMessage.content.kind === 'typedMessage') {
            this.transferScanner
                .startScanLogsLoop({
                accAddr: signedMessage.accountAddr,
                chainId: signedMessage.chainId
            })
                .catch((error) => {
                this.emitError({
                    level: 'silent',
                    message: `Failed to scan token transfer logs on network with id ${signedMessage.chainId}.`,
                    error
                });
            });
        }
        await this.activity.addSignedMessage(signedMessage, signedMessage.accountAddr);
        await this.requests.resolveUserRequest({ hash: signedMessage.signature }, signedMessage.fromRequestId);
    }
    async handleSignMessage() {
        const accountAddr = this.signMessage.messageToSign?.accountAddr;
        const chainId = this.signMessage.messageToSign?.chainId;
        // Could (rarely) happen if not even a single account state is fetched yet
        const shouldForceUpdateAndWaitForAccountState = accountAddr && chainId && !this.accounts.accountStates?.[accountAddr]?.[chainId.toString()];
        if (shouldForceUpdateAndWaitForAccountState)
            await this.accounts.updateAccountState(accountAddr, 'latest', [chainId]);
        const isAccountStateStillMissing = !accountAddr || !chainId || !this.accounts.accountStates?.[accountAddr]?.[chainId.toString()];
        if (isAccountStateStillMissing) {
            const message = 'Unable to sign the message. During the preparation step, required account data failed to get received. Please try again later or contact Ambire support.';
            const error = new Error(`The account state of ${accountAddr} is missing for the network with id ${chainId}.`);
            return this.emitError({ level: 'major', message, error });
        }
        await this.signMessage.sign();
        const signedMessage = this.signMessage.signedMessage;
        // Error handling on the prev step will notify the user, it's fine to return here
        if (!signedMessage)
            return;
        // some accounts may not resolve immediately, like a Safe acc
        if (this.signMessage.status === signMessage_2.SignMessageStatus.Done) {
            await this.#resolveSignMessage(signedMessage);
        }
        else if (this.signMessage.status === signMessage_2.SignMessageStatus.Partial) {
            // mark the request so it doesn't get removed on close
            this.requests.setPartiallyCompleteRequest(signedMessage.fromRequestId, {
                signed: this.signMessage.signed,
                hash: this.signMessage.hash
            });
        }
        await this.ui.notification.create({
            title: 'Done!',
            message: 'The Message was successfully signed.'
        });
    }
    async #handleAccountPickerInitLedger(LedgerKeyIterator // TODO: KeyIterator type mismatch
    ) {
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
            if (ledgerCtrl.walletSDK && ledgerCtrl.cleanUp)
                await ledgerCtrl.cleanUp();
            const hdPathTemplate = derivation_1.BIP44_LEDGER_DERIVATION_TEMPLATE;
            const pathToUnlock = (0, hdPath_1.getHdPathFromTemplate)(hdPathTemplate, 0);
            if (ledgerCtrl.unlock)
                await ledgerCtrl.unlock(pathToUnlock);
            if (!ledgerCtrl.walletSDK) {
                const message = 'Could not establish connection with the Ledger device';
                throw new EmittableError_1.default({ message, level: 'major', error: new Error(message) });
            }
            const keyIterator = new LedgerKeyIterator({ controller: ledgerCtrl });
            this.accountPicker.setInitParams({
                keyIterator,
                hdPathTemplate,
                pageSize: 5,
                shouldAddNextAccountAutomatically: false
            });
        }
        catch (error) {
            const message = error?.message || 'Could not unlock the Ledger device. Please try again.';
            throw new EmittableError_1.default({ message, level: 'major', error });
        }
    }
    async handleAccountPickerInitLedger(LedgerKeyIterator /* TODO: KeyIterator type mismatch */) {
        await this.withStatus('handleAccountPickerInitLedger', async () => this.#handleAccountPickerInitLedger(LedgerKeyIterator));
    }
    async #handleAccountPickerInitTrezor(TrezorKeyIterator /* TODO: KeyIterator type mismatch */) {
        try {
            const trezorCtrl = this.#externalSignerControllers.trezor;
            if (!trezorCtrl) {
                const message = 'Could not initialize connection with your Trezor device. Please try again later or contact Ambire support.';
                throw new EmittableError_1.default({ message, level: 'major', error: new Error(message) });
            }
            const hdPathTemplate = derivation_1.BIP44_STANDARD_DERIVATION_TEMPLATE;
            const { walletSDK } = trezorCtrl;
            await this.accountPicker.setInitParams({
                keyIterator: new TrezorKeyIterator({ walletSDK }),
                hdPathTemplate,
                pageSize: 5,
                shouldAddNextAccountAutomatically: false
            });
        }
        catch (error) {
            const message = error?.message || 'Could not unlock the Trezor device. Please try again.';
            throw new EmittableError_1.default({ message, level: 'major', error });
        }
    }
    async handleAccountPickerInitTrezor(TrezorKeyIterator /* TODO: KeyIterator type mismatch */) {
        await this.withStatus('handleAccountPickerInitTrezor', async () => this.#handleAccountPickerInitTrezor(TrezorKeyIterator));
    }
    async #handleAccountPickerInitLattice(LatticeKeyIterator /* TODO: KeyIterator type mismatch */) {
        try {
            const latticeCtrl = this.#externalSignerControllers.lattice;
            if (!latticeCtrl) {
                const message = 'Could not initialize connection with your Lattice1 device. Please try again later or contact Ambire support.';
                throw new EmittableError_1.default({ message, level: 'major', error: new Error(message) });
            }
            const hdPathTemplate = derivation_1.BIP44_STANDARD_DERIVATION_TEMPLATE;
            await this.accountPicker.setInitParams({
                keyIterator: new LatticeKeyIterator({ controller: latticeCtrl }),
                hdPathTemplate,
                pageSize: 5,
                shouldAddNextAccountAutomatically: false
            });
        }
        catch (error) {
            const message = error?.message || 'Could not unlock the Lattice1 device. Please try again.';
            throw new EmittableError_1.default({ message, level: 'major', error });
        }
    }
    async handleAccountPickerInitLattice(LatticeKeyIterator /* TODO: KeyIterator type mismatch */) {
        await this.withStatus('handleAccountPickerInitLattice', async () => this.#handleAccountPickerInitLattice(LatticeKeyIterator));
    }
    async #handleAccountPickerInitQr(QrKeyIterator, // TODO: KeyIterator type mismatch
    payload) {
        try {
            const qrCtrl = this.#externalSignerControllers.qr;
            if (!qrCtrl) {
                const message = 'Could not initialize connection with your QR hardware wallet. Please try again later or contact Ambire support.';
                throw new EmittableError_1.default({ message, level: 'major', error: new Error(message) });
            }
            const keyIterator = new QrKeyIterator({ controller: qrCtrl });
            // Initialize the QR iterator from payload before AccountPicker init.
            // This populates QR-specific iterator state (xpub, parsedAccount, hdPathTemplate)
            // that AccountPicker needs to configure derivation and retrieval.
            await keyIterator.initFromQrPayload(payload);
            const hdPathTemplate = keyIterator.hdPathTemplate;
            if (!hdPathTemplate) {
                const message = 'Invalid QR hardware wallet payload. Please try again.';
                throw new EmittableError_1.default({
                    message,
                    level: 'major',
                    error: new Error('Missing hdPathTemplate')
                });
            }
            // v1 accounts have never supported QR wallets.
            // In the rare case of migration (ledger -> qr -> has created a linked account),
            // The user should instead go to the web wallet and migrate his funds instead.
            // v1 accounts are generally deprecated and we don't encourage users to use them.
            this.accountPicker.setInitParams({
                keyIterator,
                hdPathTemplate,
                pageSize: 5,
                shouldAddNextAccountAutomatically: false,
                shouldSearchForLinkedAccounts: false
            });
        }
        catch (error) {
            const message = error?.message || 'Could not import the QR hardware wallet account. Please try again.';
            throw new EmittableError_1.default({ message, level: 'major', error });
        }
    }
    async handleAccountPickerInitQr(QrKeyIterator, // TODO: KeyIterator type mismatch
    payload) {
        await this.withStatus('handleAccountPickerInitQr', async () => this.#handleAccountPickerInitQr(QrKeyIterator, payload));
    }
    async updateAccountsOpsStatuses() {
        await this.initialLoadPromise;
        const addressesWithPendingOps = Object.entries(this.activity.broadcastedButNotConfirmed)
            .filter(([, ops]) => ops.length > 0)
            .map(([addr]) => addr);
        const updatedAccountsOpsByAccount = await this.activity.updateAccountsOpsStatuses(addressesWithPendingOps);
        Object.values(updatedAccountsOpsByAccount).forEach(({ updatedAccountsOps: accUpdatedAccountsOps }) => {
            accUpdatedAccountsOps.forEach((op) => {
                this.swapAndBridge.handleUpdateActiveRouteOnSubmittedAccountOpStatusUpdate(op);
                // we scan for logs only if Success & a dapp interaction has been made
                // because only a dapp interaction might have a receiving txn after;
                // receiving txns for inner bridges are handled in swapAndBridge.ts
                const shouldScanLogs = op.status === types_2.AccountOpStatus.Success && op.calls.some((call) => !!call.dapp);
                if (shouldScanLogs) {
                    this.transferScanner
                        .startScanLogsLoop({
                        accAddr: op.accountAddr,
                        chainId: op.chainId,
                        fromBlock: op.blockNumber
                    })
                        .catch((error) => {
                        this.emitError({
                            level: 'silent',
                            message: `Failed to scan token transfer logs on network with id ${op.chainId}.`,
                            error
                        });
                    });
                }
            });
        });
        Object.entries(updatedAccountsOpsByAccount).forEach(async ([accountAddr, { shouldEmitUpdate, chainsToUpdate, portfoliosToUpdate, shouldFetchSafeTxns, updatedAccountsOps }]) => {
            if (shouldEmitUpdate) {
                this.emitUpdate();
                if (chainsToUpdate.length) {
                    const networks = chainsToUpdate
                        ? this.networks.networks.filter((n) => chainsToUpdate.includes(n.chainId))
                        : undefined;
                    if (networks?.length) {
                        // The account state must be updated before the portfolio
                        // as the portfolio has internal checks whether the nonce has changed
                        // to decide if to force refetch certain data
                        await this.accounts.updateAccountState(accountAddr, 'latest', networks?.map((net) => net.chainId));
                        const finalizedAccountOps = updatedAccountsOps.filter((op) => op.status !== types_2.AccountOpStatus.Pending &&
                            op.status !== types_2.AccountOpStatus.BroadcastedButNotConfirmed);
                        await this.portfolio.discardSimulation(finalizedAccountOps);
                        // Reports to Sentry if the portfolio was not updated after a confirmed AccountOp
                        this.portfolio.reportMissedPortfolioUpdateAfterUpdatedAccountOp(accountAddr, updatedAccountsOps);
                        Object.entries(portfoliosToUpdate).forEach(([accountAddr, chainIds]) => {
                            // eslint-disable-next-line @typescript-eslint/no-floating-promises
                            this.portfolio.updateSelectedAccount(accountAddr, this.networks.networks.filter((n) => chainIds.includes(n.chainId)));
                        });
                    }
                }
            }
            if (shouldFetchSafeTxns) {
                this.fetchSafeTxns().catch((e) => e); // we catch the error inside
            }
        });
    }
    // call this function after a call to the singleton has been made
    // it will check if the factory has been deployed and update the network settings if it has been
    async setContractsDeployedToTrueIfDeployed(network) {
        await this.initialLoadPromise;
        if (network.areContractsDeployed)
            return;
        const provider = this.providers.providers[network.chainId.toString()];
        if (!provider)
            return;
        const factoryCode = await provider.getCode(deploy_1.AMBIRE_ACCOUNT_FACTORY);
        if (factoryCode === '0x')
            return;
        await this.networks.updateNetwork({ areContractsDeployed: true }, network.chainId);
    }
    // remove all keys that have this addr
    #removeAccountKeyData(address) {
        this.keystore.keys
            .filter((key) => key.addr === address)
            .forEach((key) => {
            this.keystore.removeKey(key.addr, key.type).catch((e) => {
                throw new EmittableError_1.default({
                    level: 'major',
                    message: 'Failed to remove account key',
                    error: e
                });
            });
        });
        // the keystore doesn't update after key removals so we
        // force update it here. Main controller updates don't propagate
        // to the keystore
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.keystore.forceEmitUpdate();
    }
    async #removeAccount(address) {
        try {
            this.#removeAccountKeyData(address);
            // Remove account data from sub-controllers
            this.accounts.removeAccountData(address);
            this.portfolio.removeAccountData(address);
            await this.activity.removeAccountData(address);
            this.requests.removeAccountData(address);
            this.signMessage.removeAccountData(address);
            if (this.selectedAccount.account?.addr === address) {
                await this.#selectAccount(this.accounts.accounts[0]?.addr ?? null);
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
    }
    async removeAccount(address) {
        await this.withStatus('removeAccount', async () => this.#removeAccount(address));
    }
    async reloadSelectedAccount(options) {
        const { chainIds, isManualReload = false, defiMaxDataAgeMs, maxDataAgeMsUnused, maxDataAgeMs } = options || {};
        const networksToUpdate = chainIds
            ? this.networks.networks.filter((n) => chainIds.includes(n.chainId))
            : undefined;
        if (!this.selectedAccount.account)
            return;
        if (isManualReload)
            this.selectedAccount.resetSelectedAccountPortfolio({ isManualUpdate: isManualReload });
        await Promise.all([
            // When we trigger `reloadSelectedAccount` (for instance, from Dashboard -> Refresh balance icon),
            // it's very likely that the account state is already in the process of being updated.
            // If we try to run the same action, `withStatus` validation will throw an error.
            // So, we perform this safety check to prevent the error.
            // However, even if we don't trigger an update here, it's not a big problem,
            // as the account state will be updated anyway, and its update will be very recent.
            !this.accounts.areAccountStatesLoading && this.selectedAccount.account?.addr
                ? this.accounts.updateAccountState(this.selectedAccount.account.addr, 'pending', chainIds)
                : Promise.resolve(),
            // `updateSelectedAccountPortfolio` doesn't rely on `withStatus` validation internally,
            // as the PortfolioController already exposes flags that are highly sufficient for the UX.
            // Additionally, if we trigger the portfolio update twice (i.e., running a long-living interval + force update from the Dashboard),
            // there won't be any error thrown, as all portfolio updates are queued and they don't use the `withStatus` helper.
            this.updateSelectedAccountPortfolio({
                networks: networksToUpdate,
                isManualUpdate: isManualReload,
                maxDataAgeMsUnused,
                defiMaxDataAgeMs,
                maxDataAgeMs
            })
        ]);
        this.fetchSafeTxns([], true).catch((e) => e); // we catch the error inside
    }
    /**
     * Fetch Safe txns from Safe Global and make them user requests
     * if the selected account is a safe
     */
    async fetchSafeTxns(chainIds = [], forceRefetch = false) {
        if (!this.selectedAccount?.account?.safeCreation)
            return;
        // cache the addr here to prevent race conditions
        const safeAddr = this.selectedAccount?.account?.addr;
        // skip if conditions are met
        const shouldFetch = !!chainIds.length || forceRefetch || !this.safe.shouldSkipFetchPending(safeAddr);
        if (!shouldFetch)
            return;
        const accountState = await this.accounts.getOrFetchAccountStates(safeAddr);
        if (!accountState)
            return;
        const finalChainIds = chainIds.length
            ? chainIds
            : this.networks.networks
                .filter((n) => {
                // fetch info only about deployed safes
                const state = accountState?.[n.chainId.toString()];
                return state?.isDeployed;
            })
                .map((n) => n.chainId);
        const networksAndThresholds = finalChainIds.map((c) => ({
            chainId: c,
            threshold: accountState[c.toString()]?.threshold || 0
        }));
        for (let i = 0; i < networksAndThresholds.length; i++) {
            // wait a second to not hit 5 request per minute API limit
            if (i !== 0)
                await (0, wait_1.default)(600);
            const firstBatch = networksAndThresholds[i];
            const res = await this.safe
                .fetchPending(safeAddr, [firstBatch])
                .catch((e) => {
                console.log(e);
                console.log('failed to retrieve pending Safe txns');
                return null;
            });
            if (!res)
                continue;
            // build txn requests
            const txnRequest = (0, safe_2.toCallsUserRequest)(safeAddr, res);
            for (let i = 0; i < txnRequest.length; i++) {
                // build the requests only if the selected account hasn't changed
                if (this.selectedAccount?.account?.addr === safeAddr)
                    await this.requests.build(txnRequest[i]).catch((e) => e);
            }
            // build and resolve message requests
            const messageRequests = (0, safe_2.toSigMessageUserRequests)(res);
            for (let i = 0; i < messageRequests.length; i++) {
                const req = messageRequests[i];
                const userRequest = this.requests.userRequests.find((u) => u.meta.accountAddr === safeAddr &&
                    u.meta.chainId === req.params.chainId &&
                    (u.kind === 'typedMessage' || u.kind === 'message' || u.kind === 'siwe') &&
                    u.meta.hash === req.params.messageHash);
                if (!userRequest && !req.isConfirmed) {
                    // build the requests only if the selected account hasn't changed
                    if (this.selectedAccount?.account?.addr === safeAddr)
                        await this.requests.build(req).catch((e) => e);
                }
                if (userRequest && req.isConfirmed) {
                    await this.requests.resolveUserRequest({ hash: req.params.signature }, userRequest.id);
                }
            }
        }
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
        const portfolioState = this.portfolio.getAccountPortfolioState(accountAddr);
        const portfolioStateKeys = Object.keys(portfolioState);
        const isAllLoaded = portfolioStateKeys.every((chainId) => {
            return (0, selectedAccount_2.isNetworkReady)(portfolioState[chainId]) && !portfolioState[chainId]?.isLoading;
        });
        // Set isOffline back to false if the portfolio is loading.
        // This is done to prevent the UI from flashing the offline error
        if (!portfolioStateKeys.length || !isAllLoaded) {
            // Skip unnecessary updates
            if (!this.isOffline)
                return;
            this.isOffline = false;
            this.emitUpdate();
            return;
        }
        const allPortfolioNetworksHaveErrors = portfolioStateKeys.every((chainId) => {
            const state = portfolioState[chainId];
            return !!state?.criticalError;
        });
        const allNetworkRpcsAreDown = Object.keys(this.providers.providers).every((chainId) => {
            const provider = this.providers.providers[chainId];
            const isWorking = provider?.isWorking;
            return typeof isWorking === 'boolean' && !isWorking;
        });
        // Update isOffline if either all portfolio networks have errors or we've failed to fetch
        // the account state for every account. This is because either update may fail first.
        this.isOffline = !!allNetworkRpcsAreDown || !!allPortfolioNetworksHaveErrors;
        if (oldIsOffline !== this.isOffline) {
            this.emitUpdate();
        }
    }
    async updateSelectedAccountPortfolio(opts) {
        const { networks, maxDataAgeMs, defiMaxDataAgeMs, maxDataAgeMsUnused, isManualUpdate } = opts || {};
        await this.initialLoadPromise;
        if (!this.selectedAccount.account)
            return;
        let signAccountOp = null;
        if (this.requests.currentUserRequest && this.requests.currentUserRequest.kind === 'calls') {
            signAccountOp = this.requests.currentUserRequest.signAccountOp;
        }
        const canUpdateSignAccountOp = !signAccountOp || signAccountOp.canUpdate();
        if (!canUpdateSignAccountOp)
            return;
        await this.portfolio.updateSelectedAccount(this.selectedAccount.account.addr, networks, undefined, { maxDataAgeMs, maxDataAgeMsUnused, defiMaxDataAgeMs, isManualUpdate });
        this.#updateIsOffline();
    }
    async removeActiveRoute(activeRouteId) {
        const userRequest = this.requests.userRequests.find((r) => r.kind === 'calls' &&
            !!r.signAccountOp.accountOp.calls.find((c) => c.activeRouteId === activeRouteId));
        if (userRequest) {
            await this.requests.rejectCalls({ activeRouteIds: [activeRouteId] });
        }
        else {
            this.swapAndBridge.removeActiveRoute(activeRouteId);
        }
    }
    async addNetwork(network) {
        await this.networks.addNetwork(network);
        const networkToUpdate = this.networks.networks.find((n) => n.chainId === network.chainId);
        await this.updateSelectedAccountPortfolio({
            networks: networkToUpdate ? [networkToUpdate] : undefined
        });
    }
    removeNetworkData(chainId) {
        this.portfolio.removeNetworkData(chainId);
        this.accountPicker.removeNetworkData(chainId);
        this.selectedAccount.removeNetworkData(chainId);
        // Don't remove user activity for now because removing networks
        // is no longer possible in the UI. Users can only disable networks
        // and it doesn't make sense to delete their activity
        // this.activity.removeNetworkData(chainId)
    }
    async resolveAccountOpRequest(submittedAccountOp, requestId, openBenzin = true) {
        const accountOpRequest = this.requests.userRequests.find((r) => r.id === requestId);
        if (!accountOpRequest)
            return;
        const { signAccountOp, dappPromises } = accountOpRequest;
        const network = this.networks.networks.find((n) => n.chainId === signAccountOp.accountOp.chainId);
        if (!network)
            return;
        const meta = {
            accountAddr: signAccountOp.accountOp.accountAddr,
            chainId: network.chainId,
            txnId: null,
            userOpHash: null
        };
        if (submittedAccountOp) {
            meta.txnId = submittedAccountOp.txnId;
            meta.identifiedBy = submittedAccountOp.identifiedBy;
            meta.submittedAccountOp = submittedAccountOp;
            if ((0, submittedAccountOp_1.isIdentifiedByUserOpHash)(submittedAccountOp.identifiedBy)) {
                meta.userOpHash = submittedAccountOp.identifiedBy.identifier;
            }
        }
        if (openBenzin) {
            const benzinUserRequest = {
                id: new Date().getTime(),
                kind: 'benzin',
                meta,
                dappPromises: []
            };
            await this.requests.addUserRequests([benzinUserRequest], {
                position: 'first',
                skipFocus: true
            });
        }
        // upon resolving an account op, check all same nonce Safe requests and remove them
        const safeRequests = this.requests.getSameNonceSafeRequests(requestId).map((r) => r.id);
        if (safeRequests.length) {
            await this.requests.removeUserRequests(safeRequests, {
                shouldRejectSafeRequests: false
            });
        }
        const dappHandlers = [];
        // handle wallet_sendCalls before activity.getConfirmedTxId as 1) it's faster
        // 2) the identifier is different
        dappPromises.forEach((dappPromise) => {
            if (dappPromise.meta.isWalletSendCalls) {
                dappPromise.resolve({ hash: (0, submittedAccountOp_1.getDappIdentifier)(submittedAccountOp) });
            }
            else {
                // if the submittedAccountOp identifier is MultipleTxns,
                // the txnId for the dappPromise will be in the call itself
                const submittedCall = submittedAccountOp.calls.find((call) => call.dappPromiseId === dappPromise.id);
                dappHandlers.push({ promise: dappPromise, txnId: submittedCall?.txnId });
            }
        });
        await this.requests.removeUserRequests([accountOpRequest.id], {
            shouldRemoveSwapAndBridgeRoute: false
        });
        this.resolveDappBroadcast(submittedAccountOp, dappHandlers);
        this.emitUpdate();
    }
    onOneClickSwapClose() {
        // Always unload the screen when the request window is closed
        this.swapAndBridge.unloadScreen('request-window', true);
        const signAccountOp = this.swapAndBridge.signAccountOpController;
        if (!signAccountOp)
            return;
        // Remove the active route if it exists
        if (signAccountOp.accountOp.meta?.swapTxn) {
            this.swapAndBridge.removeActiveRoute(signAccountOp.accountOp.meta.swapTxn.activeRouteId);
        }
        const network = this.networks.networks.find((n) => n.chainId === signAccountOp.accountOp.chainId);
        this.updateSelectedAccountPortfolio({ networks: network ? [network] : undefined });
        this.emitUpdate();
    }
    onOneClickTransferClose() {
        // Always unload the screen when the request window is closed
        this.transfer.reset({ destroyAccountOp: true });
        const signAccountOp = this.transfer.signAccountOpController;
        if (!signAccountOp)
            return;
        const network = this.networks.networks.find((n) => n.chainId === signAccountOp.accountOp.chainId);
        this.updateSelectedAccountPortfolio({
            networks: network ? [network] : undefined
        });
        this.emitUpdate();
    }
    async accountPickerSetInitParamsFromPrivateKeyOrSeedPhrase({ privKeyOrSeed, seedPassphrase }) {
        const hdPathTemplate = derivation_1.BIP44_STANDARD_DERIVATION_TEMPLATE;
        const keyIterator = new keyIterator_1.KeyIterator(privKeyOrSeed, seedPassphrase);
        await this.accountPicker.setInitParams({ keyIterator, hdPathTemplate });
    }
    // includes the getters in the stringified instance
    toJSON() {
        return {
            ...this,
            ...super.toJSON()
        };
    }
}
exports.MainController = MainController;
//# sourceMappingURL=main.js.map