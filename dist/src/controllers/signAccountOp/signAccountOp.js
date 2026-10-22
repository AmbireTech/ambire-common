"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignAccountOpController = exports.MAX_REESTIMATES = exports.SigningStatus = exports.noStateUpdateStatuses = exports.FeeSpeed = void 0;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const viem_1 = require("viem");
const estimate_1 = require("../../libs/estimate/estimate");
const helpers_1 = require("../../libs/portfolio/helpers");
const IERC20_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/IERC20.json"));
const EmittableError_1 = tslib_1.__importDefault(require("../../classes/EmittableError"));
const recurringTimeout_1 = require("../../classes/recurringTimeout/recurringTimeout");
const addresses_1 = require("../../consts/addresses");
const bundlers_1 = require("../../consts/bundlers");
const deploy_1 = require("../../consts/deploy");
const gasTankFeeTokens_1 = tslib_1.__importDefault(require("../../consts/gasTankFeeTokens"));
const intervals_1 = require("../../consts/intervals");
const safe_1 = require("../../consts/safe");
const errorHandling_1 = require("../../consts/signAccountOp/errorHandling");
const gas_1 = require("../../consts/signAccountOp/gas");
const dapp_1 = require("../../interfaces/dapp");
const signAccountOp_1 = require("../../interfaces/signAccountOp");
Object.defineProperty(exports, "FeeSpeed", { enumerable: true, get: function () { return signAccountOp_1.FeeSpeed; } });
Object.defineProperty(exports, "noStateUpdateStatuses", { enumerable: true, get: function () { return signAccountOp_1.noStateUpdateStatuses; } });
Object.defineProperty(exports, "SigningStatus", { enumerable: true, get: function () { return signAccountOp_1.SigningStatus; } });
const _7702_1 = require("../../libs/7702/7702");
const account_1 = require("../../libs/account/account");
const feeOptions_1 = require("../../libs/account/feeOptions");
const getBaseAccount_1 = require("../../libs/account/getBaseAccount");
const accountOp_1 = require("../../libs/accountOp/accountOp");
const submittedAccountOp_1 = require("../../libs/accountOp/submittedAccountOp");
const types_1 = require("../../libs/accountOp/types");
const banners_1 = require("../../libs/banners/banners");
const broadcast_1 = require("../../libs/broadcast/broadcast");
const helpers_2 = require("../../libs/dapps/helpers");
const decodeCall_1 = require("../../libs/decodeCall");
const errorHumanizer_1 = require("../../libs/errorHumanizer");
const errors_1 = require("../../libs/errorHumanizer/errors");
const estimateBundler_1 = require("../../libs/estimate/estimateBundler");
const fees_1 = require("../../libs/fees/fees");
const humanizer_1 = require("../../libs/humanizer");
const utils_1 = require("../../libs/humanizer/utils");
const networks_1 = require("../../libs/networks/networks");
const feePayerLinks_1 = require("../../libs/safe/feePayerLinks");
const helpers_3 = require("../../libs/safe/helpers");
const safe_2 = require("../../libs/safe/safe");
const signingRequest_1 = require("../../libs/signingRequest/signingRequest");
const signMessage_1 = require("../../libs/signMessage/signMessage");
const detectPermit2Interaction_1 = require("../../libs/simulation/detectPermit2Interaction");
const singleton_1 = require("../../libs/singleton/singleton");
const userOperation_1 = require("../../libs/userOperation/userOperation");
const bundlerSwitcher_1 = require("../../services/bundlers/bundlerSwitcher");
const FailedPaymasters_1 = require("../../services/paymaster/FailedPaymasters");
const constants_1 = require("../../services/socket/constants");
const shortenAddress_1 = tslib_1.__importDefault(require("../../utils/shortenAddress"));
const uuid_1 = require("../../utils/uuid");
const with_timeout_1 = require("../../utils/with-timeout");
const contractInfo_1 = require("../contractInfo/contractInfo");
const estimation_1 = require("../estimation/estimation");
const types_2 = require("../estimation/types");
const gasPrice_1 = require("../gasPrice/gasPrice");
const humanization_1 = tslib_1.__importDefault(require("../humanization/humanization"));
const discoverTxnTokens_1 = require("./discoverTxnTokens");
const helper_1 = require("./helper");
/**
 * How many reestimates run at the normal interval before the loop slows down,
 * assuming the user left the request open without acting on it.
 */
const REESTIMATES_BEFORE_SLOWING_DOWN = 10;
/** Each slowed-down reestimate waits this much longer than the previous one. */
const SLOWED_DOWN_REESTIMATE_STEP = 10000;
/** After this many reestimates the loop gives up and stops refetching. */
exports.MAX_REESTIMATES = 20;
class SignAccountOpController extends humanization_1.default {
    #type;
    #callRelayer;
    #erc7730;
    #contractInfo;
    // Call datas of the current humanization whose selectors are still being fetched
    #callDatasWithPendingSelectors = new Set();
    #selectorLoadingTimeout;
    #accounts;
    #keystore;
    #portfolio;
    #featureFlags;
    #platform;
    #signAccountOpPreference;
    #externalSignerControllers;
    account;
    baseAccount;
    #network;
    #phishing;
    // this is not used in the controller directly but it's being read outside
    fromRequestId;
    hasSafeApiFailed = false;
    isRefetchingAccountState = false;
    /**
     * Never modify this directly, use #updateAccountOp instead.
     * Otherwise the accountOp will be out of sync with the one stored
     * in requests/actions.
     */
    #accountOp;
    #customSafeNonce = null;
    /**
     * The gas prices used for broadcasting. With the `rpcWithBundlerFallback` strategy
     * (see BaseAccount.getGasPriceFetchStrategy), these come from the bundler estimation
     * and are used for bundler broadcasts only. While there's no bundler estimation,
     * they're the gasPrice controller ones
     */
    gasPrices;
    /**
     * The gas prices for broadcasts outside the bundler with the `rpcWithBundlerFallback`
     * strategy (see BaseAccount.getGasPriceFetchStrategy). These are the RPC gas prices,
     * or the bundler ones if the RPC has failed and the bundler fallback has succeeded
     */
    rpcGasPrices;
    hasCustomGasPrices = false;
    customGasLimit;
    feeSpeeds = {};
    #paidBy = null;
    /**
     * The selected fee token the user is going to broadcast with.
     * This probably exists in selectedOption as well and it could
     * be refactored away someday
     */
    feeTokenResult = null;
    feeTokenPreference = {};
    pendingFeeTokenPreference = null;
    selectedFeeSpeed = signAccountOp_1.FeeSpeed.Medium;
    /**
     * The selected payment option for txn broadcasting.
     * Depending on the account type, it could be various tokens,
     * gas tank, or payment by another EOA
     */
    selectedOption = undefined;
    /**
     * Safes only, null for other accounts. Paying the fee from an EOA publicly links it to the
     * Safe, unless it's an owner (listed in the Safe itself) or already paid for the Safe before.
     * Lowercased addresses; `linked` excludes the owners.
     */
    safeFeePayerLinks = null;
    status = null;
    /**
     * The recipients of this account op the account has never sent to before, together with the
     * account op they were resolved for. Resolved asynchronously from the activity, so it is cached
     * here instead of read on every access.
     */
    #firstTimeRecipients = null;
    broadcastStatus = 'INITIAL';
    signedAccountOp;
    replacementFeeLow;
    // Set to true when a broadcast attempt fails because the network fee changed
    // significantly while the transaction was being prepared (e.g. during a gas
    // spike) and we auto-updated the gas prices. The UI uses this to show a soft
    // "Gas fee updated" confirmation instead of a scary error toast, so the user
    // can accept the new fee and continue without redoing the whole flow.
    gasFeeChangedConfirmationRequired = false;
    previousFee = null;
    warnings = [];
    // indicates whether the transaction gas is sponsored or not
    isSponsored = false;
    // the sponsor data to be displayed, if any
    sponsor = undefined;
    bundlerSwitcher;
    signedTransactionsCount = null;
    hardwareWalletSigningRequest = null;
    safeEip712Data = null;
    // We track the status of token discovery logic (main.traceCall)
    // to ensure the "SignificantBalanceDecrease" banner is displayed correctly.
    // The latest/pending portfolio balance is essential for calculating balance differences.
    // However, during a SWAP, the user may receive a new token that isn't yet included (discovered) in the portfolio.
    // If the discovery process is in-process, and we only rely on portfolio balance change,
    // the banner may be incorrectly triggered due to the perceived balance drop.
    // Once discovery completes and updates the portfolio, the banner will be hidden.
    traceCallDiscoveryStatus = signAccountOp_1.TraceCallDiscoveryStatus.NotStarted;
    // the calculated gas used for the transaction estimation
    // it now depends on a variety of options and hence the need to move it
    // as its own property
    gasUsed = 0n;
    provider;
    estimation;
    #humanization = [];
    /**
     * The humanized calls, with the unlimited approval warnings of apps in the default Ambire
     * catalog taken out. Humanizer modules cannot read the catalog, so they report every unlimited
     * approval, and the ones from an app we already trust are dropped here.
     *
     * The catalog is fetched, so it often arrives after the calls were humanized. Deciding this on
     * read, rather than baking it into the humanization, means a catalog that lands late needs no
     * new humanization: the dapps update this controller already listens to emits, the UI reads
     * again, and the answer is right whether an app joins the catalog or leaves it.
     *
     * Returns the stored array itself when nothing was dropped, so the calls on screen keep their
     * identity while a new humanization is running.
     */
    get humanization() {
        let didSuppressWarning = false;
        const humanization = this.#humanization.map((call, index) => {
            const dappUrl = this.accountOp.calls[index]?.dapp?.url;
            // an app with no url is never trusted - a request of unknown origin is not a safer one
            if (!dappUrl || !this.#dapps.isDappInDefaultCatalog(dappUrl))
                return call;
            const warnings = call.warnings?.filter((warning) => warning.code !== utils_1.UNLIMITED_APPROVAL_WARNING_CODE);
            if (warnings?.length === call.warnings?.length)
                return call;
            didSuppressWarning = true;
            return { ...call, warnings };
        });
        return didSuppressWarning ? humanization : this.#humanization;
    }
    humanizationId = null;
    isHumanizing = false;
    gasPrice;
    shouldSignAuth = null;
    /**
     * Should this signAccountOp instance simulate the accountOp it's
     * preparing as well as estimate. Simulaton is required in the
     * original signAccountOp but should be avoided in swap&bridge and Safe deployments.
     */
    #shouldSimulate;
    #reestimateCounter = 0;
    /**
     * Controls internal continuous updates - gasPrice and estimation.
     * When true, both intervals should be stopped and even if they
     * are not, they shouldn't make any calls/updates (fallback measure).
     */
    #stopRefetching = false;
    #activity;
    #dapps;
    #onUpdateAfterTraceCallSuccess;
    #onBroadcastSuccess;
    #onBroadcastFailed;
    #onPartialBroadcast;
    #updateBlacklistedStatusPromise;
    signPromise;
    broadcastPromise;
    signAndBroadcastPromise;
    traceCallTimeoutId = null;
    #gasPriceInterval;
    #simulateAndEstimateOrSimulateInterval;
    #onDappsUpdateUnsubscribe;
    /** Set only when speeding up a pending transaction, see SpeedUp */
    #speedUp;
    constructor({ eventEmitterRegistry, type, callRelayer, erc7730, contractInfo, accounts, networks, keystore, portfolio, featureFlags, platform, signAccountOpPreference, externalSignerControllers, account, network, activity, dapps, provider, phishing, fromRequestId, accountOp, shouldSimulate, onUpdateAfterTraceCallSuccess, onBroadcastSuccess, onBroadcastFailed, onPartialBroadcast, speedUp }) {
        super(eventEmitterRegistry, false);
        this.#type = type || 'default';
        this.#callRelayer = callRelayer;
        this.#erc7730 = erc7730;
        this.#contractInfo = contractInfo;
        this.#accounts = accounts;
        this.#keystore = keystore;
        this.#portfolio = portfolio;
        this.#featureFlags = featureFlags;
        this.#platform = platform;
        this.#signAccountOpPreference = signAccountOpPreference;
        this.feeTokenPreference = this.#signAccountOpPreference.feeTokenPreference;
        this.selectedFeeSpeed =
            this.#signAccountOpPreference.feeSpeedPreference[network.chainId.toString()] ||
                signAccountOp_1.FeeSpeed.Medium;
        this.#externalSignerControllers = externalSignerControllers;
        this.account = account;
        const accountState = accounts.accountStates[account.addr][network.chainId.toString()]; // ! is safe as otherwise, nothing will work
        this.baseAccount = (0, getBaseAccount_1.getBaseAccount)(account, accountState, network, this.#featureFlags.isFeatureEnabled('erc4337'), this.#featureFlags.isFeatureEnabled('eip7702'));
        this.#network = network;
        this.#activity = activity;
        this.#dapps = dapps;
        this.#phishing = phishing;
        this.fromRequestId = fromRequestId;
        this.#accountOp = structuredClone(accountOp);
        this.#speedUp = speedUp;
        this.#updateSafeEip712Data();
        if (this.#accountOp.signature && this.#accountOp.txnId) {
            this.#accountOp.signed = (0, safe_2.getAlreadySignedOwners)(this.#accountOp.signature, this.#accountOp.txnId, this.#accountOp.safeTx);
            const notSigned = (0, safe_2.getImportedSignersThatHaveNotSigned)(this.#accountOp.signed, accountState.importedAccountKeys.map((k) => k.addr));
            // make the status queued if there are no additional owners left to sign
            if (this.#accountOp.signed.length < accountState.threshold && !notSigned.length)
                this.status = { type: signAccountOp_1.SigningStatus.Queued };
        }
        this.signedAccountOp = null;
        this.replacementFeeLow = false;
        this.bundlerSwitcher = new bundlerSwitcher_1.BundlerSwitcher(network, () => {
            return this.status ? signAccountOp_1.noStateUpdateStatuses.indexOf(this.status.type) !== -1 : false;
        }, { canDelegate: this.baseAccount.shouldSignAuthorization(broadcast_1.BROADCAST_OPTIONS.byBundler) });
        this.provider = provider;
        this.estimation = new estimation_1.EstimationController(keystore, accounts, networks, provider, portfolio, this.bundlerSwitcher, this.#activity, this.#featureFlags);
        this.#onUpdateAfterTraceCallSuccess = onUpdateAfterTraceCallSuccess;
        this.gasPrice = new gasPrice_1.GasPriceController(network, provider, this.baseAccount, () => ({
            estimation: this.estimation,
            readyToSign: this.readyToSign,
            stopRefetching: this.#stopRefetching
        }), this.#featureFlags);
        this.#shouldSimulate = shouldSimulate && !this.#accountOp.meta?.isSafeDeploy;
        this.#onBroadcastSuccess = onBroadcastSuccess;
        if (onBroadcastFailed)
            this.#onBroadcastFailed = onBroadcastFailed;
        if (onPartialBroadcast)
            this.#onPartialBroadcast = onPartialBroadcast;
        // Intervals
        this.#gasPriceInterval = new recurringTimeout_1.RecurringTimeout(async () => {
            // Null when the controller is destroyed
            if (!this.gasPrice || this.#stopRefetching) {
                this.#gasPriceInterval.stop();
                return;
            }
            // Users often just browse quotes on the swap screen, so a failed background
            // refresh shouldn't interrupt them with an error
            const gasPriceErrorLevel = this.#type === 'one-click-swap-and-bridge' ? 'silent' : 'major';
            await this.gasPrice.fetch(gasPriceErrorLevel);
        }, intervals_1.GAS_PRICE_UPDATE_INTERVAL);
        this.#simulateAndEstimateOrSimulateInterval = new recurringTimeout_1.RecurringTimeout(async () => {
            if (!this.estimation || this.#stopRefetching) {
                this.#simulateAndEstimateOrSimulateInterval.stop();
                return;
            }
            await this.#simulateAndEstimateOrEstimate();
        }, intervals_1.ESTIMATE_UPDATE_INTERVAL);
        // Intervals end
        this.#load();
    }
    get safetyChecksLoading() {
        return !!this.#updateBlacklistedStatusPromise;
    }
    get accountOp() {
        return this.#accountOp;
    }
    get isSpeedUpTransaction() {
        return !!this.#speedUp;
    }
    #updateAccountOp(accountOp) {
        if (!Object.keys(accountOp).length)
            return;
        const hasUpdatedCalls = !!accountOp.calls;
        this.#accountOp = {
            ...this.#accountOp,
            ...accountOp,
            id: hasUpdatedCalls ? (0, uuid_1.generateUuid)() : this.#accountOp.id
        };
        this.#updateSafeEip712Data();
        if (hasUpdatedCalls)
            void this.#updateFirstTimeRecipients();
    }
    /**
     * Which recipients of this account op have never been sent to. A saved contact or an added
     * account still counts; only the fee collector is left out, as the app picks it, not the user.
     */
    async #updateFirstTimeRecipients() {
        // Only the signing authentication reads them, so elsewhere the activity lookups are skipped
        if (!(0, helpers_2.isSigningAuthPlatform)(this.#platform))
            return;
        const accountOpId = this.#accountOp.id;
        const recipients = (0, submittedAccountOp_1.getAccountOpRecipients)(this.#accountOp)
            .map(({ address }) => address)
            .filter((recipient) => recipient.toLowerCase() !== addresses_1.FEE_COLLECTOR.toLowerCase());
        try {
            const sentToResults = await Promise.all(recipients.map((recipient) => this.#activity.hasAccountOpsSentTo(recipient, this.account.addr)));
            // The calls may have changed while the activity was being read, in which case this result
            // describes an account op that is no longer on screen
            if (accountOpId !== this.#accountOp.id)
                return;
            this.#firstTimeRecipients = {
                accountOpId,
                recipients: recipients.filter((_, index) => !sentToResults[index].found)
            };
            this.emitUpdate();
        }
        catch (error) {
            // Leaving the cache untouched means the recipients are not reported as first time ones,
            // so the user is not blocked - but this should never happen, hence the report
            this.emitError({
                level: 'silent',
                message: 'Could not check whether this account has sent to these addresses before.',
                error: error instanceof Error
                    ? error
                    : new Error('signAccountOp: reading the sent to history failed')
            });
        }
    }
    /**
     * Why this account op needs the password/biometrics confirmation, or `null` when it does not.
     * Read live for the dapps, whose stored flag can change while the request is on screen.
     * Mobile only. A Safe needs it only when its hot owners can meet the threshold on their own.
     */
    get signingAuthRequirement() {
        if (!(0, helpers_2.isSigningAuthPlatform)(this.#platform))
            return null;
        if (this.account.safeCreation &&
            !(0, safe_2.canHotOwnersMeetSafeThreshold)(this.accountKeyStoreKeys, this.threshold))
            return null;
        const unauthenticatedDapps = (0, helpers_2.getUnauthenticatedDapps)(this.#accountOp.calls.map((call) => call.dapp?.id ? this.#dapps.getDapp(call.dapp.id) : undefined));
        // The cache belongs to a previous version of the calls until the activity read finishes,
        // so it must not be reported against the calls currently on screen
        const firstTimeRecipients = this.#firstTimeRecipients?.accountOpId === this.#accountOp.id
            ? this.#firstTimeRecipients.recipients
            : [];
        if (!firstTimeRecipients.length && !unauthenticatedDapps.length)
            return null;
        return { firstTimeRecipients, unauthenticatedDapps };
    }
    #rebuildBaseAccount() {
        const accountState = this.#accounts.accountStates[this.account.addr]?.[this.#network.chainId.toString()];
        if (!accountState)
            return;
        this.baseAccount = (0, getBaseAccount_1.getBaseAccount)(this.account, accountState, this.#network, this.#featureFlags.isFeatureEnabled('erc4337'), this.#featureFlags.isFeatureEnabled('eip7702'));
        this.gasPrice?.setBaseAccount(this.baseAccount);
    }
    #clearFeeSelection() {
        this.#paidBy = null;
        this.feeTokenResult = null;
        this.selectedOption = undefined;
        this.selectedFeeSpeed = signAccountOp_1.FeeSpeed.Medium;
        this.feeSpeeds = {};
        this.#updateAccountOp({ gasFeePayment: null });
    }
    #updateNonce(nonce) {
        if (this.#customSafeNonce !== null)
            return;
        this.#updateAccountOp({ nonce });
    }
    setSafeNonce(nonce) {
        if (!this.account.safeCreation) {
            const message = 'Nonce could not be set, Safe account data is missing';
            this.emitError({
                message,
                error: new Error(message),
                level: 'minor'
            });
            return;
        }
        if (this.status?.type && signAccountOp_1.noStateUpdateStatuses.includes(this.status.type)) {
            const message = 'Nonce cannot be set as the transaction is in a signing state';
            this.emitError({
                message,
                error: new Error(message),
                level: 'minor'
            });
            return;
        }
        if (this.accountOp.signed?.length || this.accountOp.safeTx?.confirmations?.length) {
            const message = 'Nonce cannot be set as the transaction is already signed';
            this.emitError({
                message,
                error: new Error(message),
                level: 'minor'
            });
            return;
        }
        if (nonce < 0n || nonce > viem_1.maxUint256) {
            const message = `Invalid nonce: ${nonce.toString()}`;
            this.emitError({
                message,
                error: new Error(message),
                level: 'minor'
            });
            return;
        }
        this.#customSafeNonce = nonce;
        this.#updateAccountOp({
            nonce,
            safeTx: this.accountOp.safeTx
                ? {
                    ...this.accountOp.safeTx,
                    nonce: nonce.toString()
                }
                : undefined,
            signature: null,
            txnId: undefined,
            asUserOperation: undefined
        });
        this.emitUpdate();
    }
    async refetchAccountState() {
        if (this.isRefetchingAccountState)
            return;
        this.isRefetchingAccountState = true;
        this.emitUpdate();
        try {
            await this.#accounts.updateAccountState(this.accountOp.accountAddr, 'pending', [this.accountOp.chainId], true);
            await this.#simulateAndEstimate();
        }
        catch (error) {
            this.emitError({
                level: 'silent',
                message: 'Unable to refresh your account information. Please try again.',
                error: error instanceof Error ? error : new Error(String(error))
            });
        }
        finally {
            this.isRefetchingAccountState = false;
            this.emitUpdate();
        }
    }
    #getSafeSigningData(accountState) {
        const safeTxn = (0, helpers_3.getSafeTxn)(this.accountOp, accountState);
        const typedData = this.baseAccount.getTxnTypedData(safeTxn);
        const safeTxnHash = (0, safe_2.getSafeTxnHash)(typedData);
        return {
            safeTxn,
            typedData,
            safeTxnHash,
            signingRequest: (0, signingRequest_1.getEIP712SigningRequest)({ ...typedData, safeTxHash: safeTxnHash })
        };
    }
    #updateSafeEip712Data() {
        if (!this.account.safeCreation || this.accountOp.meta?.isSafeDeploy) {
            this.safeEip712Data = null;
            return;
        }
        const accountState = this.#accounts.accountStates[this.account.addr]?.[this.#network.chainId.toString()];
        if (!accountState) {
            this.safeEip712Data = null;
            return;
        }
        try {
            this.safeEip712Data = (0, signingRequest_1.getSigningRequestDisplayData)(this.#getSafeSigningData(accountState).signingRequest);
        }
        catch (error) {
            this.safeEip712Data = null;
            this.emitError({
                message: 'Error calculating Safe EIP-712 data',
                error: error instanceof Error ? error : new Error(String(error)),
                level: 'silent'
            });
        }
    }
    #setHardwareWalletSigningRequest(request) {
        let serializedRequestData = null;
        try {
            if (request)
                serializedRequestData = (0, signingRequest_1.getSigningRequestDisplayData)(request);
        }
        catch {
            serializedRequestData = null;
        }
        this.hardwareWalletSigningRequest =
            request && serializedRequestData !== null
                ? {
                    ...request,
                    data: serializedRequestData
                }
                : null;
        this.emitUpdate();
    }
    async #withHardwareWalletSigningRequest(request, sign) {
        if (!request)
            return sign();
        this.#setHardwareWalletSigningRequest(request);
        try {
            return await sign();
        }
        finally {
            this.#setHardwareWalletSigningRequest(null);
        }
    }
    /** A speed up must be paid the same way as the pending transaction it replaces */
    #selectSpeedUpFeeOption() {
        if (!this.#speedUp || this.estimation.status !== types_2.EstimationStatus.Success)
            return;
        const replacedFeeOption = this.#speedUp.findReplacedFeeOption(this.estimation.availableFeeOptions);
        if (!replacedFeeOption)
            return;
        this.#paidBy = replacedFeeOption.paidBy;
        this.feeTokenResult = replacedFeeOption.token;
        this.selectedOption = replacedFeeOption;
    }
    /**
     * When speeding up a pending transaction, raises the gas prices of every speed
     * to the minimum the network needs to accept the replacement. The estimation keeps
     * running, so speeds that are already above that minimum are used as they are
     */
    #applySpeedUpMinFees(gasPrices) {
        return this.#speedUp ? this.#speedUp.applyMinFees(gasPrices) : gasPrices;
    }
    async #getDefaultSigner() {
        // call this method during signing only
        if (!this.accountOp.signingKeyAddr || !this.accountOp.signingKeyType)
            throw new Error('signing not set');
        const signer = await this.#keystore.getSigner(this.accountOp.signingKeyAddr, this.accountOp.signingKeyType);
        if (signer.init)
            signer.init(this.#externalSignerControllers[this.accountOp.signingKeyType]);
        return signer;
    }
    #validateAccountOp() {
        const invalidAccountOpError = 'The transaction is missing essential data. Please contact support.';
        if (!this.accountOp.accountAddr || !(0, ethers_1.isAddress)(this.accountOp.accountAddr)) {
            return { title: invalidAccountOpError, code: 'INVALID_ACCOUNT_ADDRESS' };
        }
        if (!this.accountOp.chainId || typeof this.accountOp.chainId !== 'bigint') {
            return { title: invalidAccountOpError, code: 'INVALID_CHAIN_ID' };
        }
        if (!this.accountOp.calls || !this.accountOp.calls.length) {
            return { title: invalidAccountOpError, code: 'NO_CALLS' };
        }
        if (
        // todo<safe>: a way to alarm the user of this
        !this.account.safeCreation &&
            this.accountOp.calls.some((c) => (0, ethers_1.isAddress)(c.to) &&
                (0, ethers_1.getAddress)(c.to) === (0, ethers_1.getAddress)(this.accountOp.accountAddr) &&
                c.data !== '0x'))
            return {
                title: 'A malicious transaction found in this batch.',
                code: 'CALL_TO_SELF'
            };
        const warnings = this.humanization
            .map((h) => h.warnings)
            .filter((w) => !!w)
            .flat();
        if (warnings.some((w) => w.blocking))
            return {
                title: 'A malicious transaction found in this batch.',
                code: warnings.map((w) => w.code).join(', ')
            };
        let callError = null;
        for (let index = 0; index < this.accountOp.calls.length; index++) {
            const call = this.accountOp.calls[index];
            if (!!call.data && !(0, ethers_1.isBytesLike)(call.data)) {
                callError = {
                    title: 'Invalid bytes-like string in call data.',
                    text: 'Please remove all invalid calls if you want to proceed.'
                };
                call.validationError = 'Invalid bytes-like string in call data';
                // Stop after the first invalid call
                break;
            }
            else if (call.to && !(0, ethers_1.isAddress)(call.to)) {
                callError = {
                    title: 'Invalid to address in call.',
                    text: 'Please remove all invalid calls if you want to proceed.'
                };
                call.validationError = 'Invalid to address in call.';
                // Stop after the first invalid call
                break;
            }
        }
        return callError;
    }
    #load() {
        this.#setDefaults();
        this.humanize();
        this.learnTokens();
        void this.#updateFirstTimeRecipients();
        let lastEstimationStatus = null;
        this.estimation.onUpdate(() => {
            this.update({ hasNewEstimation: true });
            // Retry asset discovery if the estimation managed to recover after failure
            // An example is doing an approval and a transaction immediately after - the second
            // transaction will fail before the approval txn is confirmed.
            if (lastEstimationStatus === types_2.EstimationStatus.Error &&
                this.estimation.status === types_2.EstimationStatus.Success) {
                this.setDiscoveryStatus(signAccountOp_1.TraceCallDiscoveryStatus.NotStarted);
                this.traceCall();
            }
            // Ignore the transient Loading status. estimate() emits Loading at its start,
            // so recording it here would overwrite a remembered Error before the following
            // Success is seen, and the Error -> Success recovery above would never be detected.
            if (this.estimation.status !== types_2.EstimationStatus.Loading)
                lastEstimationStatus = this.estimation.status;
        });
        this.gasPrice.onUpdate(() => {
            // if gas prices are not set OR there's no bundler estimation,
            // use the gas prices from the controller.
            // otherwise, we're good as gas price also come from the bundlerEstimation
            const shouldUseControllerGasPrices = !this.gasPrices || !this.estimation.estimation?.bundlerEstimation;
            const gasPrices = shouldUseControllerGasPrices ? this.gasPrice.gasPrices : undefined;
            // set only with the rpcWithBundlerFallback strategy (see BaseAccount.getGasPriceFetchStrategy)
            const rpcGasPrices = this.gasPrice.rpcGasPrices;
            if (!gasPrices && !rpcGasPrices)
                return;
            this.update({ gasPrices, rpcGasPrices });
        });
        this.gasPrice.onError((error) => {
            this.emitError(error);
        });
        this.#onDappsUpdateUnsubscribe = this.#dapps.onUpdate((forceEmit) => {
            this.propagateUpdate(forceEmit);
        }, 'sign-account-op-dapps-verification');
        this.#simulateAndEstimateOrSimulateInterval.start({
            runImmediately: true,
            timeout: intervals_1.ESTIMATE_UPDATE_INTERVAL
        });
        this.#gasPriceInterval.start({ runImmediately: true, timeout: intervals_1.GAS_PRICE_UPDATE_INTERVAL });
        // Started after the intervals, so they can be stopped if the pending transaction
        // was already processed while the request was opening
        this.#speedUp?.watchReplacedTransaction(() => this.#stopSpeedUp());
    }
    /**
     * During a speed up, the pending transaction that is being replaced may get processed before
     * the speed up is signed. Its place (nonce) is then taken, so there's nothing left to sign.
     * Returns whether it's done with the speed up, so the activity no longer needs to be watched
     */
    #stopSpeedUp() {
        // Signing is in progress, so this is checked again on the next activity update, or once
        // the status goes back to ReadyToSign (see #checkSpeedUpStillNeeded)
        if (this.status?.type === signAccountOp_1.SigningStatus.InProgress ||
            this.status?.type === signAccountOp_1.SigningStatus.WaitingForPaymaster)
            return false;
        // Already broadcast or already stopped
        if (this.status?.type === signAccountOp_1.SigningStatus.Done ||
            this.status?.type === signAccountOp_1.SigningStatus.SpeedUpNotNeeded)
            return true;
        this.#stopIntervals();
        this.updateStatus(signAccountOp_1.SigningStatus.SpeedUpNotNeeded);
        return true;
    }
    /**
     * Checks again whether the transaction being sped up was processed, once back to ReadyToSign.
     * It may have been processed while signing, so the broadcast fails as its place (nonce) is
     * taken, and with nothing left pending the activity may never update again
     */
    #checkSpeedUpStillNeeded() {
        if (this.status?.type !== signAccountOp_1.SigningStatus.ReadyToSign)
            return;
        this.#speedUp?.checkReplacedTransaction();
    }
    #withDecodedCalls(humanization) {
        return (0, decodeCall_1.withDecodedCalls)(humanization, (data) => this.#contractInfo.decodeCallData(data), (data) => this.#callDatasWithPendingSelectors.has(data));
    }
    #setHumanization(humanization, existingHumanizationId) {
        this.#humanization = this.#withDecodedCalls(humanization);
        this.isHumanizing = false;
        const currentHumanizationId = existingHumanizationId ?? this.createHumanizationId();
        this.humanizationId = currentHumanizationId;
        if (this.#humanization.length) {
            const updateBlacklistedStatusPromise = this.#phishing
                .updateAddressesBlacklistedStatus(this.#humanization
                .flatMap((call) => (0, utils_1.flattenHumanizerVisualizations)(call.fullVisualization)
                .filter((v) => v.type === 'token' || v.type === 'address')
                .map((v) => v.address))
                .filter((addr) => Boolean(addr)), (addressesStatus) => {
                if (!this.isCurrentHumanization(currentHumanizationId))
                    return;
                for (const call of this.#humanization) {
                    if (!call.fullVisualization)
                        continue;
                    for (const vis of (0, utils_1.flattenHumanizerVisualizations)(call.fullVisualization)) {
                        if ((vis.type === 'token' || vis.type === 'address') &&
                            vis.address &&
                            addressesStatus[vis.address]) {
                            vis.verification = addressesStatus[vis.address];
                        }
                    }
                }
                this.emitUpdate();
            })
                .finally(() => {
                if (this.#updateBlacklistedStatusPromise !== updateBlacklistedStatusPromise)
                    return;
                this.#updateBlacklistedStatusPromise = undefined;
                this.updateStatus();
            });
            this.#updateBlacklistedStatusPromise = updateBlacklistedStatusPromise;
        }
        this.emitUpdate();
        return currentHumanizationId;
    }
    #startHumanization() {
        return this.startHumanization((humanizationId) => {
            this.isHumanizing = true;
            this.humanizationId = humanizationId;
        });
    }
    #setFallbackHumanization(humanizationId) {
        if (!this.isCurrentHumanization(humanizationId) || this.humanizationId !== humanizationId) {
            return false;
        }
        this.#setHumanization((0, humanizer_1.humanizeAccountOp)(this.accountOp), humanizationId);
        this.learnTokens();
        return true;
    }
    #setErc7730Humanization(humanizationId, erc7730Descriptors) {
        if (!this.isCurrentHumanization(humanizationId) ||
            this.humanizationId !== humanizationId ||
            !Object.keys(erc7730Descriptors).length) {
            return false;
        }
        const erc7730Humanization = (0, humanizer_1.humanizeAccountOp)(this.accountOp, {
            erc7730Descriptors,
            nativeAssetSymbol: this.#network.nativeAssetSymbol
        });
        if (!(0, utils_1.hasErc7730Humanization)(erc7730Humanization) ||
            !this.isCurrentHumanization(humanizationId) ||
            this.humanizationId !== humanizationId) {
            return false;
        }
        this.#setHumanization(erc7730Humanization, humanizationId);
        this.learnTokens();
        return true;
    }
    #clearSelectorLoading() {
        clearTimeout(this.#selectorLoadingTimeout);
        this.#selectorLoadingTimeout = undefined;
        this.#callDatasWithPendingSelectors.clear();
    }
    #onCallDataSelectorsSettled(humanizationId, data) {
        if (!this.isCurrentHumanization(humanizationId))
            return;
        this.#callDatasWithPendingSelectors.delete(data);
        if (!this.#callDatasWithPendingSelectors.size)
            this.#clearSelectorLoading();
        this.#redecodeHumanization(humanizationId);
    }
    /**
     * Fetches the selectors of every call without holding back the humanization. Each call shows
     * as loading until its own selectors arrive, or until SELECTOR_LOADING_DEADLINE_MS passes, and
     * is decoded again once they do.
     */
    #fetchSelectorsForCalls(humanizationId) {
        this.#clearSelectorLoading();
        const callDatas = [...new Set(this.accountOp.calls.map(({ data }) => data))];
        callDatas.forEach((data) => this.#callDatasWithPendingSelectors.add(data));
        this.#selectorLoadingTimeout = setTimeout(() => {
            this.#selectorLoadingTimeout = undefined;
            this.#callDatasWithPendingSelectors.clear();
            this.#redecodeHumanization(humanizationId);
        }, contractInfo_1.SELECTOR_LOADING_DEADLINE_MS);
        // Fetched one call data at a time so each call stops loading on its own. They still share
        // requests, since selectors asked for close together are batched.
        callDatas.forEach((data) => {
            this.#contractInfo
                .fetchSelectorsForCallDatas([data])
                .then(() => this.#onCallDataSelectorsSettled(humanizationId, data))
                .catch((error) => {
                this.emitError({
                    level: 'silent',
                    message: 'Could not show the details of this transaction.',
                    error: error instanceof Error
                        ? error
                        : new Error('signAccountOp: decoding the calls with fetched selectors failed')
                });
            });
        });
    }
    async #applyDescriptorFirstHumanization(humanizationId) {
        // Started alongside the descriptors so the decoded fallback is ready for any call that turns
        // out to have no descriptor, without the descriptors ever waiting on it
        this.#fetchSelectorsForCalls(humanizationId);
        await this.applyDescriptorFirstHumanization({
            humanizationId,
            fetchDescriptor: () => this.#erc7730.getDescriptorsForAccountOp(this.accountOp),
            applyDescriptorHumanization: (erc7730Descriptors, currentHumanizationId) => this.#setErc7730Humanization(currentHumanizationId, erc7730Descriptors),
            applyFallbackHumanization: (currentHumanizationId) => this.#setFallbackHumanization(currentHumanizationId)
        });
    }
    /**
     * Decodes the shown calls again for selectors that arrived after they were shown, or once they
     * stop loading, emitting only when that changed any of them.
     */
    #redecodeHumanization(humanizationId) {
        if (!this.isCurrentHumanization(humanizationId) || this.isHumanizing)
            return;
        const humanization = this.#withDecodedCalls(this.#humanization);
        if (humanization === this.#humanization)
            return;
        this.#humanization = humanization;
        this.emitUpdate();
    }
    humanize() {
        const currentHumanizationId = this.#startHumanization();
        void this.#applyDescriptorFirstHumanization(currentHumanizationId);
    }
    learnTokens() {
        const additionalHints = this.humanization
            .map((call) => !call.fullVisualization
            ? []
            : (0, utils_1.flattenHumanizerVisualizations)(call.fullVisualization).map((vis) => vis.address && (0, ethers_1.isAddress)(vis.address) ? (0, ethers_1.getAddress)(vis.address) : ''))
            .flat()
            .filter((x) => (0, ethers_1.isAddress)(x));
        this.#portfolio.addTokensToBeLearned(additionalHints, this.#network.chainId);
    }
    get isInitialized() {
        return this.estimation && this.estimation.isInitialized();
    }
    #isNativeFeeOption(option) {
        return option.token.address === constants_1.ZERO_ADDRESS && !option.token.flags.onGasTank;
    }
    #getPreferredFeeOption(options) {
        const pref = this.feeTokenPreference[this.accountOp.chainId.toString()];
        if (pref) {
            // find the gas tank
            if (pref === 'gasTank') {
                return options.find((option) => option.token.flags.onGasTank);
            }
            // find the token/native
            return options.find((option) => !option.token.flags.onGasTank && option.token.address.toLowerCase() === pref.toLowerCase());
        }
        return undefined;
    }
    #getDefaultFeeOption(options, eoaOptions) {
        let selectableOptions = options.concat(eoaOptions);
        const notDisabled = options.filter((option) => !this.#getIsFeeOptionDisabled(option));
        const notDisabledEoa = eoaOptions.filter((option) => !this.#getIsFeeOptionDisabled(option));
        // always try to select a not disabled option, with preference for account options
        if (notDisabled.length) {
            selectableOptions = notDisabled;
        }
        else if (notDisabledEoa.length) {
            selectableOptions = notDisabledEoa;
        }
        // if the preferred option is not disabled, select it
        const preferred = this.#getPreferredFeeOption(selectableOptions);
        if (preferred)
            return preferred;
        return (selectableOptions.find((option) => this.#isNativeFeeOption(option)) ||
            selectableOptions.find((option) => option.token.flags.onGasTank) ||
            selectableOptions[0]);
    }
    #getFeeTokenPreference(feeToken) {
        const nextPreference = {
            ...this.feeTokenPreference
        };
        nextPreference[this.accountOp.chainId.toString()] = feeToken.flags.onGasTank
            ? 'gasTank'
            : feeToken.address;
        return nextPreference;
    }
    #doesFeeTokenPreferenceMatchToken(preference, feeToken) {
        const chainId = this.accountOp.chainId.toString();
        const chainPreference = preference[chainId];
        if (!chainPreference)
            return false;
        const isGasTank = feeToken.flags.onGasTank && chainPreference === 'gasTank';
        const isSelectedToken = !feeToken.flags.onGasTank && feeToken.address.toLowerCase() === chainPreference.toLowerCase();
        return isGasTank || isSelectedToken;
    }
    async #persistPendingFeeTokenPreference() {
        if (!this.pendingFeeTokenPreference)
            return;
        try {
            const nextFeeTokenPreference = this.pendingFeeTokenPreference;
            await this.#signAccountOpPreference.setFeeTokenPreference(nextFeeTokenPreference);
            this.feeTokenPreference = nextFeeTokenPreference;
            this.pendingFeeTokenPreference = null;
            this.emitUpdate();
        }
        catch (error) {
            this.emitError({
                message: 'Error saving SignAccountOp fee token preference',
                error: error instanceof Error ? error : new Error(String(error)),
                level: 'silent'
            });
        }
    }
    #updateSafeFeePayerLinks() {
        if (!this.account.safeCreation) {
            this.safeFeePayerLinks = null;
            return;
        }
        // The owners can differ per chain, so the chain's state wins over the ones from the import
        const accountState = this.#accounts.accountStates[this.account.addr]?.[this.#network.chainId.toString()];
        const owners = (accountState?.associatedKeys || this.account.associatedKeys).map((addr) => addr.toLowerCase());
        // Ordered from the one that paid last
        const feePayers = this.#activity
            .getFeePayers(this.account.addr, this.#network.chainId)
            .map((addr) => addr.toLowerCase());
        const linked = feePayers.filter((addr) => !owners.includes(addr));
        this.safeFeePayerLinks = { owners, linked, lastUsed: feePayers[0] || null };
    }
    /** See getSafeFeePayerRank. Every payer ranks the same for accounts that aren't Safes */
    #getSafeFeePayerRank(paidBy) {
        if (!this.safeFeePayerLinks)
            return 0;
        return (0, feePayerLinks_1.getSafeFeePayerRank)(paidBy, this.safeFeePayerLinks);
    }
    #isUnlinkedSafeFeePayer(paidBy) {
        if (!this.safeFeePayerLinks)
            return false;
        return (0, feePayerLinks_1.isUnlinkedSafeFeePayer)(paidBy, this.account.addr, this.safeFeePayerLinks);
    }
    /**
     * Whether signing only adds a Safe owner's signature and nothing gets executed. The signature
     * covers just the calls and the nonce, not who pays the fee, so no fee payment is needed for it.
     * A 1/1 Safe with its only key here executes right after signing, so it always needs one.
     */
    get #isCollectingSafeSignatureOnly() {
        if (!this.account.safeCreation || this.accountOp.meta?.isSafeDeploy)
            return false;
        if (this.canBroadcast)
            return false;
        const isQuickBroadcast = this.threshold === 1 && this.accountKeyStoreKeys.length === 1;
        return !isQuickBroadcast && (this.accountOp.signed?.length || 0) < this.threshold;
    }
    /**
     * Safes only: no payer is selected because the only default left would publicly link a new
     * EOA to the Safe, so the user has to choose one before executing.
     */
    get isSafeFeePayerChoiceRequired() {
        return (!!this.safeFeePayerLinks &&
            this.canBroadcast &&
            !this.isSponsored &&
            this.estimation.status === types_2.EstimationStatus.Success &&
            !!this.estimation.availableFeeOptions.length &&
            !this.#paidBy);
    }
    /**
     * Whether the selected fee payer would publicly link a new EOA to this Safe.
     * The Safe paying by itself (e.g. through the gas tank) links nothing.
     */
    get isFeePayerNotLinkedToSafe() {
        const paidBy = this.accountOp.gasFeePayment?.paidBy;
        if (!paidBy)
            return false;
        return this.#isUnlinkedSafeFeePayer(paidBy);
    }
    #setDefaults() {
        // Set the first signer as the default one.
        // If there are more available signers, the user will be able to select a different signer from the application.
        // The main benefit of having a default signer
        // is that it drastically simplifies the logic of determining whether the account is ready for signing.
        // For example, in the `sign` method and on the application screen, we can simply rely on the `this.readyToSign` flag.
        // Otherwise, if we don't have a default value, then `this.readyToSign` will always be false unless we set a signer.
        // In that case, on the application, we want the "Sign" button to be clickable/enabled,
        // and we have to check and expose the `SignAccountOp` controller's inner state to make this check possible.
        if (!this.accountOp.meta?.isSafeDeploy &&
            this.accountKeyStoreKeys.length &&
            (!this.accountOp.signingKeyAddr || !this.accountOp.signingKeyType)) {
            // always try to select the hotkey, if any, as default
            // as the ui doesn't need to switch if the user doesn't need to
            const hotKey = this.accountKeyStoreKeys.find((k) => k.type === 'internal');
            const defaultKey = hotKey ?? this.accountKeyStoreKeys[0];
            this.#updateAccountOp({
                signingKeyAddr: defaultKey.addr,
                signingKeyType: defaultKey.type
            });
        }
        if (this.estimation.status === types_2.EstimationStatus.Success && this.gasPrices) {
            this.#updateFeeSpeeds(); // needed for the logic below
            const payOptionsPaidByUsOrGasTank = this.estimation.availableFeeOptions
                .filter((feeOption) => feeOption.paidBy === this.accountOp.accountAddr)
                .sort(this.#sortFeeOptions.bind(this));
            this.#updateSafeFeePayerLinks();
            // For Safes, the last payer and then the others that don't link a new EOA to the Safe
            // come first, so one of them becomes the default. The account's own options (e.g. the
            // gas tank) still win over them in #getDefaultFeeOption when they can pay
            const payOptionsPaidByEOA = this.estimation.availableFeeOptions
                .filter((feeOption) => feeOption.paidBy !== this.accountOp.accountAddr)
                .sort((a, b) => this.#getSafeFeePayerRank(a.paidBy) - this.#getSafeFeePayerRank(b.paidBy) ||
                this.#sortFeeOptions(a, b));
            // Set default feeToken and paidBy
            if (!this.feeTokenResult && !this.#paidBy) {
                const selected = this.#getDefaultFeeOption(payOptionsPaidByUsOrGasTank, payOptionsPaidByEOA);
                // Linking a new EOA to the Safe is the user's call, so it's never made a default.
                // No payer is set and the user picks one, see isSafeFeePayerChoiceRequired
                const isPayerLeftToUser = !!selected && this.#isUnlinkedSafeFeePayer(selected.paidBy);
                if (!selected) {
                    console.error('Failed to set a default selected option. Perhaps native is not always returned for the account?');
                }
                else if (!isPayerLeftToUser) {
                    this.feeTokenResult = selected.token;
                    this.#paidBy = selected.paidBy;
                }
            }
        }
    }
    #setGasFeePayment(paidByKeyType) {
        if (this.isInitialized &&
            this.#paidBy &&
            this.selectedFeeSpeed &&
            this.feeTokenResult &&
            this.selectedOption) {
            this.#updateAccountOp({
                gasFeePayment: this.#getGasFeePayment(paidByKeyType)
            });
        }
    }
    // check if speeds are set for the given identifier
    hasSpeeds(identifier) {
        return this.feeSpeeds[identifier] !== undefined && this.feeSpeeds[identifier].length;
    }
    get errors() {
        // no errors on a signed txn
        if (this.status?.type === signAccountOp_1.SigningStatus.Queued)
            return [];
        const accountOpValidationError = this.#validateAccountOp();
        if (accountOpValidationError)
            return [accountOpValidationError];
        const errors = [];
        const estimationErrors = this.estimation.errors;
        if (estimationErrors.length)
            return estimationErrors;
        const isAmbireV1 = (0, account_1.isAmbireV1LinkedAccount)(this.account?.creation?.factoryAddr);
        const isAmbireV1AndNetworkNotSupported = isAmbireV1 && !(0, networks_1.hasRelayerSupport)(this.#network);
        // This must be the first error check!
        if (isAmbireV1AndNetworkNotSupported) {
            errors.push({
                title: 'Ambire v1 accounts are not supported on this network. To interact with this network, please use an Ambire Smart Account or an EOA account. You can still use v1 accounts on any network that is natively integrated with the Ambire web and mobile wallets.'
            });
            // Don't show any other errors
            return errors;
        }
        /**
         * A big block for logic separation
         * The above errors (estimation & ambireV1) are okay to be shown
         * even if isInitialized hasn't completed. Otherwise, do not load
         * any errors
         */
        if (!this.isInitialized)
            return [];
        // A speed up must be paid the same way as the pending transaction it replaces. Paid any
        // other way, it's sent as a new transaction and the same calls could run twice. The other
        // fee errors would be about a way of paying that can't be used, so they are not shown.
        // Checked once the fee options are known, and not only after a successful estimation, as
        // the options are kept while the estimation reloads and the error must not flicker away
        if (this.canBroadcast &&
            this.estimation.availableFeeOptions.length > 0 &&
            this.status?.type !== signAccountOp_1.SigningStatus.SpeedUpNotNeeded &&
            this.#speedUp?.isReplacedFeeOptionMissing(this.estimation.availableFeeOptions)) {
            return [
                {
                    title: "This transaction can't be sped up right now. The speed up has to be paid the same way as the original transaction, but that option isn't available anymore (for example, there isn't enough left to cover the fee). Add funds or wait for the original transaction to complete."
                }
            ];
        }
        const areGasPricesLoading = typeof this.gasPrices === 'undefined';
        if (!areGasPricesLoading && !this.gasPrices && this.canBroadcast) {
            errors.push({
                title: 'Gas price information is currently unavailable. This may be due to network congestion or connectivity issues. Please try again in a few moments or check your internet connection.'
            });
        }
        // this error should never happen as availableFeeOptions should always have the native option
        if (!this.isSponsored && !this.estimation.availableFeeOptions.length && this.canBroadcast)
            errors.push({
                title: 'Insufficient funds to cover the fee.'
            });
        const accountState = this.#accounts.accountStates[this.account.addr]?.[this.#network.chainId.toString()];
        if (!!this.account.safeCreation &&
            accountState &&
            !accountState.isDeployed &&
            !this.accountOp.meta?.isSafeDeploy) {
            errors.push({
                title: `Your Safe account isn't active on ${this.#network.name} yet. Activate it first, then try again.`
            });
        }
        // It may occur, only if there are no available signer.
        if (!this.accountOp.meta?.isSafeDeploy &&
            (!this.accountOp.signingKeyType || !this.accountOp.signingKeyAddr))
            errors.push({
                title: 'No keys available to sign this transaction.',
                code: 'NO_KEYS_AVAILABLE'
            });
        const currentPortfolio = this.#portfolio.getAccountPortfolioState(this.accountOp.accountAddr);
        const currentPortfolioNetwork = currentPortfolio[this.accountOp.chainId.toString()];
        const currentPortfolioNetworkNative = currentPortfolioNetwork?.result?.tokens.find((token) => token.address === ethers_1.ZeroAddress);
        if (!this.isSponsored && !currentPortfolioNetworkNative && this.canBroadcast)
            errors.push({
                title: 'Unable to estimate the transaction fee as fetching the latest price update for the network native token failed. Please try again later.'
            });
        // if there's no gasFeePayment calculate but there is: 1) feeTokenResult
        // 2) selectedOption and 3) gasSpeeds for selectedOption => return an error
        if (!this.isSponsored &&
            !this.accountOp.gasFeePayment &&
            this.feeTokenResult &&
            this.selectedOption &&
            this.canBroadcast) {
            const identifier = (0, helper_1.getFeeSpeedIdentifier)(this.selectedOption, this.accountOp.accountAddr);
            if (this.hasSpeeds(identifier) &&
                !this.#shouldSuppressTransferFeeSelectionError(this.selectedOption))
                errors.push({
                    title: 'Please select a token and an account for paying the gas fee.'
                });
        }
        if (!this.isSponsored &&
            this.selectedOption &&
            this.accountOp.gasFeePayment &&
            this.selectedOption.availableAmount < this.accountOp.gasFeePayment.amount &&
            !this.#shouldSuppressTransferFeeSelectionError(this.selectedOption) &&
            this.canBroadcast) {
            const speedCoverage = [];
            const identifier = (0, helper_1.getFeeSpeedIdentifier)(this.selectedOption, this.accountOp.accountAddr);
            if (this.feeSpeeds[identifier]) {
                this.feeSpeeds[identifier].forEach((speed) => {
                    if (this.selectedOption && this.selectedOption.availableAmount >= speed.amount)
                        speedCoverage.push(speed.type);
                });
            }
            if (speedCoverage.length === 0 && !!this.account.safeCreation) {
                errors.push({
                    title: this.selectedOption.paidBy === this.account.addr
                        ? 'Broadcasting transactions is possible only using an external account. Import or create one to broadcast your Safe transactions'
                        : errorHandling_1.ERRORS.eoaInsufficientFunds
                });
            }
            else if (speedCoverage.length === 0) {
                const isSA = (0, account_1.isSmartAccount)(this.account);
                const isUnableToCoverWithAllOtherTokens = this.estimation.availableFeeOptions.every((option) => {
                    if (option === this.selectedOption)
                        return true;
                    const optionIdentifier = (0, helper_1.getFeeSpeedIdentifier)(option, this.accountOp.accountAddr);
                    const speedsThatCanCover = this.feeSpeeds[optionIdentifier]?.filter((speed) => speed.amount <= option.availableAmount);
                    return !speedsThatCanCover?.length;
                });
                if (isUnableToCoverWithAllOtherTokens) {
                    // v1 acc handle
                    const state = this.#accounts.accountStates[this.account.addr]?.[this.#network.chainId.toString()];
                    const isV1 = this.account.creation && !state?.isV2;
                    if (isV1) {
                        errors.push({
                            title: 'Broadcasting Ambire v1 transactions is possible only by using an EOA. Import or create one to broadcast your transactions.'
                        });
                    }
                    else {
                        let skippedTokensCount = 0;
                        const gasTokenNames = gasTankFeeTokens_1.default
                            .filter(({ chainId, hiddenOnError }) => {
                            if (chainId !== this.accountOp.chainId)
                                return false;
                            if (hiddenOnError) {
                                skippedTokensCount++;
                                return false;
                            }
                            return true;
                        })
                            .map(({ symbol }) => symbol.toUpperCase())
                            .join(', ');
                        errors.push({
                            title: `${errorHandling_1.ERRORS.eoaInsufficientFunds}${isSA
                                ? ` Available fee options: USDC in Gas Tank, ${gasTokenNames}${skippedTokensCount ? ' and others' : ''}`
                                : ''}`
                        });
                    }
                }
                else {
                    errors.push({
                        title: isSA
                            ? "Signing is not possible with the selected account's token as it doesn't have sufficient funds to cover the gas payment fee."
                            : errorHandling_1.ERRORS.eoaInsufficientFunds
                    });
                }
            }
            else {
                errors.push({
                    title: 'The selected speed is not available due to insufficient funds. Please select a slower speed.'
                });
            }
        }
        // The signing might fail, tell the user why but allow the user to retry signing,
        // @ts-ignore fix TODO: type mismatch
        if (this.status?.type === signAccountOp_1.SigningStatus.ReadyToSign && !!this.status.error) {
            // @ts-ignore typescript complains, but the error being present gets checked above
            errors.push(this.status.error);
        }
        if (!this.isSponsored && !this.#feeSpeedsLoading && this.selectedOption && this.canBroadcast) {
            const identifier = (0, helper_1.getFeeSpeedIdentifier)(this.selectedOption, this.accountOp.accountAddr);
            if (!this.hasSpeeds(identifier)) {
                if (!this.feeTokenResult?.priceIn.length) {
                    errors.push({
                        title: `Currently, ${this.feeTokenResult?.symbol} is unavailable as a fee token as we're experiencing troubles fetching its price. Please select another or contact support`
                    });
                }
            }
        }
        // Safe txn, signed, with a future nonce: display an error.
        // Not for a speed up, which keeps the nonce of the pending transaction it replaces on
        // purpose. If that transaction gets processed first, the speed up is stopped instead
        if (!!this.account.safeCreation &&
            !this.accountOp.meta?.isSafeDeploy &&
            !this.#speedUp &&
            accountState &&
            this.accountOp.nonce &&
            this.accountOp.nonce !== accountState.nonce &&
            this.#accountOp.signed &&
            this.#accountOp.signed.length >= this.threshold) {
            errors.push({
                title: 'You need to broadcast pending transactions before this one.',
                action: 'refetch-account-state'
            });
        }
        return errors;
    }
    get readyToSign() {
        return (!!this.status &&
            (this.status?.type === signAccountOp_1.SigningStatus.ReadyToSign ||
                this.status?.type === signAccountOp_1.SigningStatus.UpdatesPaused ||
                this.status?.type === signAccountOp_1.SigningStatus.Queued ||
                this.status?.type === signAccountOp_1.SigningStatus.SafeQuickBroadcastBundler));
    }
    calculateWarnings() {
        if (!this.isInitialized)
            return;
        const warnings = [];
        const state = this.#portfolio.getAccountPortfolioState(this.accountOp.accountAddr);
        const unknownTokenWarnings = (0, helper_1.getUnknownTokenWarning)(state, this.accountOp.chainId);
        if (this.selectedOption) {
            const identifier = (0, helper_1.getFeeSpeedIdentifier)(this.selectedOption, this.accountOp.accountAddr);
            const feeTokenHasPrice = this.feeSpeeds[identifier]?.every((speed) => !!speed.amountUsd);
            const feeTokenPriceUnavailableWarning = (0, helper_1.getFeeTokenPriceUnavailableWarning)(!!this.hasSpeeds(identifier), !!feeTokenHasPrice, this.#featureFlags.isFeatureEnabled('tokenPrices'));
            // push the warning only if the txn is not sponsored
            if (!this.isSponsored && feeTokenPriceUnavailableWarning)
                warnings.push(feeTokenPriceUnavailableWarning);
        }
        if (unknownTokenWarnings)
            warnings.push(unknownTokenWarnings);
        const accountState = this.#accounts.accountStates[this.account.addr]?.[this.#network.chainId.toString()];
        if (this.account.creation && !accountState?.isV2 && errorHandling_1.WARNINGS.v1Acc)
            warnings.push(errorHandling_1.WARNINGS.v1Acc);
        const estimationWarnings = this.estimation.calculateWarnings(this.account);
        this.warnings = warnings.concat(estimationWarnings);
        this.emitUpdate();
    }
    /**
     * Updates the estimation and the portfolio simulation
     * for the current accountOp
     */
    async #simulateAndEstimate() {
        // Trace call the only if it hasn't been done yet for these calls
        const shouldTraceCall = this.traceCallDiscoveryStatus === signAccountOp_1.TraceCallDiscoveryStatus.NotStarted;
        // no simulation / estimation if we're in a signing state
        if (!this.canUpdate())
            return;
        if (shouldTraceCall)
            this.traceCall();
        await Promise.all([
            this.#portfolio.simulateAccountOp(this.accountOp),
            this.estimation.estimate(this.accountOp).catch((e) => e)
        ]);
        // calculate the warnings after the portfolio is fetched
        this.calculateWarnings();
        const estimation = this.estimation.estimation;
        // estimation.flags.hasNonceDiscrepancy is a signal from the estimation
        // that we should update the portfolio to get a correct simulation
        if (estimation && estimation.ambireEstimation && estimation.flags.hasNonceDiscrepancy) {
            this.#updateNonce(BigInt(estimation.ambireEstimation.ambireAccountNonce));
            await this.#portfolio.simulateAccountOp(this.accountOp);
        }
        // if the portfolio detects a nonce discrepancy and the estimation is a Success,
        // refetch the account state, resimulate and put the correct nonce in accountOp
        const portfolioState = this.#portfolio.getAccountPortfolioState(this.accountOp.accountAddr);
        const pendingPortfolioState = portfolioState
            ? portfolioState[this.accountOp.chainId.toString()]
            : null;
        if (this.estimation.status === types_2.EstimationStatus.Success &&
            pendingPortfolioState &&
            pendingPortfolioState.criticalError?.simulationErrorMsg &&
            pendingPortfolioState.criticalError?.simulationErrorMsg.indexOf('nonce did not increment') !==
                -1) {
            await this.#accounts.updateAccountState(this.accountOp.accountAddr, 'pending', [this.accountOp.chainId], true);
            const pendingAccountState = this.#accounts.accountStates[this.accountOp.accountAddr]?.[this.accountOp.chainId.toString()];
            if (pendingAccountState)
                this.#updateNonce(pendingAccountState.nonce);
            await this.#portfolio.simulateAccountOp(this.accountOp);
        }
        // if there's an estimation error, override the pending results
        if (this.estimation.status === types_2.EstimationStatus.Error) {
            await this.#portfolio.overrideSimulationResults(this.accountOp);
        }
    }
    /**
     * Either simulates+estimates or just estimates based on #shouldSimulate.
     * This is needed because in some cases (one click transfer/swap) we don't
     * need to simulate, just estimate.
     */
    async #simulateAndEstimateOrEstimate() {
        if (this.#stopRefetching || !this.estimation)
            return;
        // the first 10 times, reestimate once every 30s; then, slow down
        // the time as the user might just have closed the popup of the extension
        // in a ready-to-estimate state, resulting in meaningless requests
        const waitTime = this.#reestimateCounter < REESTIMATES_BEFORE_SLOWING_DOWN
            ? intervals_1.ESTIMATE_UPDATE_INTERVAL
            : SLOWED_DOWN_REESTIMATE_STEP * this.#reestimateCounter;
        // Update the timeout for the next run
        this.#simulateAndEstimateOrSimulateInterval.updateTimeout({ timeout: waitTime });
        await (this.#shouldSimulate
            ? this.#simulateAndEstimate()
            : this.estimation.estimate(this.accountOp));
        // Asking again cannot change the outcome, so there is nothing left to wait
        // for. Changing the calls or hitting retry starts the loop over.
        if (this.estimation.hasPermanentFailure()) {
            this.#stopIntervals();
            return;
        }
        if (this.#reestimateCounter >= exports.MAX_REESTIMATES) {
            this.#stopIntervals();
        }
        this.#reestimateCounter += 1;
    }
    #startGasPriceIntervalIfNoCustomPrices() {
        if (this.hasCustomGasPrices) {
            this.#gasPriceInterval.stop();
            return;
        }
        this.#gasPriceInterval.start({
            // Refetch immediately if the gas prices are stale
            runImmediately: !this.gasPrice.updatedAt || Date.now() - this.gasPrice.updatedAt > intervals_1.GAS_PRICE_UPDATE_INTERVAL
        });
    }
    /**
     * Refetches the gas price immediately and silently
     * (no errors emitted in case of failure). Also
     * restarts the gas price interval afterward.
     *
     * We can't simply restart the interval with runImmediately
     * because the interval is calling fetch() with a 'major' parameter
     */
    async #silentGasPriceUpdate() {
        this.#gasPriceInterval.stop();
        await this.gasPrice.fetch();
        this.#gasPriceInterval.restart();
    }
    #requestGasFeeChangedConfirmation() {
        if (this.selectedOption && this.selectedFeeSpeed) {
            const identifier = (0, helper_1.getFeeSpeedIdentifier)(this.selectedOption, this.accountOp.accountAddr);
            const selectedFee = this.feeSpeeds[identifier]?.find((fee) => fee.type === this.selectedFeeSpeed);
            this.previousFee = selectedFee ? { ...selectedFee } : null;
        }
        else {
            this.previousFee = null;
        }
        this.gasFeeChangedConfirmationRequired = true;
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async retry(method) {
        this.bundlerSwitcher.cleanUp();
        // Resuming instead of only restarting the interval, because refetching may
        // have been stopped by the give-up counter. A restart alone would be undone
        // by the interval's own #stopRefetching check on its first run.
        this.#resumeIntervals({ haveCallsChanged: true });
    }
    async enableErc4337AndReestimate() {
        await this.#featureFlags.setFeatureFlag('erc4337', true);
        this.#rebuildBaseAccount();
        this.#clearFeeSelection();
        this.bundlerSwitcher.cleanUp();
        this.gasPrice.areGasPricesUsedFromBundlerEstimation = false;
        try {
            await this.estimation.estimate(this.accountOp);
            this.update({ hasNewEstimation: true });
        }
        catch {
            // @justInCase basically, this is a re-estimate with proper errro handling
            // if it blows up for some reason, it should also blow up in
            // its proper places. No need to propagate the error here
        }
    }
    update({ gasPrices, rpcGasPrices, customGasPrices, customGasLimit, feeToken, pendingFeeTokenPreference, paidBy, speed, shouldPersistSpeed, signingKeyAddr, signingKeyType, signedTransactionsCount, hasNewEstimation, paidByKeyType, accountOpData }) {
        try {
            const isSpeedUpTransaction = this.isSpeedUpTransaction;
            // This must be at the top, otherwise it won't be updated because
            // most updates are frozen during the signing process
            if (typeof signedTransactionsCount !== 'undefined') {
                this.signedTransactionsCount = signedTransactionsCount;
                // If we add other exclusions we should figure out a way to emitUpdate only once
                this.emitUpdate();
                return;
            }
            // once the user commits to the things he sees on his screen,
            // we need to be sure nothing changes afterwards.
            // For example, signing can be slow if it's done by a hardware wallet.
            // The estimation gets refreshed on the other hand each 12 seconds (6 on optimism)
            // If we allow the estimation to affect the controller state during sign,
            // there could be discrepancy between what the user has agreed upon and what
            // we broadcast in the end
            if (this.status?.type && signAccountOp_1.noStateUpdateStatuses.indexOf(this.status?.type) !== -1) {
                return;
            }
            if (this.estimation.status === types_2.EstimationStatus.Success) {
                // Start the gas price interval in case it was stopped earlier
                this.#startGasPriceIntervalIfNoCustomPrices();
                const estimation = this.estimation.estimation;
                if (estimation.ambireEstimation && !isSpeedUpTransaction) {
                    this.#updateNonce(BigInt(estimation.ambireEstimation.ambireAccountNonce));
                }
            }
            else if (this.estimation.status === types_2.EstimationStatus.Error) {
                // No need to update gasPrices if the estimation failed
                this.#gasPriceInterval.stop();
            }
            // if there's a bundler estimation and the gasPrice for it has resolved, update the UI
            if (this.estimation.estimation) {
                if (this.estimation.estimation.bundlerGasPrices) {
                    // by transforming and setting the bundler gas prices as this.gasPrices, we accomplish two things:
                    // 1. we no longer need to wait for the gasPrice controller to complete in order to refresh the UI
                    // 2. we make sure we give priority to the bundler prices as they are generally better
                    if (!this.hasCustomGasPrices) {
                        this.gasPrices = this.estimation.estimation.bundlerGasPrices;
                    }
                    this.gasPrice.areGasPricesUsedFromBundlerEstimation = true;
                    // and we're stopping the gas price interval as
                    // we will use the bundler gas prices, unless the account
                    // also needs the RPC gas prices for its non-bundler broadcasts
                    if (this.baseAccount.getGasPriceFetchStrategy(this.#featureFlags.isFeatureEnabled('erc4337')) === 'rpcWithBundlerFallback') {
                        this.#startGasPriceIntervalIfNoCustomPrices();
                    }
                    else {
                        this.#gasPriceInterval.stop();
                    }
                }
                else {
                    // if there's an estimate, but no bundlerGasPrices, resume the gas price
                    // controller refetch as there's no other way to fetch gas prices
                    this.#startGasPriceIntervalIfNoCustomPrices();
                    this.gasPrice.areGasPricesUsedFromBundlerEstimation = false;
                }
            }
            if (accountOpData && !isSpeedUpTransaction) {
                const { calls, signature, ...rest } = accountOpData;
                if (signature && this.accountOp.txnId) {
                    const newlySigned = (0, safe_2.getAlreadySignedOwners)(signature, this.accountOp.txnId, this.accountOp.safeTx);
                    const signed = this.accountOp.signed
                        ? [...new Set(...this.accountOp.signed, ...newlySigned)]
                        : newlySigned;
                    this.#updateAccountOp({
                        signature: (0, safe_2.sortSigs)((0, safe_2.getSigs)(signature), this.accountOp.txnId, this.accountOp.safeTx?.confirmations),
                        signed
                    });
                }
                // update all properties except calls
                // calls are handled separately below
                this.#updateAccountOp(rest);
                if (Array.isArray(calls)) {
                    // we should update if the arrays are with diff length
                    let shouldUpdate = this.accountOp.calls.length !== calls.length;
                    if (!shouldUpdate) {
                        // if they are with the same length, check if some of
                        // their properties differ. If they do, we should update
                        this.accountOp.calls.forEach((call, i) => {
                            const newCall = calls[i];
                            if (call.to !== newCall?.to ||
                                call.data !== newCall?.data ||
                                call.value !== newCall?.value ||
                                call.id !== newCall?.id)
                                shouldUpdate = true;
                        });
                    }
                    // update only if there are differences in the calls array
                    // we do this to prevent double estimation problems
                    if (shouldUpdate) {
                        const hasNewCalls = this.accountOp.calls.length < calls.length;
                        this.#updateAccountOp({ calls });
                        this.humanize();
                        if (hasNewCalls) {
                            this.learnTokens();
                            // Reset the discovery status when the calls change to allow
                            // for rediscovery
                            this.setDiscoveryStatus(signAccountOp_1.TraceCallDiscoveryStatus.NotStarted);
                        }
                        this.#resumeIntervals({ haveCallsChanged: true });
                    }
                }
            }
            if (customGasPrices) {
                this.gasPrices = customGasPrices;
                this.hasCustomGasPrices = true;
                this.#gasPriceInterval.stop();
            }
            else if (gasPrices && !this.hasCustomGasPrices) {
                this.gasPrices = gasPrices;
            }
            if (rpcGasPrices) {
                this.rpcGasPrices = rpcGasPrices;
            }
            if (typeof customGasLimit !== 'undefined') {
                this.customGasLimit = customGasLimit;
            }
            if (typeof pendingFeeTokenPreference !== 'undefined') {
                this.pendingFeeTokenPreference = pendingFeeTokenPreference
                    ? this.#getFeeTokenPreference(pendingFeeTokenPreference)
                    : null;
            }
            if (feeToken && paidBy && !isSpeedUpTransaction) {
                this.#paidBy = paidBy;
                this.feeTokenResult = feeToken;
                if (this.pendingFeeTokenPreference &&
                    !this.#doesFeeTokenPreferenceMatchToken(this.pendingFeeTokenPreference, feeToken)) {
                    this.pendingFeeTokenPreference = null;
                }
                if (this.accountOp.gasFeePayment && this.accountOp.gasFeePayment.paidBy !== paidBy) {
                    // Reset paidByKeyType if the payer has changed
                    // A default value will be set in #setGasFeePayment
                    this.accountOp.gasFeePayment.paidByKeyType = null;
                }
            }
            if (speed && this.isInitialized) {
                this.selectedFeeSpeed = speed;
                // Only an explicitly picked speed becomes the default for the network.
                // Speeds set while switching the fee token are a fallback, not a choice
                if (shouldPersistSpeed) {
                    void this.#signAccountOpPreference.setFeeSpeedPreference({
                        ...this.#signAccountOpPreference.feeSpeedPreference,
                        [this.accountOp.chainId.toString()]: speed
                    });
                }
            }
            if (signingKeyAddr && signingKeyType && this.isInitialized && !isSpeedUpTransaction) {
                this.#updateAccountOp({ signingKeyAddr, signingKeyType });
                // If the fee is paid by the signer, then we should set the fee payer
                // key type to the signing key type (so the user doesn't have to select
                // the same key type twice)
                if (this.accountOp.gasFeePayment?.paidBy === signingKeyAddr) {
                    this.accountOp.gasFeePayment.paidByKeyType = signingKeyType;
                }
            }
            // Set defaults, if some of the optional params are omitted
            this.#setDefaults();
            // After the defaults, so the default fee option gets replaced with the pending transaction's
            this.#selectSpeedUpFeeOption();
            if (this.estimation.status === types_2.EstimationStatus.Success &&
                this.#paidBy &&
                this.feeTokenResult) {
                const selectedOption = this.estimation.availableFeeOptions.find((option) => option.paidBy === this.#paidBy &&
                    option.token.address === this.feeTokenResult.address &&
                    option.token.symbol.toLocaleLowerCase() ===
                        this.feeTokenResult.symbol.toLocaleLowerCase() &&
                    option.token.flags.onGasTank === this.feeTokenResult.flags.onGasTank);
                // <Bobby>: trigger setting the real default speed just before
                // setting the first selectedOption. This way we know all the
                // necessary information like available amount for the selected
                // option so we could calculate the fee speed if he doesn't have
                // enough for fast but has enough for slow/medium
                if (selectedOption)
                    this.#setDefaultFeeSpeed(selectedOption);
                this.selectedOption = selectedOption;
            }
            if (this.estimation.estimation &&
                this.estimation.estimation.bundlerEstimation &&
                this.estimation.estimation.bundlerEstimation.paymaster) {
                this.isSponsored = this.estimation.estimation.bundlerEstimation.paymaster.isSponsored();
                this.sponsor =
                    this.estimation.estimation.bundlerEstimation.paymaster.getEstimationData()?.sponsor;
            }
            // calculate the fee speeds if either there are no feeSpeeds
            // or any of properties for update is requested
            if (!Object.keys(this.feeSpeeds).length ||
                Array.isArray(accountOpData?.calls) ||
                gasPrices ||
                rpcGasPrices ||
                customGasPrices ||
                typeof customGasLimit !== 'undefined' ||
                this.#paidBy ||
                this.feeTokenResult ||
                hasNewEstimation) {
                this.#updateFeeSpeeds();
            }
            // Here, we expect to have most of the fields set, so we can safely set GasFeePayment
            this.#setGasFeePayment(paidByKeyType);
            this.updateStatus();
            this.calculateWarnings();
        }
        catch (e) {
            this.emitError({
                message: 'Error updating the SignAccountOpController',
                error: e,
                level: 'silent'
            });
        }
    }
    updateStatus(forceStatusChange, replacementFeeLow = false) {
        // final, the speed up can't go through anymore. Checked before the forced change too, as
        // a failed broadcast forces ReadyToSign, which would bring back a speed up that was stopped
        if (this.status?.type === signAccountOp_1.SigningStatus.SpeedUpNotNeeded)
            return;
        // use this to go back to ReadyToSign when a broadcasting error is emitted
        if (forceStatusChange) {
            this.status = { type: forceStatusChange };
            this.emitUpdate();
            this.#checkSpeedUpStillNeeded();
            return;
        }
        // no status updates on these two
        const isInTheMiddleOfSigning = this.status?.type === signAccountOp_1.SigningStatus.InProgress ||
            this.status?.type === signAccountOp_1.SigningStatus.WaitingForPaymaster;
        const isDone = this.status?.type === signAccountOp_1.SigningStatus.Done;
        if (isInTheMiddleOfSigning || isDone)
            return;
        // Set to EstimationError if not retrying
        if (this.estimation.error && !this.estimation.isRetryingFailure()) {
            this.status = { type: signAccountOp_1.SigningStatus.EstimationError };
            this.emitUpdate();
            return;
        }
        if (this.errors.length) {
            this.status = { type: signAccountOp_1.SigningStatus.UnableToSign };
            this.emitUpdate();
            return;
        }
        // change the status to SigningStatus.Queued if there are no
        // available signers to sign
        if (this.#accountOp.signature && this.#accountOp.txnId) {
            this.#accountOp.signed = (0, safe_2.getAlreadySignedOwners)(this.#accountOp.signature, this.#accountOp.txnId, this.#accountOp.safeTx);
            const notSigned = (0, safe_2.getImportedSignersThatHaveNotSigned)(this.#accountOp.signed, this.accountKeyStoreKeys.map((k) => k.addr));
            if (this.#accountOp.signed.length < this.threshold && !notSigned.length) {
                this.status = { type: signAccountOp_1.SigningStatus.Queued };
                this.emitUpdate();
                return;
            }
        }
        if (this.isInitialized &&
            (this.accountOp.meta?.isSafeDeploy ||
                (this.accountOp.signingKeyAddr && this.accountOp.signingKeyType)) &&
            (this.accountOp.gasFeePayment || this.#isCollectingSafeSignatureOnly)) {
            this.status = { type: signAccountOp_1.SigningStatus.ReadyToSign };
            // do not reset this once triggered
            if (replacementFeeLow)
                this.replacementFeeLow = replacementFeeLow;
            this.emitUpdate();
            this.#checkSpeedUpStillNeeded();
            return;
        }
        // reset the status if a valid state was not found
        this.status = null;
        this.emitUpdate();
    }
    destroy() {
        super.destroy();
        // Stop intervals
        this.#simulateAndEstimateOrSimulateInterval.stop();
        this.#gasPriceInterval.stop();
        this.#stopRefetching = true;
        this.stopHumanization();
        this.#clearSelectorLoading();
        // Destroy sub-controllers
        this.estimation.destroy();
        this.gasPrice.destroy();
        this.#onDappsUpdateUnsubscribe?.();
        this.#onDappsUpdateUnsubscribe = undefined;
        this.#speedUp?.destroy();
        // Other cleanup
        this.#hwCleanup();
        this.gasPrices = undefined;
        this.rpcGasPrices = undefined;
        this.hasCustomGasPrices = false;
        this.gasFeeChangedConfirmationRequired = false;
        this.previousFee = null;
        this.selectedFeeSpeed = signAccountOp_1.FeeSpeed.Medium;
        this.#paidBy = null;
        this.feeTokenResult = null;
        this.pendingFeeTokenPreference = null;
        this.status = null;
        this.signedTransactionsCount = null;
        this.hardwareWalletSigningRequest = null;
    }
    #getDappVerificationBanner() {
        const dappUrls = this.accountOp.calls
            .map((call) => call.dapp?.url?.toLowerCase())
            .filter((url) => !!url);
        if (!dappUrls.length)
            return null;
        // Pass the session ID so getDappVerificationBanner can check the session's frame context
        // for danger (e.g. a phishing page hosting the dApp in an iframe).
        const sessionId = this.accountOp.dappSessionId;
        const dappVerificationBanner = this.#dapps.getDappVerificationBanner(dappUrls, { sessionId });
        if (!dappVerificationBanner)
            return null;
        const containsPermit2 = this.accountOp.calls.some((call) => {
            if (!call.to || !call.data)
                return false;
            return (0, detectPermit2Interaction_1.isPermit2Interaction)({ to: call.to, data: call.data });
        });
        // Show the "not in catalog" banner only for Permit2 interactions to reduce noise on lower-risk actions.
        if (!containsPermit2 &&
            dappVerificationBanner.id === dapp_1.DAPP_VERIFICATION_BANNER_IDS.NOT_IN_CATALOG) {
            return null;
        }
        return dappVerificationBanner;
    }
    /**
     * Makes the signAccountOp controller inactive:
     * - Stops all refetching (estimation, gas price)
     * - Unregisters from the controller registry, which in turn stops all emit updates
     * to the UI
     * This is done so there is always only one signAccountOp controller active at a time,
     * and only one controller in the registry (so the UI listens to the active one only).
     */
    pause() {
        this.#stopIntervals();
        this.unregisterFromRegistry();
    }
    #stopIntervals() {
        this.#stopRefetching = true;
        // GasPrice may be destroyed at this point if the request was rejected
        this.#gasPriceInterval.stop();
        this.#simulateAndEstimateOrSimulateInterval.stop();
    }
    /**
     * Resumes the intervals of the signAccountOp controller, which may be paused
     * due to user inactivity or the controller being paused altogether.
     *
     * Also used to restart the intervals when the calls have changed.
     * That is because they may be stopped (after inactivity).
     */
    #resumeIntervals(opts) {
        // Nothing is left to estimate once the transaction being sped up was processed
        if (this.status?.type === signAccountOp_1.SigningStatus.SpeedUpNotNeeded)
            return;
        const { haveCallsChanged = false } = opts || {};
        // we want to restart the interval if signAccountOp is for a Safe.
        // the reason for this: there could be multiple Safe txns with
        // the same nonce waiting to be broadcast. The may want to check each
        // out in quick succession. If he does 1 -> 2 -> 1, calls would not
        // have changed on 1, but the simulation from 2 will persist as sadly,
        // the simulation is account based, not accountOp based
        const isSafe = !!this.account.safeCreation;
        this.#stopRefetching = false;
        this.#reestimateCounter = 0;
        this.#gasPriceInterval.start({
            runImmediately: !this.gasPrice.updatedAt || Date.now() - this.gasPrice.updatedAt > intervals_1.GAS_PRICE_UPDATE_INTERVAL
        });
        if (haveCallsChanged || isSafe) {
            // The simulateAndEstimateOrSimulateInterval must be restarted if the calls have changed
            // as that forces an immediate reestimation. start() does nothing
            // if the interval is already running.
            this.#simulateAndEstimateOrSimulateInterval.restart({
                runImmediately: true,
                // This must be true. Otherwise a pending estimation
                // will prevent a new estimation from being made
                // which is a must since the calls have changed
                allowOverlap: true
            });
        }
        else {
            this.#simulateAndEstimateOrSimulateInterval.start({
                runImmediately: !this.estimation.estimation?.updatedAt ||
                    Date.now() - this.estimation.estimation.updatedAt > intervals_1.ESTIMATE_UPDATE_INTERVAL
            });
        }
    }
    /**
     * Resumes updates and intervals for the signAccountOp controller.
     *
     * Also registers the controller in the controller registry.
     */
    resume() {
        this.registerInRegistry();
        this.#resumeIntervals();
        this.emitUpdate();
    }
    resetStatus() {
        // Final, the speed up can't go through anymore no matter what is reset
        if (this.status?.type === signAccountOp_1.SigningStatus.SpeedUpNotNeeded)
            return;
        this.status = null;
        this.emitUpdate();
    }
    #sortFeeOptions(a, b) {
        const aId = (0, helper_1.getFeeSpeedIdentifier)(a, this.accountOp.accountAddr);
        const aSlow = this.feeSpeeds[aId]?.find((speed) => speed.type === 'slow');
        if (!aSlow)
            return 1;
        const aCanCoverFee = (0, feeOptions_1.canFeeOptionCoverAmount)(a, this.accountOp, aSlow.amount);
        const bId = (0, helper_1.getFeeSpeedIdentifier)(b, this.accountOp.accountAddr);
        const bSlow = this.feeSpeeds[bId]?.find((speed) => speed.type === 'slow');
        if (!bSlow)
            return -1;
        const bCanCoverFee = (0, feeOptions_1.canFeeOptionCoverAmount)(b, this.accountOp, bSlow.amount);
        if (aCanCoverFee && !bCanCoverFee)
            return -1;
        if (!aCanCoverFee && bCanCoverFee)
            return 1;
        // native first
        if (this.#isNativeFeeOption(a) && !this.#isNativeFeeOption(b))
            return -1;
        if (!this.#isNativeFeeOption(a) && this.#isNativeFeeOption(b))
            return 1;
        // gas tank second
        if (a.token.flags.onGasTank && !b.token.flags.onGasTank)
            return -1;
        if (!a.token.flags.onGasTank && b.token.flags.onGasTank)
            return 1;
        if (!a || !b)
            return 0;
        const aPrice = a.token?.priceIn?.[0]?.price;
        const bPrice = b.token?.priceIn?.[0]?.price;
        if (aPrice && !bPrice)
            return -1;
        if (!aPrice && bPrice)
            return 1;
        return 0;
    }
    #getIsFeeOptionDisabled(feeOption) {
        const id = (0, helper_1.getFeeSpeedIdentifier)(feeOption, this.accountOp.accountAddr);
        const speeds = this.feeSpeeds[id] ?? [];
        const coversSlow = speeds.some((speed) => speed.type === signAccountOp_1.FeeSpeed.Slow &&
            (0, feeOptions_1.canFeeOptionCoverAmount)(feeOption, this.accountOp, speed.amount));
        if (!coversSlow)
            return true;
        const isExternal = this.accountKeyStoreKeys.some((keyStoreKey) => keyStoreKey.addr === feeOption.paidBy && keyStoreKey.isExternallyStored);
        const canNotBecomeSmarter = !(0, account_1.canBecomeSmarter)(this.account, this.accountKeyStoreKeys);
        if (isExternal && canNotBecomeSmarter && feeOption.token.address !== constants_1.ZERO_ADDRESS)
            return true;
        // disable native for safe accounts as it should be visible but not enabled
        if (this.account.safeCreation &&
            feeOption.paidBy === this.account.addr &&
            (0, helpers_1.isNative)(feeOption.token)) {
            return true;
        }
        return false;
    }
    #shouldSuppressTransferFeeSelectionError(feeOption) {
        if (this.#type !== 'one-click-transfer' ||
            !feeOption ||
            !(0, feeOptions_1.isTransferredTokenFeeOption)(feeOption, this.accountOp))
            return false;
        const feeAmount = this.accountOp.gasFeePayment?.amount;
        if (!feeAmount)
            return true;
        return (0, feeOptions_1.canFeeOptionCoverAmount)(feeOption, this.accountOp, feeAmount);
    }
    /**
     * Obtain the native token ratio in relation to a fee token.
     *
     * By knowing the USD value of the tokens in the portfolio,
     * we can calculate the ratio between a native token and a fee token.
     *
     * For example, 1 ETH = 8 BNB (ratio: 8).
     *
     * We require the ratio to be in a BigInt format since all the application values,
     * such as amount, gasLimit, etc., are also represented as BigInt numbers.
     */
    #getNativeToFeeTokenRatio(feeToken) {
        const native = this.#portfolio
            .getAccountPortfolioState(this.accountOp.accountAddr)[this.accountOp.chainId.toString()]?.result?.tokens.find((token) => token.address === ethers_1.ZeroAddress);
        if (!native)
            return null;
        // In case the fee token is the native token we don't want to depend to priceIn, as it might not be available.
        if (native.address === feeToken.address && native.chainId === feeToken.chainId)
            return BigInt(1 * 1e18);
        const isUsd = (price) => price.baseCurrency === 'usd';
        const nativePrice = native.priceIn.find(isUsd)?.price;
        const feeTokenPrice = feeToken.priceIn.find(isUsd)?.price;
        if (!nativePrice || !feeTokenPrice)
            return null;
        const ratio = nativePrice / feeTokenPrice;
        // Here we multiply it by 1e18, in order to keep the decimal precision.
        // Otherwise, passing the ratio to the BigInt constructor, we will lose the numbers after the decimal point.
        // Later, once we need to normalize this ratio, we should not forget to divide it by 1e18.
        const ratio1e18 = ratio * 1e18;
        const toBigInt = ratio1e18 % 1 === 0 ? ratio1e18 : ratio1e18.toFixed(0);
        return BigInt(toBigInt);
    }
    async traceCall() {
        if (this.traceCallDiscoveryStatus !== signAccountOp_1.TraceCallDiscoveryStatus.NotStarted) {
            console.warn('Trace call already in progress');
            return;
        }
        // clear the timeout on each new invoke
        if (this.traceCallTimeoutId)
            clearTimeout(this.traceCallTimeoutId);
        // Here, we also check the status because, in the case of re-estimation,
        // `traceCallDiscoveryStatus` is already set, and we don’t want to reset it to "InProgress".
        // This prevents the BalanceDecrease banner from flickering.
        if (this.traceCallDiscoveryStatus === signAccountOp_1.TraceCallDiscoveryStatus.NotStarted)
            this.setDiscoveryStatus(signAccountOp_1.TraceCallDiscoveryStatus.InProgress);
        const timeoutId = setTimeout(() => {
            // Prevent race conditions between multiple `traceCall` invocations
            if (this.traceCallDiscoveryStatus !== signAccountOp_1.TraceCallDiscoveryStatus.InProgress ||
                this.traceCallTimeoutId !== timeoutId)
                return;
        }, 2000);
        this.traceCallTimeoutId = timeoutId;
        try {
            const discoveredAssets = await (0, discoverTxnTokens_1.discoverTxnTokens)({
                account: this.account,
                accountOp: this.accountOp,
                accountState: this.#accounts.accountStates[this.account.addr]?.[this.#network.chainId.toString()],
                baseAccount: this.baseAccount,
                network: this.#network,
                isCurrent: () => this.traceCallTimeoutId === timeoutId
            });
            if (!discoveredAssets)
                return;
            const learnedNewTokens = this.#portfolio.addTokensToBeLearned(discoveredAssets.tokens, this.#network.chainId);
            const learnedNewNfts = this.#portfolio.addErc721sToBeLearned(discoveredAssets.nfts, this.account.addr, this.#network.chainId);
            if (this.canUpdate() &&
                (learnedNewTokens || learnedNewNfts) &&
                this.#onUpdateAfterTraceCallSuccess) {
                await this.#onUpdateAfterTraceCallSuccess();
            }
            this.setDiscoveryStatus(signAccountOp_1.TraceCallDiscoveryStatus.Done);
        }
        catch (e) {
            this.setDiscoveryStatus(signAccountOp_1.TraceCallDiscoveryStatus.Failed);
            this.emitError({
                level: 'silent',
                message: 'Error in signAccountOp.traceCall',
                error: e
            });
        }
        this.traceCallTimeoutId = null;
        clearTimeout(timeoutId);
    }
    #addExtra(gasInWei, percentageIncrease) {
        const percent = 100n / percentageIncrease;
        return (0, ethers_1.toBeHex)(gasInWei + gasInWei / percent);
    }
    /**
     * What is a good UX?
     * In the 4337 broadcast model, fee speeds don't make sense. That is
     * because it doesn't matter if you choose slow or fast, if the bundler
     * accepts the userOp, he is obliged to broadcast it as soon as possible.
     * Also, some bundlers return a single value for gas prices, meaning all
     * speed options should have the same cost
     *
     * But Ethereum UX doesn't work liket this.
     * Users expect to see a broadcast speed in the wallet itself and if
     * it's not present, they will find it strange.
     *
     * The soluiton here is to create the illusion of speeds in the 4337
     * broadcast model by increasing them only for the user payment but
     * using the original, bundler provided ones for broadcast.
     * That way we get a better bundler userOp acceptance rate and a
     * normal, intuitive UX
     */
    #getIncreasedPrices(gasPrices) {
        if (!gasPrices)
            return null;
        // no increase if the user has set them
        if (this.hasCustomGasPrices)
            return gasPrices;
        // no increase if there's no bundlerEstimation as this means
        // we're not using erc-4337 for broadcast
        if (!this.estimation.estimation?.bundlerEstimation)
            return gasPrices;
        return {
            slow: {
                maxFeePerGas: gasPrices.slow.maxFeePerGas,
                maxPriorityFeePerGas: gasPrices.slow.maxPriorityFeePerGas
            },
            medium: {
                maxFeePerGas: this.#addExtra(BigInt(gasPrices.medium.maxFeePerGas), 5n),
                maxPriorityFeePerGas: this.#addExtra(BigInt(gasPrices.medium.maxPriorityFeePerGas), 5n)
            },
            fast: {
                maxFeePerGas: this.#addExtra(BigInt(gasPrices.fast.maxFeePerGas), 7n),
                maxPriorityFeePerGas: this.#addExtra(BigInt(gasPrices.fast.maxPriorityFeePerGas), 7n)
            },
            ape: {
                maxFeePerGas: this.#addExtra(BigInt(gasPrices.ape.maxFeePerGas), 10n),
                maxPriorityFeePerGas: this.#addExtra(BigInt(gasPrices.ape.maxPriorityFeePerGas), 10n)
            }
        };
    }
    /**
     * Whether the broadcast option should use the RPC gas prices instead of the
     * bundler ones. Applicable only with the `rpcWithBundlerFallback` strategy
     * (see BaseAccount.getGasPriceFetchStrategy). If the RPC gas prices are not
     * fetched yet, gasPrices are used as a fallback
     */
    #shouldUseRpcGasPrices(broadcastOption) {
        if (this.hasCustomGasPrices || !this.rpcGasPrices)
            return false;
        if (this.baseAccount.getGasPriceFetchStrategy(this.#featureFlags.isFeatureEnabled('erc4337')) !==
            'rpcWithBundlerFallback')
            return false;
        return this.baseAccount.shouldUseRpcGasPrices(broadcastOption);
    }
    get #feeSpeedsLoading() {
        return !this.isInitialized || !this.gasPrices;
    }
    #setDefaultFeeSpeed(feePaymentOption) {
        // don't update if an option is already set
        if (this.selectedOption)
            return;
        const identifier = (0, helper_1.getFeeSpeedIdentifier)(feePaymentOption, this.account.addr);
        const speeds = this.feeSpeeds[identifier];
        if (!speeds)
            return;
        const preferredSpeed = this.#signAccountOpPreference.feeSpeedPreference[this.accountOp.chainId.toString()];
        if (preferredSpeed &&
            speeds.find(({ type, disabled }) => type === preferredSpeed && !disabled)) {
            this.selectedFeeSpeed = preferredSpeed;
            return;
        }
        // set medium if available
        if (speeds.find(({ type, disabled }) => type === signAccountOp_1.FeeSpeed.Medium && !disabled)) {
            this.selectedFeeSpeed = signAccountOp_1.FeeSpeed.Medium;
            return;
        }
        // set at least slow
        const fastestEnabledSpeed = [...speeds].reverse().find(({ disabled }) => !disabled);
        this.selectedFeeSpeed = fastestEnabledSpeed?.type || signAccountOp_1.FeeSpeed.Slow;
    }
    #updateFeeSpeeds() {
        if (this.estimation.status !== types_2.EstimationStatus.Success || !this.gasPrices)
            return;
        const estimation = this.estimation.estimation;
        // reset the fee speeds at the beginning to avoid duplications
        this.feeSpeeds = {};
        this.estimation.availableFeeOptions.forEach((option) => {
            // if a calculation has been made, do not make it again
            // EOA pays for SA is the most common case for this scenario
            const identifier = (0, helper_1.getFeeSpeedIdentifier)(option, this.accountOp.accountAddr);
            if (this.hasSpeeds(identifier)) {
                return;
            }
            // each available fee option should declare its estimation method
            const broadcastOption = this.baseAccount.getBroadcastOption(option, {
                op: this.accountOp,
                isSponsored: this.isSponsored
            });
            const nativeRatio = this.#getNativeToFeeTokenRatio(option.token);
            const shouldUseRpcGasPrices = this.#shouldUseRpcGasPrices(broadcastOption);
            const gasPrices = this.#applySpeedUpMinFees(shouldUseRpcGasPrices ? this.rpcGasPrices : this.gasPrices);
            // the RPC gas prices are used only for broadcasts outside erc-4337,
            // so they should not be increased
            const increasedGasPrices = shouldUseRpcGasPrices
                ? gasPrices
                : this.#getIncreasedPrices(gasPrices);
            if (!nativeRatio || !gasPrices || !increasedGasPrices) {
                this.feeSpeeds[identifier] = [];
                return;
            }
            // get the gas used for each payment option
            const gasUsed = this.baseAccount.getGasUsed(estimation, {
                feeToken: option.token,
                op: this.accountOp
            });
            const speeds = ['slow', 'medium', 'fast', 'ape'];
            for (let i = 0; i < speeds.length; i++) {
                // we have two prices:
                // receivedPrices, from old lib/bundler
                // and increasedPrices, which we use for the fee only
                const speed = speeds[i];
                const receivedPrices = gasPrices[speed];
                const increasedPrices = increasedGasPrices[speed];
                let amount;
                let simulatedGasLimit;
                let gasPrice;
                let maxPriorityFeePerGas;
                let amountGasPrice;
                let usesPaymaster = false;
                if (broadcastOption === broadcast_1.BROADCAST_OPTIONS.byBundler) {
                    if (!estimation.bundlerEstimation)
                        return;
                    usesPaymaster = !!estimation.bundlerEstimation?.paymaster.isUsable();
                    // no gas overhead for bundler broadcast
                    simulatedGasLimit =
                        BigInt(gasUsed) +
                            BigInt(estimation.bundlerEstimation.preVerificationGas) +
                            BigInt(option.gasUsed);
                    amountGasPrice = BigInt(increasedPrices.maxFeePerGas);
                    gasPrice = BigInt(receivedPrices.maxFeePerGas);
                    maxPriorityFeePerGas = BigInt(receivedPrices.maxPriorityFeePerGas);
                }
                else if (
                // EOA OR 7702: pays with native by itself
                broadcastOption === broadcast_1.BROADCAST_OPTIONS.bySelf ||
                    broadcastOption === broadcast_1.BROADCAST_OPTIONS.bySelf7702) {
                    simulatedGasLimit = (0, estimate_1.getGasLimitWithOverheadForSelfEOA)(gasUsed, this.accountOp.calls);
                    gasPrice = BigInt(increasedPrices.maxFeePerGas);
                    maxPriorityFeePerGas = BigInt(increasedPrices.maxPriorityFeePerGas);
                    amountGasPrice = BigInt(receivedPrices.maxFeePerGas);
                    this.accountOp.calls.forEach((call) => {
                        if (call.to && (0, ethers_1.getAddress)(call.to) === deploy_1.SINGLETON) {
                            simulatedGasLimit = (0, singleton_1.getGasUsed)(simulatedGasLimit);
                        }
                    });
                }
                else if (broadcastOption === broadcast_1.BROADCAST_OPTIONS.byOtherEOA) {
                    // Smart account, but EOA pays the fee
                    // 7702, and it pays for the fee by itself
                    simulatedGasLimit = (0, estimate_1.getGasLimitWithOverhead)(gasUsed);
                    gasPrice = BigInt(increasedPrices.maxFeePerGas);
                    maxPriorityFeePerGas = BigInt(increasedPrices.maxPriorityFeePerGas);
                    amountGasPrice = BigInt(receivedPrices.maxFeePerGas);
                }
                else {
                    // Relayer
                    simulatedGasLimit = gasUsed + option.gasUsed;
                    amountGasPrice = BigInt(increasedPrices.maxFeePerGas);
                    gasPrice = BigInt(increasedPrices.maxFeePerGas);
                    maxPriorityFeePerGas = BigInt(increasedPrices.maxPriorityFeePerGas);
                }
                if (typeof this.customGasLimit !== 'undefined') {
                    simulatedGasLimit = this.customGasLimit;
                }
                amount = (0, fees_1.calculateFeeAmount)({
                    broadcastOption,
                    simulatedGasLimit,
                    gasPrice: amountGasPrice,
                    nativeRatio,
                    feeTokenDecimals: option.token.decimals,
                    addedNative: broadcastOption === broadcast_1.BROADCAST_OPTIONS.byBundler ? 0n : option.addedNative,
                    usesPaymaster,
                    isAccountSafe: !!this.account.safeCreation,
                    network: this.#network
                });
                const feeSpeed = {
                    type: speed,
                    simulatedGasLimit,
                    amount,
                    amountFormatted: (0, ethers_1.formatUnits)(amount, Number(option.token.decimals)),
                    amountUsd: (0, helper_1.getTokenUsdAmount)(option.token, amount),
                    gasPrice,
                    // undefined will switch the broadcast type to 0, legacy
                    maxPriorityFeePerGas: maxPriorityFeePerGas > 0n ? maxPriorityFeePerGas : undefined,
                    disabled: !(0, feeOptions_1.canFeeOptionCoverAmount)(option, this.accountOp, amount)
                };
                if (this.feeSpeeds[identifier] === undefined)
                    this.feeSpeeds[identifier] = [];
                this.feeSpeeds[identifier].push(feeSpeed);
            }
        });
    }
    #getGasFeePayment(paidByKeyType) {
        if (!this.isInitialized) {
            this.emitError({
                level: 'major',
                message: 'Something went wrong while setting up the gas fee payment account and token. Please try again, selecting the account and token option. If the problem persists, contact support.',
                error: new Error('SignAccountOpController: The controller is not initialized while we are trying to build GasFeePayment.')
            });
            return null;
        }
        if (!this.#paidBy) {
            this.emitError({
                level: 'silent',
                message: '',
                error: new Error('SignAccountOpController: paying account not selected')
            });
            return null;
        }
        let updatedPaidByKeyType = this.accountOp.gasFeePayment?.paidByKeyType || null;
        // Update only if it's not set or it's passed as an argument
        if (paidByKeyType || !updatedPaidByKeyType) {
            const key = this.#keystore.getFeePayerKey(this.accountOp.accountAddr, this.#paidBy, paidByKeyType);
            // If paidBy is not an EOA then there will be an error here, because
            // the key of SAs is not the same as the address of the account.
            // We don't care about this here, as the validation is done during broadcast
            if (key instanceof Error) {
                updatedPaidByKeyType = null;
            }
            else {
                updatedPaidByKeyType = key.type;
            }
        }
        if (!this.feeTokenResult) {
            this.emitError({
                level: 'silent',
                message: '',
                error: new Error('SignAccountOpController: fee token not selected')
            });
            return null;
        }
        // if there are no availableFeeOptions, we don't have a gasFee
        // this is normal though as there are such cases:
        // - EOA paying in native but doesn't have any native
        // so no error should pop out because of this
        if (!this.estimation.availableFeeOptions.length) {
            return null;
        }
        if (!this.selectedOption) {
            this.emitError({
                level: 'silent',
                message: '',
                error: new Error('SignAccountOpController: paying option not found')
            });
            return null;
        }
        // if there are no fee speeds available for the option, it means
        // the nativeRatio could not be calculated. In that case, we do not
        // emit an error here but proceed and show an explanation to the user
        // in get errors()
        // check test: Signing [Relayer]: ... priceIn | native/Ratio
        const identifier = (0, helper_1.getFeeSpeedIdentifier)(this.selectedOption, this.accountOp.accountAddr);
        if (!this.feeSpeeds[identifier] || !this.feeSpeeds[identifier].length) {
            return null;
        }
        const chosenSpeed = this.feeSpeeds[identifier]?.find((speed) => speed.type === this.selectedFeeSpeed);
        if (!chosenSpeed) {
            this.emitError({
                level: 'silent',
                message: '',
                error: new Error('SignAccountOpController: fee speed not selected')
            });
            return null;
        }
        return {
            paidBy: this.#paidBy,
            paidByKeyType: updatedPaidByKeyType,
            isGasTank: this.feeTokenResult.flags.onGasTank,
            inToken: this.feeTokenResult.address,
            feeTokenChainId: this.feeTokenResult.chainId,
            amount: chosenSpeed.amount,
            simulatedGasLimit: this.customGasLimit ?? chosenSpeed.simulatedGasLimit,
            gasPrice: chosenSpeed.gasPrice,
            maxPriorityFeePerGas: 'maxPriorityFeePerGas' in chosenSpeed ? chosenSpeed.maxPriorityFeePerGas : undefined,
            isCustomGasLimit: typeof this.customGasLimit !== 'undefined',
            broadcastOption: this.baseAccount.getBroadcastOption(this.selectedOption, {
                op: this.accountOp,
                isSponsored: this.isSponsored
            })
        };
    }
    get feeToken() {
        return this.accountOp.gasFeePayment?.inToken || null;
    }
    get accountKeyStoreKeys() {
        // we take signing keys from the state as Safe account signers
        // may be different per network.
        // if the account isn't a Safe, we return the hardcoded associatedKeys
        // from the account itself in the accountState
        const state = this.#accounts.accountStates[this.account.addr]?.[this.#network.chainId.toString()];
        if (!state)
            return [];
        if (this.account.safeCreation)
            return state.importedAccountKeys;
        return this.#keystore.keys.filter((key) => state.associatedKeys.includes(key.addr));
    }
    get feePayerKeyStoreKeys() {
        const feePayer = this.#accounts.accounts.find(({ addr }) => addr === this.accountOp.gasFeePayment?.paidBy);
        if (!feePayer)
            return [];
        return this.#keystore.getAccountKeys(feePayer);
    }
    get speedOptions() {
        return Object.values(signAccountOp_1.FeeSpeed);
    }
    get gasSavedUSD() {
        if (!this.selectedOption?.token.flags.onGasTank)
            return null;
        const identifier = (0, helper_1.getFeeSpeedIdentifier)(this.selectedOption, this.accountOp.accountAddr);
        const selectedFeeSpeedData = this.feeSpeeds[identifier]?.find((speed) => speed.type === this.selectedFeeSpeed);
        const gasPrice = selectedFeeSpeedData?.gasPrice;
        if (!gasPrice)
            return null;
        // get the native token from the portfolio to calculate prices
        const native = this.#portfolio
            .getAccountPortfolioState(this.accountOp.accountAddr)[this.accountOp.chainId.toString()]?.result?.tokens.find((token) => token.address === ethers_1.ZeroAddress);
        if (!native)
            return null;
        const nativePrice = native.priceIn.find((price) => price.baseCurrency === 'usd')?.price;
        if (!nativePrice)
            return null;
        // 4337 gasUsed is set to 0 in the estimation as we rely
        // on the bundler for the estimation entirely => use hardcode value
        const gasUsedSelectedOption = this.selectedOption.gasUsed > 0n ? this.selectedOption.gasUsed : gas_1.GAS_TANK_TRANSFER_GAS_USED;
        const isNativeSelected = this.selectedOption.token.address === ethers_1.ZeroAddress;
        const gasUsedNative = this.estimation.availableFeeOptions.find((option) => option.token.address === ethers_1.ZeroAddress && !option.token.flags.onGasTank)?.gasUsed || gas_1.SA_NATIVE_TRANSFER_GAS_USED;
        const gasUsedERC20 = this.estimation.availableFeeOptions.find((option) => option.token.address !== ethers_1.ZeroAddress && !option.token.flags.onGasTank)?.gasUsed || gas_1.SA_ERC20_TRANSFER_GAS_USED;
        const gasUsedWithoutGasTank = isNativeSelected ? gasUsedNative : gasUsedERC20;
        const gasSavedInNative = (0, ethers_1.formatEther)((gasUsedWithoutGasTank - gasUsedSelectedOption) * gasPrice);
        return Number(gasSavedInNative) * nativePrice;
    }
    #emitSigningErrorAndResetToReadyToSign({ message, sendCrashReport, 
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    accountState }) {
        this.emitError({ level: 'major', message, error: new Error(message), sendCrashReport });
        this.status = { type: signAccountOp_1.SigningStatus.ReadyToSign };
        this.emitUpdate();
    }
    #addFeePayment() {
        // In case of gas tank token fee payment, we need to include one more call to account op
        const abiCoder = new ethers_1.AbiCoder();
        if (this.isSponsored) {
            this.#updateAccountOp({
                feeCall: {
                    to: addresses_1.FEE_COLLECTOR,
                    value: 0n,
                    data: abiCoder.encode(['string', 'uint256', 'string'], ['gasTank', 0n, 'USDC'])
                }
            });
            return;
        }
        if (this.accountOp.gasFeePayment.isGasTank) {
            this.#updateAccountOp({
                feeCall: {
                    to: addresses_1.FEE_COLLECTOR,
                    value: 0n,
                    data: abiCoder.encode(['string', 'uint256', 'string'], ['gasTank', this.accountOp.gasFeePayment.amount, this.feeTokenResult?.symbol])
                }
            });
            return;
        }
        if (this.accountOp.gasFeePayment.inToken === ethers_1.ZeroAddress) {
            // native payment
            this.#updateAccountOp({
                feeCall: {
                    to: addresses_1.FEE_COLLECTOR,
                    value: this.accountOp.gasFeePayment.amount,
                    data: '0x'
                }
            });
        }
        else {
            // token payment
            const ERC20Interface = new ethers_1.Interface(IERC20_json_1.default.abi);
            this.#updateAccountOp({
                feeCall: {
                    to: this.accountOp.gasFeePayment.inToken,
                    value: 0n,
                    data: ERC20Interface.encodeFunctionData('transfer', [
                        addresses_1.FEE_COLLECTOR,
                        this.accountOp.gasFeePayment.amount
                    ])
                }
            });
        }
    }
    async #getInitialUserOp(shouldReestimate, eip7702Auth, counter = 0) {
        const gasFeePayment = this.accountOp.gasFeePayment;
        let erc4337Estimation = this.estimation.estimation.bundlerEstimation;
        const accountState = await this.#accounts.getOrFetchAccountOnChainState(this.accountOp.accountAddr, this.accountOp.chainId);
        if (!accountState) {
            throw new EmittableError_1.default({
                message: `Missing mandatory transaction data (account state). ${errorHandling_1.RETRY_TO_INIT_ACCOUNT_OP_MSG}`,
                level: 'major'
            });
        }
        if (!this.gasPrices) {
            throw new EmittableError_1.default({
                message: `Missing mandatory transaction data (gas prices). ${errorHandling_1.RETRY_TO_INIT_ACCOUNT_OP_MSG}`,
                level: 'major'
            });
        }
        if (shouldReestimate) {
            const latestGasPricesResponse = await (0, estimateBundler_1.fetchBundlerGasPrice)(this.baseAccount, this.#network, this.bundlerSwitcher);
            const latestGasPrices = latestGasPricesResponse instanceof Error ? this.gasPrices : latestGasPricesResponse;
            const newEstimate = await (0, estimateBundler_1.bundlerEstimate)(this.baseAccount, accountState, this.accountOp, this.#network, [this.selectedOption.token], this.provider, latestGasPrices, this.bundlerSwitcher, eip7702Auth);
            if (newEstimate instanceof Error) {
                if (counter === 0) {
                    await this.#accounts
                        .updateAccountState(this.accountOp.accountAddr, 'pending', [this.accountOp.chainId], true)
                        .catch((e) => console.error(e));
                    return this.#getInitialUserOp(true, eip7702Auth, 1);
                }
                throw newEstimate;
            }
            // set the new estimation value
            erc4337Estimation = newEstimate;
            this.gasPrices = erc4337Estimation.gasPrice;
            gasFeePayment.gasPrice = BigInt(this.gasPrices[this.selectedFeeSpeed].maxFeePerGas);
            gasFeePayment.maxPriorityFeePerGas = BigInt(this.gasPrices[this.selectedFeeSpeed].maxPriorityFeePerGas);
        }
        const userOperation = (0, userOperation_1.getUserOperation)({
            account: this.account,
            accountState,
            accountOp: this.accountOp,
            bundler: this.bundlerSwitcher.getBundler().getName(),
            entryPointSig: this.accountOp.meta?.entryPointAuthorization,
            eip7702Auth,
            hasPendingUserOp: !!(this.#activity.broadcastedButNotConfirmed[this.account.addr] || []).find((accOp) => accOp.accountAddr === this.account.addr &&
                accOp.chainId === this.#network.chainId &&
                !!accOp.asUserOperation)
        });
        let callGasLimit = BigInt(erc4337Estimation.callGasLimit) + this.selectedOption.gasUsed;
        // add the extra gas estimates in case of a safe
        // re-estimation is not applied here
        if (!!this.account.safeCreation) {
            const gasUsed = this.baseAccount.getGasUsed(this.estimation.estimation, {
                feeToken: this.selectedOption.token,
                op: this.accountOp
            });
            callGasLimit = gasUsed + this.selectedOption.gasUsed;
        }
        userOperation.preVerificationGas = erc4337Estimation.preVerificationGas;
        userOperation.callGasLimit = (0, ethers_1.toBeHex)(callGasLimit);
        userOperation.verificationGasLimit = erc4337Estimation.verificationGasLimit;
        userOperation.maxFeePerGas = (0, ethers_1.toBeHex)(gasFeePayment.gasPrice);
        userOperation.maxPriorityFeePerGas = (0, ethers_1.toBeHex)(gasFeePayment.maxPriorityFeePerGas);
        userOperation.callData = (0, userOperation_1.getUserOpCalldata)(this.account, this.accountOp, accountState);
        return userOperation;
    }
    async #getPaymasterUserOp(originalUserOp, paymaster, eip7702Auth, counter = 0) {
        if (!paymaster.isUsable())
            return { required: false };
        const localOp = { ...originalUserOp };
        // set the paymaster properties
        const erc4337Estimation = this.estimation.estimation.bundlerEstimation;
        localOp.paymasterVerificationGasLimit = erc4337Estimation.paymasterVerificationGasLimit;
        localOp.paymasterPostOpGasLimit = erc4337Estimation.paymasterPostOpGasLimit;
        // some bundlers (etherspot) don't return values for paymaster gas limits
        // so we need to set them manually
        // other (gelato) may return below the min
        if (paymaster.isEstimateBelowMin(localOp)) {
            const estimationData = paymaster.getEstimationData();
            localOp.paymasterVerificationGasLimit = estimationData.paymasterVerificationGasLimit;
            localOp.paymasterPostOpGasLimit = estimationData.paymasterPostOpGasLimit;
        }
        // persist the paymaster properties from the pm_stubData request if any
        if (paymaster.isSponsored() && paymaster.sponsorDataEstimation) {
            if (paymaster.sponsorDataEstimation.paymasterVerificationGasLimit) {
                localOp.paymasterVerificationGasLimit =
                    paymaster.sponsorDataEstimation.paymasterVerificationGasLimit;
            }
            if (paymaster.sponsorDataEstimation.paymasterPostOpGasLimit) {
                localOp.paymasterPostOpGasLimit = paymaster.sponsorDataEstimation.paymasterPostOpGasLimit;
            }
        }
        const response = await paymaster.call(this.account, this.accountOp, localOp, this.#network);
        if (response.success) {
            const paymasterData = response;
            localOp.paymaster = paymasterData.paymaster;
            localOp.paymasterData = paymasterData.paymasterData;
            // if it's a safe account, add the SAFE_SIGNER signature
            if (this.account.safeCreation) {
                if (!paymasterData.signature) {
                    const error = 'Gas tank is currently unavailable';
                    return {
                        required: true,
                        success: false,
                        errorResponse: {
                            success: false,
                            message: error,
                            error: new Error(error)
                        }
                    };
                }
                localOp.signature = paymasterData.signature;
            }
            return {
                userOp: localOp,
                required: true,
                success: true
            };
        }
        const errorResponse = response;
        if (errorResponse.message.indexOf('invalid account nonce') !== -1) {
            // continue on error as this is an attempt for an UX improvement
            await this.#accounts
                .updateAccountState(this.accountOp.accountAddr, 'pending', [this.accountOp.chainId], true)
                .catch((e) => console.error(e));
        }
        if (paymaster.isAmbire() && counter === 0 && !this.account.safeCreation) {
            const reestimatedUserOp = await this.#getInitialUserOp(true, eip7702Auth);
            return this.#getPaymasterUserOp(reestimatedUserOp, paymaster, eip7702Auth, counter + 1);
        }
        return {
            required: true,
            success: false,
            errorResponse
        };
    }
    async sign() {
        if (!this.readyToSign) {
            const message = `Unable to sign the transaction. During the preparation step, the necessary transaction data was not received. ${errorHandling_1.RETRY_TO_INIT_ACCOUNT_OP_MSG}`;
            return this.#emitSigningErrorAndResetToReadyToSign({ message });
        }
        // when signing begings, we stop immediatelly state updates on the controller
        // by changing the status to InProgress. Check update() for more info
        this.status = { type: signAccountOp_1.SigningStatus.InProgress };
        this.#hwCleanup();
        const isSafeDeploy = !!this.accountOp.meta?.isSafeDeploy;
        const signingKeyAddr = this.accountOp.signingKeyAddr;
        const signingKeyType = this.accountOp.signingKeyType;
        if (!isSafeDeploy && (!signingKeyAddr || !signingKeyType)) {
            const message = `Unable to sign the transaction. During the preparation step, required signing key information was found missing. ${errorHandling_1.RETRY_TO_INIT_ACCOUNT_OP_MSG}`;
            return this.#emitSigningErrorAndResetToReadyToSign({ message });
        }
        const missingGasFeePaymentMessage = `Unable to sign the transaction. During the preparation step, required information about paying the gas fee was found missing. ${errorHandling_1.RETRY_TO_INIT_ACCOUNT_OP_MSG}`;
        const hasGasFeePayment = !!this.accountOp.gasFeePayment && !!this.selectedOption;
        if (!hasGasFeePayment && !this.#isCollectingSafeSignatureOnly) {
            return this.#emitSigningErrorAndResetToReadyToSign({ message: missingGasFeePaymentMessage });
        }
        if (!this.estimation.estimation) {
            const message = `Unable to sign the transaction. During the preparation step, required account key information was found missing. ${errorHandling_1.RETRY_TO_INIT_ACCOUNT_OP_MSG}`;
            return this.#emitSigningErrorAndResetToReadyToSign({ message });
        }
        await this.#persistPendingFeeTokenPreference();
        const estimation = this.estimation.estimation;
        // Missing only while collecting a Safe signature, see #isCollectingSafeSignatureOnly
        const broadcastOption = this.accountOp.gasFeePayment?.broadcastOption;
        const isUsingPaymaster = !!estimation.bundlerEstimation?.paymaster.isUsable();
        const shouldSignDeployAuth = !!broadcastOption && this.baseAccount.shouldSignDeployAuth(broadcastOption);
        // tell the FE where we are
        if (shouldSignDeployAuth) {
            this.shouldSignAuth = {
                type: 'V2Deploy',
                text: 'Step 1/2 preparing account'
            };
        }
        // in Safe, you won't have to choose the signers, and they could be multiple
        // we need to take the signers from the account state
        // check which we have in the extension (they will be in keystore)
        // decide what to do from that point onwards
        const isExternalSignerInvolved = (!!this.accountOp.gasFeePayment &&
            this.accountOp.gasFeePayment.paidByKeyType !== 'internal') ||
            this.accountOp.signingKeyType !== 'internal';
        const isCollectingSafeSignature = !!this.account.safeCreation &&
            !isSafeDeploy &&
            (this.accountOp.signed?.length || 0) < this.threshold;
        const isImmediatelyWaitingForPaymaster = broadcastOption === broadcast_1.BROADCAST_OPTIONS.byBundler &&
            isUsingPaymaster &&
            !shouldSignDeployAuth &&
            !this.baseAccount.shouldSignAuthorization(broadcast_1.BROADCAST_OPTIONS.byBundler) &&
            !isCollectingSafeSignature;
        if (isImmediatelyWaitingForPaymaster)
            this.status = { type: signAccountOp_1.SigningStatus.WaitingForPaymaster };
        // we update the FE with the changed status (in progress) only after the checks
        // above confirm everything is okay to prevent two different state updates
        this.emitUpdate();
        // just in-case: before signing begins, we delete the feeCall;
        // if there's a need for it, it will be added later on in the code.
        // We need this precaution because this could happen:
        // - try to broadcast with the relayer
        // - the feel call gets added
        // - the relayer broadcast fails
        // - the user does another broadcast, this time with EOA pays for SA
        // - the fee call stays, causing a low gas limit revert
        delete this.#accountOp.feeCall;
        // delete the activatorCall as a precaution that it won't be added twice
        delete this.#accountOp.activatorCall;
        // @EntryPoint activation for SA
        if (this.accountOp.gasFeePayment &&
            this.baseAccount.shouldIncludeActivatorCall(this.accountOp.gasFeePayment.paidBy)) {
            this.#accountOp.activatorCall = (0, userOperation_1.getActivatorCall)(this.accountOp.accountAddr);
        }
        const accountState = await this.#accounts.getOrFetchAccountOnChainState(this.accountOp.accountAddr, this.accountOp.chainId);
        if (!accountState) {
            const message = `Unable to sign the transaction. During the preparation step, required transaction information was found missing (account state). ${errorHandling_1.RETRY_TO_INIT_ACCOUNT_OP_MSG}`;
            return this.#emitSigningErrorAndResetToReadyToSign({ message, accountState });
        }
        try {
            if (isSafeDeploy) {
                this.#updateAccountOp({ signature: '0x' });
            }
            else if (this.account.safeCreation &&
                !isSafeDeploy &&
                this.#accountOp.signed &&
                this.#accountOp.signed.length >= this.threshold &&
                broadcastOption !== broadcast_1.BROADCAST_OPTIONS.byBundler) {
                // all's good, proceed to broadcast
            }
            else if (this.account.safeCreation &&
                !isSafeDeploy &&
                (this.#accountOp.signed?.length || 0) < this.threshold) {
                // If the Safe txn is not already signed, fetch the latest nonce unless
                // the user explicitly selected one for this transaction.
                if (!this.accountOp.safeTx && this.#customSafeNonce === null) {
                    const latestNonce = await (0, safe_2.getNonce)(this.accountOp.accountAddr, this.provider).catch((e) => {
                        console.log('failed to retrieve the latest nonce for Safe');
                        console.log(e);
                        return null;
                    });
                    if (latestNonce) {
                        this.#updateNonce(latestNonce);
                    }
                }
                const prevSignedSigs = (0, safe_2.getSigs)(this.accountOp.signature);
                const nowSignedSigs = [];
                const safeSigner = await this.#keystore.getSigner(signingKeyAddr, signingKeyType);
                if (safeSigner.init)
                    safeSigner.init(this.#externalSignerControllers[signingKeyType]);
                const { safeTxn, typedData, safeTxnHash, signingRequest } = this.#getSafeSigningData(accountState);
                const signature = (await this.#withHardwareWalletSigningRequest(signingRequest, () => safeSigner.signTypedData(typedData, {
                    chainId: this.#network.chainId,
                    provider: this.provider
                })));
                nowSignedSigs.push(signature);
                // all the signers that have signed
                const allSigners = this.accountOp.signed
                    ? this.accountOp.signed.concat([signingKeyAddr])
                    : [signingKeyAddr];
                const isQuickBroadcast = this.threshold === 1 &&
                    this.accountKeyStoreKeys.length === 1 &&
                    (!this.#customSafeNonce || this.#customSafeNonce === accountState.nonce);
                if (!isQuickBroadcast) {
                    if (!prevSignedSigs.length) {
                        // propose the txn to Safe Global upon first entry
                        await (0, with_timeout_1.withTimeout)(() => (0, safe_2.propose)(safeTxn, this.accountOp.chainId, this.account.addr, this.#accountOp.signingKeyAddr, signature, safeTxnHash), {
                            timeoutMs: safe_1.SAFE_API_TIMEOUT_MS,
                            message: `Safe API: propose transaction timed out after ${safe_1.SAFE_API_TIMEOUT_MS}ms`
                        }).catch((e) => {
                            this.hasSafeApiFailed = true;
                            console.log('Safe API: failed to propose txn', e);
                        });
                    }
                    else {
                        // add extra confirmations
                        await (0, with_timeout_1.withTimeout)(() => (0, safe_2.confirm)(this.accountOp.chainId, signature, safeTxnHash), {
                            timeoutMs: safe_1.SAFE_API_TIMEOUT_MS,
                            message: `Safe API: confirm transaction timed out after ${safe_1.SAFE_API_TIMEOUT_MS}ms`
                        }).catch((e) => {
                            this.hasSafeApiFailed = true;
                            console.log('Safe API: failed to confirm txn', e);
                        });
                    }
                    this.status = { type: signAccountOp_1.SigningStatus.Queued };
                }
                this.#updateAccountOp({
                    signature: (0, safe_2.sortSigs)(prevSignedSigs.concat(nowSignedSigs), safeTxnHash, this.accountOp.safeTx?.confirmations),
                    signed: allSigners,
                    txnId: safeTxnHash
                });
                // change to quick broadcast mode so we could sign immediately
                // the userOp and broadcast it
                if (isQuickBroadcast && broadcastOption === broadcast_1.BROADCAST_OPTIONS.byBundler) {
                    this.status = { type: signAccountOp_1.SigningStatus.SafeQuickBroadcastBundler };
                }
            }
            else if (!this.accountOp.gasFeePayment || !this.selectedOption) {
                // Only collecting a Safe signature goes without a fee payment, everything below pays it
                return this.#emitSigningErrorAndResetToReadyToSign({
                    message: missingGasFeePaymentMessage,
                    accountState
                });
            }
            else if (broadcastOption === broadcast_1.BROADCAST_OPTIONS.bySelf ||
                broadcastOption === broadcast_1.BROADCAST_OPTIONS.bySelf7702) {
                // plain EOA
                // rawTxn, No SA signatures
                // or 7702, calling executeBySender(). No SA signatures
                this.#updateAccountOp({ signature: '0x' });
            }
            else if (broadcastOption === broadcast_1.BROADCAST_OPTIONS.byOtherEOA) {
                // SA, EOA pays fee. execute() needs a signature
                if (!this.isSpeedUpTransaction) {
                    // fetch the nonce if needed
                    const nonce = await this.baseAccount.getBroadcastNonce(this.#activity, this.accountOp, this.provider);
                    if (nonce !== this.accountOp.nonce)
                        this.#updateNonce(nonce);
                    const signer = await this.#getDefaultSigner();
                    this.#updateAccountOp({
                        signature: await this.#withHardwareWalletSigningRequest((0, signingRequest_1.getExecuteSigningRequest)({
                            accountOp: this.accountOp,
                            accountState,
                            network: this.#network
                        }), () => (0, signMessage_1.getExecuteSignature)(this.#network, this.accountOp, accountState, signer, this.provider))
                    });
                }
            }
            else if (broadcastOption === broadcast_1.BROADCAST_OPTIONS.delegation) {
                // a delegation request has been made
                if (!this.accountOp.meta) {
                    this.#updateAccountOp({ meta: {} });
                }
                const contract = this.accountOp.meta?.setDelegation || this.accountOp.calls.length > 1
                    ? (0, _7702_1.getContractImplementation)(this.#network.chainId, this.accountKeyStoreKeys)
                    : ethers_1.ZeroAddress;
                if (this.accountOp.meta) {
                    if (isExternalSignerInvolved)
                        this.shouldSignAuth = { type: '7702', text: 'Step 1/2 preparing account' };
                    const signer = await this.#getDefaultSigner();
                    const authorization = {
                        chainId: this.#network.chainId,
                        contract,
                        // because we're broadcasting by ourselves, we need to add 1 to the nonce
                        // as the sender nonce (the curr acc) gets incremented before the
                        // authrorization validation
                        nonce: accountState.eoaNonce + 1n
                    };
                    this.accountOp.meta.delegation = (0, signMessage_1.get7702Sig)(this.#network.chainId, authorization.nonce, contract, await this.#withHardwareWalletSigningRequest((0, signingRequest_1.get7702AuthorizationSigningRequest)(authorization), () => signer.sign7702(authorization)));
                    if (isExternalSignerInvolved)
                        this.shouldSignAuth = { type: '7702', text: 'Step 2/2 signing transaction' };
                }
                this.#updateAccountOp({ signature: '0x' });
            }
            else if (broadcastOption === broadcast_1.BROADCAST_OPTIONS.byBundler) {
                const erc4337Estimation = estimation.bundlerEstimation;
                const paymaster = erc4337Estimation.paymaster;
                if (paymaster.shouldIncludePayment())
                    this.#addFeePayment();
                // fix three problems:
                // 1) when we do eip7702Auth, initial estimation is not enough
                // 2) we estimate with the gas tank but if the user chooses
                // native, it could result in low gas limit => txn price too low.
                // In both cases, we re-estimate before broadcast
                // 3) some bundlers require a re-estimate before broadcast
                let shouldReestimate = (!this.account.safeCreation &&
                    !!erc4337Estimation.feeCallType &&
                    paymaster.getFeeCallType([this.selectedOption.token]) !==
                        erc4337Estimation.feeCallType) ||
                    this.bundlerSwitcher.getBundler().shouldReestimateBeforeBroadcast(this.#network);
                // sign the 7702 authorization if needed
                let eip7702Auth;
                if (this.baseAccount.shouldSignAuthorization(broadcast_1.BROADCAST_OPTIONS.byBundler)) {
                    const signer = await this.#getDefaultSigner();
                    if (isExternalSignerInvolved)
                        this.shouldSignAuth = { type: '7702', text: 'Step 1/2 preparing account' };
                    const contract = (0, _7702_1.getContractImplementation)(this.#network.chainId, this.accountKeyStoreKeys);
                    const authorization = {
                        chainId: this.#network.chainId,
                        contract,
                        nonce: accountState.nonce
                    };
                    eip7702Auth = (0, signMessage_1.get7702Sig)(this.#network.chainId, accountState.nonce, contract, await this.#withHardwareWalletSigningRequest((0, signingRequest_1.get7702AuthorizationSigningRequest)(authorization), () => signer.sign7702(authorization)));
                    if (isExternalSignerInvolved)
                        this.shouldSignAuth = { type: '7702', text: 'Step 2/2 signing transaction' };
                    if (isUsingPaymaster) {
                        this.status = { type: signAccountOp_1.SigningStatus.WaitingForPaymaster };
                        this.emitUpdate();
                    }
                    shouldReestimate = true;
                }
                if (shouldSignDeployAuth) {
                    const signer = await this.#getDefaultSigner();
                    const epActivatorTypedData = await (0, signMessage_1.getEntryPointAuthorization)(this.account.addr, this.#network.chainId, accountState.nonce);
                    const epSignature = await this.#withHardwareWalletSigningRequest((0, signingRequest_1.getEIP712SigningRequest)(epActivatorTypedData), () => (0, signMessage_1.getEIP712Signature)(epActivatorTypedData, this.account, accountState, signer, this.#network, false, undefined, true, this.provider));
                    if (!this.accountOp.meta) {
                        this.#updateAccountOp({ meta: {} });
                    }
                    if (this.accountOp.meta)
                        this.accountOp.meta.entryPointAuthorization = (0, signMessage_1.adjustEntryPointAuthorization)(epSignature.signature);
                    // after signing is complete, go to paymaster mode
                    if (isUsingPaymaster) {
                        this.shouldSignAuth = {
                            type: 'V2Deploy',
                            text: 'Step 2/2 signing transaction'
                        };
                        this.status = { type: signAccountOp_1.SigningStatus.WaitingForPaymaster };
                        this.emitUpdate();
                    }
                    shouldReestimate = true;
                }
                const initialUserOp = await this.#getInitialUserOp(shouldReestimate, eip7702Auth);
                const paymasterInfo = await this.#getPaymasterUserOp(initialUserOp, paymaster, eip7702Auth);
                if (paymasterInfo.required) {
                    if (paymasterInfo.success) {
                        this.accountOp.gasFeePayment.isSponsored = paymaster.isSponsored();
                        this.status = { type: signAccountOp_1.SigningStatus.InProgress };
                        this.emitUpdate();
                    }
                    else {
                        const errorResponse = paymasterInfo.errorResponse;
                        this.status = { type: signAccountOp_1.SigningStatus.ReadyToSign };
                        const isGasFeeUnderpriced = (0, helper_1.isUnderpriced)(errorResponse.message);
                        if (isGasFeeUnderpriced)
                            this.#requestGasFeeChangedConfirmation();
                        this.#simulateAndEstimateOrSimulateInterval.restart({ runImmediately: true });
                        // if the paymaster has failed because the txn was underpriced, prompt
                        // the user to accept the new price and continue quickly instead of
                        // displaying an error
                        if (!isGasFeeUnderpriced) {
                            this.emitError({
                                level: 'major',
                                message: errorResponse.message,
                                error: errorResponse.error
                            });
                        }
                        this.emitUpdate();
                        return;
                    }
                }
                // query the application state from memory to understand if the user
                // hasn't actually rejected the request while waiting for the
                // paymaster to respond
                if (this.#stopRefetching)
                    return;
                const userOperation = paymasterInfo.required ? paymasterInfo.userOp : initialUserOp;
                // safe accounts have their signature prepopulated
                if (!this.account.safeCreation) {
                    const signer = await this.#getDefaultSigner();
                    // Which signature format a 7702 EOA needs is dictated by the delegator
                    // it points to, not by the key type: the Ambire 7702 account validates
                    // the Ambire4337AccountOp typed data in unprotected mode, while the
                    // GridPlus one expects the standard AmbireOperation wrapping that smart
                    // accounts use. Getting this wrong fails the userOp with AA24.
                    const delegator = accountState.delegatedContract ??
                        (0, _7702_1.getContractImplementation)(this.#network.chainId, this.accountKeyStoreKeys);
                    const signsAsAmbire7702Eoa = accountState.isEOA && delegator.toLowerCase() === deploy_1.EIP_7702_AMBIRE_ACCOUNT.toLowerCase();
                    if (!signsAsAmbire7702Eoa) {
                        const typedData = (0, signMessage_1.getTypedData)(this.#network.chainId, this.accountOp.accountAddr, (0, userOperation_1.getUserOpHash)(userOperation, this.#network.chainId));
                        const signature = (0, signMessage_1.wrapStandard)(await this.#withHardwareWalletSigningRequest((0, signingRequest_1.getEIP712SigningRequest)(typedData), () => signer.signTypedData(typedData, {
                            chainId: this.#network.chainId,
                            provider: this.provider
                        })));
                        userOperation.signature = signature;
                        this.#updateAccountOp({ signature });
                    }
                    else {
                        const typedData = (0, signMessage_1.get7702UserOpTypedData)(this.#network.chainId, (0, accountOp_1.getSignableCalls)(this.accountOp), (0, userOperation_1.getPackedUserOp)(userOperation), (0, userOperation_1.getUserOpHash)(userOperation, this.#network.chainId));
                        const signature = (0, signMessage_1.wrapUnprotected)(await this.#withHardwareWalletSigningRequest((0, signingRequest_1.getEIP712SigningRequest)(typedData), () => signer.signTypedData(typedData, {
                            chainId: this.#network.chainId,
                            provider: this.provider
                        })));
                        userOperation.signature = signature;
                        this.#updateAccountOp({ signature });
                    }
                }
                this.#updateAccountOp({ asUserOperation: userOperation });
            }
            else {
                const signer = await this.#getDefaultSigner();
                // Relayer
                this.#addFeePayment();
                // fetch the nonce if needed
                const nonce = await this.baseAccount.getBroadcastNonce(this.#activity, this.accountOp, this.provider);
                if (nonce !== this.accountOp.nonce)
                    this.#updateNonce(nonce);
                this.#updateAccountOp({
                    signature: await this.#withHardwareWalletSigningRequest((0, signingRequest_1.getExecuteSigningRequest)({
                        accountOp: this.accountOp,
                        accountState,
                        network: this.#network
                    }), () => (0, signMessage_1.getExecuteSignature)(this.#network, this.accountOp, accountState, signer, this.provider))
                });
            }
            if (!this.status ||
                (this.status.type !== signAccountOp_1.SigningStatus.Queued &&
                    this.status.type !== signAccountOp_1.SigningStatus.SafeQuickBroadcastBundler))
                this.status = { type: signAccountOp_1.SigningStatus.Done };
            this.emitUpdate();
        }
        catch (error) {
            const { message } = (0, errorHumanizer_1.getHumanReadableBroadcastError)(error);
            this.#emitSigningErrorAndResetToReadyToSign({
                message,
                sendCrashReport: error?.sendCrashReport,
                accountState
            });
        }
    }
    /**
     * There are 4 ways to broadcast an AccountOp:
     *   1. For EOAs, there is only one way to do that. After
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
    async #broadcast() {
        if (this.status?.type !== signAccountOp_1.SigningStatus.Done) {
            this.throwBroadcastAccountOp({
                message: 'Pending broadcast. Please try again in a bit.'
            });
            return;
        }
        const accountOp = this.accountOp;
        const estimation = this.estimation.estimation;
        const requestId = this.fromRequestId;
        const bundlerSwitcher = this.bundlerSwitcher;
        const contactSupportPrompt = 'Please try again or contact support if the problem persists.';
        if (!accountOp ||
            !estimation ||
            !requestId ||
            (!accountOp.meta?.isSafeDeploy && (!accountOp.signingKeyAddr || !accountOp.signingKeyType)) ||
            !accountOp.signature ||
            !bundlerSwitcher ||
            !accountOp.gasFeePayment) {
            const message = `Missing mandatory transaction details. ${contactSupportPrompt}`;
            return this.throwBroadcastAccountOp({ message });
        }
        const account = this.#accounts.accounts.find((acc) => acc.addr === accountOp.accountAddr);
        if (!this.provider) {
            const networkName = this.#network?.name || `network with id ${accountOp.chainId}`;
            const message = `Provider for ${networkName} not found. ${contactSupportPrompt}`;
            return this.throwBroadcastAccountOp({ message });
        }
        if (!account) {
            const addr = (0, shortenAddress_1.default)(accountOp.accountAddr, 13);
            const message = `Account with address ${addr} not found. ${contactSupportPrompt}`;
            return this.throwBroadcastAccountOp({ message });
        }
        if (!this.#network) {
            const message = `Network with id ${accountOp.chainId} not found. ${contactSupportPrompt}`;
            return this.throwBroadcastAccountOp({ message });
        }
        this.broadcastStatus = 'LOADING';
        await this.forceEmitUpdate();
        const accountState = await this.#accounts.getOrFetchAccountOnChainState(accountOp.accountAddr, accountOp.chainId);
        if (!accountState) {
            const message = `Missing mandatory transaction details (account state). ${contactSupportPrompt}`;
            return this.throwBroadcastAccountOp({ message, accountState });
        }
        let transactionRes = null;
        // broadcasting by EOA is quite the same:
        // 1) build a rawTxn 2) sign 3) broadcast
        // we have one handle, just a diff rawTxn for each case
        const rawTxnBroadcast = [
            broadcast_1.BROADCAST_OPTIONS.bySelf,
            broadcast_1.BROADCAST_OPTIONS.bySelf7702,
            broadcast_1.BROADCAST_OPTIONS.byOtherEOA,
            broadcast_1.BROADCAST_OPTIONS.delegation
        ];
        // PQ1 is a smart-contract-only signer that cannot produce a raw EOA
        // transaction. The signer packages the calls into a 4337 UserOperation,
        // signs on-device and submits via its own bundler (Pimlico). We
        // short-circuit the entire EOA + bundler tree below, but keep two of
        // its invariants:
        //   1. The user-approved `gasFeePayment` binds the broadcast — the fee
        //      fields of the UserOp are taken from it, and fee options the
        //      4337 pipeline cannot honor (gas tank, another payer, a non-
        //      native fee token) are refused up front instead of silently
        //      charging the wallet's native balance a different amount.
        //   2. Device interaction runs inside #withHardwareWalletSigningRequest
        //      so the "confirm on your device" UI shows while the PQ1 waits
        //      for its physical confirmation.
        if (accountOp.signingKeyType === 'pq1' && accountOp.signingKeyAddr) {
            try {
                const { gasFeePayment } = accountOp;
                if (gasFeePayment.isGasTank ||
                    gasFeePayment.paidBy !== accountOp.accountAddr ||
                    gasFeePayment.inToken !== ethers_1.ZeroAddress) {
                    return this.throwBroadcastAccountOp({
                        message: 'PQ1 accounts pay gas with the native token from the account itself. Please select the native-token fee option paid by this account and try again.',
                        accountState
                    });
                }
                const signer = await this.#keystore.getSigner(accountOp.signingKeyAddr, accountOp.signingKeyType);
                if (signer.init) {
                    signer.init(this.#externalSignerControllers[accountOp.signingKeyType]);
                }
                if (!signer.broadcastAccountOp) {
                    return this.throwBroadcastAccountOp({
                        message: `Signer for key type ${accountOp.signingKeyType} does not implement broadcastAccountOp`,
                        accountState
                    });
                }
                const calls = accountOp.calls.map((c) => ({ to: c.to, value: c.value, data: c.data }));
                const { userOpHash, nonce } = await this.#withHardwareWalletSigningRequest((0, signingRequest_1.getRawTransactionSigningRequest)({
                    chainId: accountOp.chainId,
                    from: accountOp.accountAddr,
                    calls
                }), () => signer.broadcastAccountOp({
                    chainId: accountOp.chainId,
                    provider: this.provider,
                    calls,
                    gasFeePayment: {
                        gasPrice: gasFeePayment.gasPrice,
                        maxPriorityFeePerGas: gasFeePayment.maxPriorityFeePerGas
                    }
                }));
                // Identified the same way as any other bundler broadcast: the
                // ActivityController resolves the tx hash and reads per-op success
                // from the UserOperationEvent log (so a UserOp whose inner
                // execution reverted is correctly reported as failed, and a
                // slow-but-included op is not misreported as a failed broadcast).
                transactionRes = {
                    nonce: Number(nonce),
                    identifiedBy: { type: 'UserOperation', identifier: userOpHash, bundler: bundlers_1.PIMLICO }
                };
            }
            catch (error) {
                return this.throwBroadcastAccountOp({ error, accountState });
            }
        }
        else if (rawTxnBroadcast.includes(accountOp.gasFeePayment.broadcastOption)) {
            const multipleTxnsBroadcastRes = [];
            const senderAddr = accountOp.gasFeePayment.broadcastOption === broadcast_1.BROADCAST_OPTIONS.byOtherEOA
                ? accountOp.gasFeePayment.paidBy
                : accountOp.accountAddr;
            const senderNonce = accountOp.eoaNonce !== null && typeof accountOp.eoaNonce !== 'undefined'
                ? Number(accountOp.eoaNonce)
                : await this.provider.getTransactionCount(senderAddr).catch((e) => e);
            // @precaution
            if (senderNonce instanceof Error) {
                return this.throwBroadcastAccountOp({
                    message: 'RPC error. Please try again',
                    accountState
                });
            }
            try {
                const { gasFeePayment } = accountOp;
                if (!gasFeePayment.paidBy || !gasFeePayment.paidByKeyType) {
                    const message = `Missing gas fee payment details. ${contactSupportPrompt}`;
                    return this.throwBroadcastAccountOp({ message });
                }
                const signer = await this.#keystore.getSigner(gasFeePayment.paidBy, gasFeePayment.paidByKeyType);
                if (signer.init) {
                    signer.init(this.#externalSignerControllers[gasFeePayment.paidByKeyType]);
                }
                const txnLength = this.baseAccount.shouldBroadcastCallsSeparately(accountOp)
                    ? accountOp.calls.length
                    : 1;
                this.#updateAccountOp({ eoaNonce: BigInt(senderNonce) });
                if (txnLength > 1)
                    this.update({ signedTransactionsCount: 0 });
                for (let i = 0; i < txnLength; i++) {
                    const currentNonce = senderNonce + i;
                    const isDelegationBroadcast = gasFeePayment.broadcastOption === broadcast_1.BROADCAST_OPTIONS.delegation;
                    const rawTxn = await (0, broadcast_1.buildRawTransaction)(account, accountOp, accountState, this.provider, this.#network, currentNonce, gasFeePayment.broadcastOption, accountOp.calls[i]);
                    const signedTxn = await this.#withHardwareWalletSigningRequest((0, signingRequest_1.getRawTransactionSigningRequest)(rawTxn), () => isDelegationBroadcast
                        ? signer.signTransactionTypeFour({
                            txnRequest: rawTxn,
                            eip7702Auth: accountOp.meta.delegation
                        })
                        : signer.signRawTransaction(rawTxn));
                    if (isDelegationBroadcast) {
                        multipleTxnsBroadcastRes.push({
                            hash: await this.provider.send('eth_sendRawTransaction', [signedTxn])
                        });
                    }
                    else {
                        multipleTxnsBroadcastRes.push(await (0, broadcast_1.broadcastTransaction)(this.provider, signedTxn, accountOp.chainId));
                    }
                    if (txnLength > 1)
                        this.update({ signedTransactionsCount: i + 1 });
                    // record the EOA txn only if isErc4337Enabled as
                    // we need this for the gas tank
                    if (this.isErc4337Enabled)
                        this.#recordEoaTxnForGasTank(accountOp.chainId, signedTxn);
                }
                transactionRes = {
                    nonce: accountOp.gasFeePayment.broadcastOption === broadcast_1.BROADCAST_OPTIONS.byOtherEOA
                        ? Number(accountOp.nonce)
                        : senderNonce,
                    identifiedBy: {
                        type: txnLength > 1 ? 'MultipleTxns' : 'Transaction',
                        identifier: multipleTxnsBroadcastRes.map((res) => res.hash).join('-')
                    },
                    txnId: multipleTxnsBroadcastRes[multipleTxnsBroadcastRes.length - 1]?.hash
                };
            }
            catch (error) {
                console.error('Error broadcasting', error);
                // reset the eoaNonce on error
                this.#updateAccountOp({ eoaNonce: undefined });
                // for multiple txn cases
                // if a batch of 5 txn is sent to Ledger for sign but the user reject
                // #3, #1 and #2 are already broadcast. Reduce the accountOp's call
                // to #1 and #2 and create a submittedAccountOp
                //
                // unless it's the build-in swap - we want to throw an error and
                // allow the user to retry in this case. The swap is told what was sent, so
                // the retry is built only after the sent txns are confirmed
                const sentTransactionRes = {
                    nonce: senderNonce,
                    identifiedBy: {
                        type: 'MultipleTxns',
                        identifier: multipleTxnsBroadcastRes.map((res) => res.hash).join('-')
                    },
                    txnId: multipleTxnsBroadcastRes[multipleTxnsBroadcastRes.length - 1]?.hash
                };
                if (multipleTxnsBroadcastRes.length && this.#type !== 'one-click-swap-and-bridge') {
                    transactionRes = sentTransactionRes;
                    // The part that went out is reported as broadcast, so without saying this
                    // the rest of the batch looks sent when it never was.
                    const sentCount = multipleTxnsBroadcastRes.length;
                    const notSentCount = accountOp.calls.length - sentCount;
                    const reason = error?.message || 'the transaction could not be signed';
                    this.emitError({
                        level: 'major',
                        message: `Only ${sentCount} of ${accountOp.calls.length} transactions in this batch ${sentCount === 1 ? 'was' : 'were'} sent. The remaining ${notSentCount === 1 ? 'one' : notSentCount} could not be sent: ${reason.endsWith('.') ? reason : `${reason}.`} You can send ${notSentCount === 1 ? 'it' : 'them'} again.`,
                        error
                    });
                }
                else {
                    // The sent txns of the built-in swap can't be taken back, so they are reported.
                    // Signing the whole batch again would send them twice (e.g. a second approval)
                    if (multipleTxnsBroadcastRes.length && this.#onPartialBroadcast) {
                        try {
                            await this.#onPartialBroadcast(this.#buildSubmittedAccountOp(accountOp, account, sentTransactionRes, BigInt(senderNonce)));
                        }
                        catch (e) {
                            // Not reporting them must not hide the error that stopped the batch
                            this.emitError({
                                level: 'silent',
                                message: 'Failed to report the sent part of a partly sent batch',
                                error: e,
                                sendCrashReport: true
                            });
                        }
                    }
                    return this.throwBroadcastAccountOp({ error, accountState });
                }
            }
            finally {
                this.update({ signedTransactionsCount: null });
            }
        }
        // Smart account, the ERC-4337 way
        else if (accountOp.gasFeePayment?.broadcastOption === broadcast_1.BROADCAST_OPTIONS.byBundler) {
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
                userOperationHash = await bundler.broadcast(userOperation, this.#network);
            }
            catch (e) {
                let retryMsg;
                // if the signAccountOp is still active (it should be)
                // try to switch the bundler and ask the user to try again
                const switcher = this.bundlerSwitcher;
                this.updateStatus(signAccountOp_1.SigningStatus.ReadyToSign);
                if (switcher.canSwitch(this.baseAccount)) {
                    switcher.switch();
                    this.#simulateAndEstimateOrSimulateInterval.restart({ runImmediately: true });
                    // eslint-disable-next-line @typescript-eslint/no-floating-promises
                    this.#silentGasPriceUpdate();
                    retryMsg = 'Broadcast failed because bundler was down. Please try again';
                }
                return this.throwBroadcastAccountOp({
                    error: e,
                    accountState,
                    provider: this.provider,
                    network: this.#network,
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
                const additionalRelayerNetwork = networks_1.relayerAdditionalNetworks.find((net) => net.chainId === this.#network.chainId);
                const relayerChainId = additionalRelayerNetwork
                    ? additionalRelayerNetwork.chainId
                    : accountOp.chainId;
                const response = await this.#callRelayer(`/identity/${accountOp.accountAddr}/${relayerChainId}/submit`, 'POST', body);
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
        const submittedAccountOp = this.#buildSubmittedAccountOp(accountOp, account, transactionRes, this.accountOp.eoaNonce);
        await this.#onBroadcastSuccess({
            submittedAccountOp,
            accountOp: this.accountOp,
            type: this.#type,
            fromRequestId: this.fromRequestId
        });
        // Allow the user to broadcast a new transaction;
        // Important: Update broadcastStatus to SUCCESS/INITIAL only after the onBroadcastSuccess completes.
        // Otherwise, new calls could be added to a previously broadcast request that will resolve shortly,
        // leaving the new request 'orphaned' in the background without being attached to any action.
        this.broadcastStatus = 'SUCCESS';
        await this.forceEmitUpdate();
        this.broadcastStatus = 'INITIAL';
        await this.forceEmitUpdate();
        return Promise.resolve();
    }
    #buildSubmittedAccountOp(accountOp, account, transactionRes, eoaNonce) {
        const submittedAccountOpMeta = { ...accountOp.meta };
        const submittedAccountOp = {
            ...accountOp,
            eoaNonce,
            status: types_1.AccountOpStatus.BroadcastedButNotConfirmed,
            txnId: transactionRes.txnId,
            nonce: (0, submittedAccountOp_1.getSubmittedAccountOpNonce)((0, accountOp_1.getAccountOpNonce)(accountOp), transactionRes.nonce, !!account.safeCreation),
            identifiedBy: transactionRes.identifiedBy,
            timestamp: new Date().getTime(),
            isSingletonDeploy: !!accountOp.calls.find((call) => call.to && (0, ethers_1.getAddress)(call.to) === deploy_1.SINGLETON)
        };
        if (Object.keys(submittedAccountOpMeta).length)
            submittedAccountOp.meta = submittedAccountOpMeta;
        else
            delete submittedAccountOp.meta;
        return submittedAccountOp;
    }
    async signAndBroadcast() {
        if (this.signAndBroadcastPromise) {
            return this.emitError({
                level: 'major',
                message: 'Please wait, the signing/broadcasting process of this transaction is already in progress.',
                error: new Error(`The signing/broadcasting process is already in progress. (signAndBroadcast func). Status: ${this.status}. BroadcastStatus: ${this.broadcastStatus}. Signing key: ${this.accountOp.signingKeyType}. Fee payer key: ${this.accountOp.gasFeePayment?.paidByKeyType}. Type: ${this.#type}.`)
            });
        }
        // A fresh attempt clears any pending "gas fee updated" confirmation, so a
        // stale flag from a previous failed broadcast doesn't reopen the modal.
        this.gasFeeChangedConfirmationRequired = false;
        this.previousFee = null;
        this.#beginPinSessions();
        this.signAndBroadcastPromise = (async () => {
            this.signPromise = this.sign().finally(() => {
                this.signPromise = undefined;
            });
            await this.signPromise;
            // call sign again if the status is SafeQuickBroadcastBundler
            // as we need to create the userOperation before broadcast
            if (this.status && this.status.type === signAccountOp_1.SigningStatus.SafeQuickBroadcastBundler) {
                this.signPromise = this.sign().finally(() => {
                    this.signPromise = undefined;
                });
                await this.signPromise;
            }
            if (this.status && this.status.type === signAccountOp_1.SigningStatus.Done) {
                this.broadcastPromise = this.#broadcast().finally(() => {
                    this.broadcastPromise = undefined;
                });
                await this.broadcastPromise;
            }
            // basically, the logic enters here when we're using a Safe account
            // with > 1 threshold and allows the user to broadcast
            if (this.status &&
                this.status.type === signAccountOp_1.SigningStatus.Queued &&
                (this.accountOp.signed || []).length >= this.threshold) {
                // Executing needs a payer, which the user may still have to pick
                // (see isSafeFeePayerChoiceRequired), so without one the status is worked out again
                if (this.accountOp.gasFeePayment) {
                    this.status.type = signAccountOp_1.SigningStatus.ReadyToSign;
                    this.emitUpdate();
                }
                else {
                    this.updateStatus();
                }
            }
        })().finally(() => {
            this.signAndBroadcastPromise = undefined;
            this.#endPinSessions();
        });
        await this.signAndBroadcastPromise;
    }
    /**
     * Bookkeeping for the gas tank, which the broadcast does not depend on. It is
     * deliberately not awaited and never allowed to throw: it runs between the
     * transactions of a batch, where anything escaping it would stop the rest of the
     * batch from being sent - and the transactions before it cannot be taken back.
     */
    #recordEoaTxnForGasTank(chainId, rawTxn) {
        const onFailedToRecord = (e) => {
            console.log('failed to record EOA txn to relayer', chainId);
            console.log(e);
        };
        try {
            this.#callRelayer(`/v2/eoaSubmitTxn/${chainId}`, 'POST', { rawTxn }).catch(onFailedToRecord);
        }
        catch (e) {
            onFailedToRecord(e);
        }
    }
    #hwCleanup() {
        this.hardwareWalletSigningRequest = null;
        const paidByKeyType = this.accountOp.gasFeePayment?.paidByKeyType;
        const uniqueSigningKeys = [...new Set([this.accountOp.signingKeyType, paidByKeyType])];
        // Call the cleanup method for each unique signing key type
        uniqueSigningKeys.forEach((keyType) => {
            if (!keyType || keyType === 'internal')
                return;
            this.#externalSignerControllers[keyType]?.signingCleanup?.();
        });
    }
    /**
     * One account op can take several signatures from the same key, and a device that
     * unlocks with a PIN asks for it before each. Marking where the signing starts and
     * ends lets it keep the PIN for that long. Only the boundaries reach it, never the PIN.
     */
    #beginPinSessions() {
        Object.values(this.#externalSignerControllers).forEach((c) => c?.beginPinSession?.());
    }
    #endPinSessions() {
        Object.values(this.#externalSignerControllers).forEach((c) => c?.endPinSession?.());
    }
    get isSignInProgress() {
        return !!this.signPromise;
    }
    get isBroadcastInProgress() {
        return !!this.broadcastPromise;
    }
    get isSignAndBroadcastInProgress() {
        return !!this.signAndBroadcastPromise;
    }
    throwBroadcastAccountOp({ message: humanReadableMessage, error: _err, accountState, isRelayer = false, provider = undefined, network = undefined }) {
        const originalMessage = _err?.message;
        let message = humanReadableMessage;
        let isReplacementFeeLow = false;
        // When the broadcast fails only because the network fee changed and we
        // auto-updated the gas prices, we surface a soft confirmation modal instead
        // of a scary error toast (see gasFeeChangedConfirmationRequired).
        let softFeeUpdateConfirmation = false;
        this.broadcastStatus = 'ERROR';
        this.forceEmitUpdate();
        this.broadcastStatus = 'INITIAL';
        this.forceEmitUpdate();
        if (originalMessage) {
            if (originalMessage.includes('replacement fee too low')) {
                // if custom gas prices have been set, show the original error
                if (!this.hasCustomGasPrices) {
                    message =
                        'Replacement fee is insufficient. Fees have been automatically adjusted so please try submitting your transaction again.';
                    isReplacementFeeLow = true;
                    this.#simulateAndEstimateOrSimulateInterval.restart({ runImmediately: true });
                }
            }
            else if (originalMessage.includes('INSUFFICIENT_PRIVILEGE')) {
                message = accountState?.isV2
                    ? 'Broadcast failed because of a pending transaction. Please try again'
                    : 'Signer key not supported on this network';
                this.#accounts
                    .updateAccountState(this.accountOp.accountAddr, 'pending', [this.accountOp.chainId], true)
                    .then(() => this.#simulateAndEstimateOrSimulateInterval.restart({ runImmediately: true }))
                    .catch((e) => e);
            }
            else if ((0, helper_1.isUnderpriced)(originalMessage)) {
                if (!this.hasCustomGasPrices)
                    message = 'Transaction fees changed. Please try again';
                else
                    message = originalMessage;
                if (!this.hasCustomGasPrices) {
                    this.#requestGasFeeChangedConfirmation();
                    // eslint-disable-next-line @typescript-eslint/no-floating-promises
                    this.#silentGasPriceUpdate();
                    this.#simulateAndEstimateOrSimulateInterval.restart({ runImmediately: true });
                    // The fee was auto-updated, so don't alarm the user with a red error
                    // toast. Ask them to confirm the new fee and continue instead.
                    softFeeUpdateConfirmation = true;
                }
            }
            else if (originalMessage.includes('Failed to fetch') && isRelayer) {
                message =
                    'Currently, the Ambire relayer seems to be down. Please try again a few moments later or broadcast with an EOA account';
            }
            else if (originalMessage.includes('INVALID_ACCOUNT_NONCE') ||
                originalMessage.includes('user nonce')) {
                message = 'Pending transaction detected. Please try again in a few seconds';
                this.#accounts
                    .updateAccountState(this.accountOp.accountAddr, 'pending', [this.accountOp.chainId], true)
                    .then(() => this.#simulateAndEstimateOrSimulateInterval.restart({ runImmediately: true }))
                    .catch((e) => e);
            }
        }
        if (!message) {
            message = (0, errorHumanizer_1.getHumanReadableBroadcastError)(_err || new Error('')).message;
            // if the message states that the paymaster doesn't have sufficient amount,
            // add it to the failedPaymasters to disable it until a top-up is made
            if (message.includes(errors_1.insufficientPaymasterFunds) && provider && network) {
                FailedPaymasters_1.failedPaymasters.addInsufficientFunds(provider, network).then(() => {
                    this.#simulateAndEstimateOrSimulateInterval.restart({ runImmediately: true });
                });
            }
            if (message.includes('the selected fee is too low') && !this.hasCustomGasPrices) {
                this.#requestGasFeeChangedConfirmation();
                // eslint-disable-next-line @typescript-eslint/no-floating-promises
                this.#silentGasPriceUpdate();
                this.#simulateAndEstimateOrSimulateInterval.restart({ runImmediately: true });
                softFeeUpdateConfirmation = true;
                message = 'Transaction fees changed. Please try again';
            }
        }
        // To enable another try for signing in case of broadcast fail
        // broadcast is called in the FE only after successful signing
        this.updateStatus(signAccountOp_1.SigningStatus.ReadyToSign, isReplacementFeeLow);
        // The transaction being sped up was processed meanwhile, which is why the broadcast failed.
        // The status already tells the user there's no need to speed up, so the error isn't shown
        const isSpeedUpNotNeeded = this.status?.type === signAccountOp_1.SigningStatus.SpeedUpNotNeeded;
        if (this.#onBroadcastFailed) {
            this.#onBroadcastFailed(this.#accountOp);
        }
        this.emitError({
            // Keep the report for Sentry/logging, but don't show a toast when we're
            // handling this softly via the "Gas fee updated" confirmation modal
            // or when the speed up is no longer needed.
            level: softFeeUpdateConfirmation || isSpeedUpNotNeeded ? 'silent' : 'major',
            message,
            error: _err || new Error(message),
            sendCrashReport: _err && 'sendCrashReport' in _err ? _err.sendCrashReport : undefined
        });
        // signAndBroadcastPromise may clear before a debounced UI update is sent.
        // Force-emit so gasFeeChangedConfirmationRequired reliably reaches the UI.
        if (softFeeUpdateConfirmation) {
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            this.forceEmitUpdate();
        }
        throw new Error(message); // so that broadcast resolves with an error status
    }
    canUpdate() {
        return !this.status || signAccountOp_1.noStateUpdateStatuses.indexOf(this.status.type) === -1;
    }
    setDiscoveryStatus(status) {
        this.traceCallDiscoveryStatus = status;
        // emit an update on done/failed to sync&show the final banners
        if (status === signAccountOp_1.TraceCallDiscoveryStatus.Done || status === signAccountOp_1.TraceCallDiscoveryStatus.Failed) {
            this.emitUpdate();
        }
    }
    /**
     * Dismisses the soft "Gas fee updated" confirmation without retrying the
     * broadcast (e.g. when the user cancels the modal). The controller stays in
     * ReadyToSign so the user can still adjust and submit again manually.
     */
    dismissGasFeeChangedConfirmation() {
        if (!this.gasFeeChangedConfirmationRequired)
            return;
        this.gasFeeChangedConfirmationRequired = false;
        this.previousFee = null;
        this.emitUpdate();
    }
    /**
     * Unbrick mechanism.
     * Use this only when you are sure there's no way to continue, or
     * a promise waiting to resolve that might change the state
     */
    #resetToReadyToSign() {
        this.signPromise = undefined;
        this.broadcastPromise = undefined;
        this.signAndBroadcastPromise = undefined;
        this.status = { type: signAccountOp_1.SigningStatus.ReadyToSign };
        this.#hwCleanup();
    }
    cancelSignReq() {
        this.#resetToReadyToSign();
        this.emitUpdate();
    }
    /**
     * Winds a broadcast up. The calls that went out are done with, so only the ones left
     * unsigned stay on the op and the controller goes back to where it was before
     * signing, ready for them. Its status has to be put back first: while it is signing,
     * every update to the op is frozen and the calls would not go in.
     *
     * Returns the calls still waiting to be signed, so the caller can tell whether the
     * request is finished with or has to stay.
     */
    cleanupAfterBroadcast(sentCallIds) {
        const notSentCalls = this.accountOp.calls.filter((call) => !sentCallIds.includes(call.id));
        this.#resetToReadyToSign();
        if (!notSentCalls.length) {
            this.emitUpdate();
            return notSentCalls;
        }
        this.update({ accountOpData: { calls: notSentCalls } });
        return notSentCalls;
    }
    get type() {
        return this.#type;
    }
    get delegatedContract() {
        if (!this.#accounts.accountStates[this.account.addr])
            return null;
        if (!this.#accounts.accountStates[this.account.addr][this.#network.chainId.toString()])
            return null;
        return this.#accounts.accountStates[this.account.addr][this.#network.chainId.toString()]
            .delegatedContract;
    }
    get banners() {
        const banners = [];
        const visualizations = this.humanization.flatMap((call) => (0, utils_1.flattenHumanizerVisualizations)(call.fullVisualization));
        // Keep only token/address types AND ensure uniqueness by address
        const addressVisualizations = Array.from(new Map(visualizations
            .filter((v) => (v.type === 'token' || v.type === 'address') && v.address)
            .map((v) => [v.address, v]) // key: address → value: visualization
        ).values());
        const blacklistedItems = addressVisualizations.filter((v) => v.verification === 'BLACKLISTED');
        if (blacklistedItems.length) {
            banners.push({
                id: 'blacklisted-addresses-error-banner',
                type: 'error',
                title: 'Potentially harmful transaction',
                text: (0, banners_1.getScamDetectedText)(blacklistedItems)
            });
        }
        else {
            const hasFailedToGet = visualizations.some((v) => (v.type === 'token' || v.type === 'address') && v.verification === 'FAILED_TO_GET');
            if (hasFailedToGet) {
                banners.push({
                    id: 'blacklisted-addresses-warning-banner',
                    type: 'warning',
                    title: 'Safety check unavailable',
                    text: "We couldn't check the addresses or tokens in this transaction for malicious activity. Proceed with caution."
                });
            }
        }
        const dappVerificationBanner = this.#getDappVerificationBanner();
        if (dappVerificationBanner)
            banners.push(dappVerificationBanner);
        const significantBalanceDecreaseWarning = (0, helper_1.getSignificantBalanceDecreaseWarning)(this.#portfolio.getAccountPortfolioState(this.accountOp.accountAddr), this.accountOp.chainId, this.traceCallDiscoveryStatus);
        if (significantBalanceDecreaseWarning) {
            banners.push({
                id: significantBalanceDecreaseWarning.id,
                type: 'warning',
                title: significantBalanceDecreaseWarning.title,
                text: significantBalanceDecreaseWarning.text || significantBalanceDecreaseWarning.title,
                secondaryText: significantBalanceDecreaseWarning.secondaryText
            });
        }
        const safeDelegateCallWarning = (0, helper_1.getSafeDelegateCallWarning)(this.accountOp);
        if (safeDelegateCallWarning) {
            banners.push({
                id: safeDelegateCallWarning.id,
                type: 'warning',
                title: safeDelegateCallWarning.title,
                text: safeDelegateCallWarning.text || safeDelegateCallWarning.title
            });
        }
        const safeGasRefundWarning = (0, helper_1.getSafeGasRefundWarning)(this.accountOp);
        if (safeGasRefundWarning) {
            banners.push({
                id: safeGasRefundWarning.id,
                type: 'warning',
                title: safeGasRefundWarning.title,
                text: safeGasRefundWarning.text || safeGasRefundWarning.title
            });
        }
        return banners;
    }
    get canAccountBroadcastByItself() {
        return this.baseAccount.canBroadcastByItself();
    }
    /**
     * The gas prices used by the selected fee option. They differ from gasPrices
     * only with the `rpcWithBundlerFallback` strategy
     * (see BaseAccount.getGasPriceFetchStrategy)
     */
    get selectedOptionGasPrices() {
        if (!this.selectedOption)
            return this.#applySpeedUpMinFees(this.gasPrices);
        const broadcastOption = this.baseAccount.getBroadcastOption(this.selectedOption, {
            op: this.accountOp,
            isSponsored: this.isSponsored
        });
        // Raised like the fee speeds, so the advanced options don't start below the speed up minimum
        return this.#applySpeedUpMinFees(this.#shouldUseRpcGasPrices(broadcastOption) ? this.rpcGasPrices : this.gasPrices);
    }
    get canSetCustomGasPrices() {
        if (!this.selectedOption)
            return false;
        return this.baseAccount.canSetCustomGasPrices(this.selectedOption);
    }
    get canSetCustomGas() {
        if (!this.selectedOption)
            return false;
        return this.baseAccount.canSetCustomGas(this.selectedOption, this.accountOp);
    }
    get isErc4337Enabled() {
        return this.#featureFlags.isFeatureEnabled('erc4337');
    }
    get canEnableErc4337() {
        return !this.isErc4337Enabled && this.baseAccount.canUseErc4337();
    }
    get threshold() {
        const accountState = this.#accounts.accountStates[this.account.addr][this.#network.chainId.toString()];
        if (!accountState)
            return 0;
        return accountState.threshold;
    }
    get canBroadcast() {
        if (!this.account.safeCreation)
            return true;
        if (this.accountOp.meta?.isSafeDeploy)
            return true;
        const accountState = this.#accounts.accountStates[this.account.addr]?.[this.#network.chainId.toString()];
        if (this.accountOp.nonce !== null && this.accountOp.nonce !== accountState?.nonce)
            return false;
        // if the threshold is 1 and there's only 1 imported key, allow quick broadcast
        if (this.threshold === 1 && this.accountKeyStoreKeys.length === 1)
            return true;
        return (this.accountOp.signed || []).length >= this.threshold;
    }
    toJSON() {
        return {
            ...this,
            ...super.toJSON(),
            isInitialized: this.isInitialized,
            type: this.type,
            readyToSign: this.readyToSign,
            safetyChecksLoading: this.safetyChecksLoading,
            accountKeyStoreKeys: this.accountKeyStoreKeys,
            feePayerKeyStoreKeys: this.feePayerKeyStoreKeys,
            feeToken: this.feeToken,
            feeTokenPreference: this.feeTokenPreference,
            pendingFeeTokenPreference: this.pendingFeeTokenPreference,
            speedOptions: this.speedOptions,
            selectedOption: this.selectedOption,
            account: this.account,
            errors: this.errors,
            gasSavedUSD: this.gasSavedUSD,
            delegatedContract: this.delegatedContract,
            accountOp: this.accountOp,
            humanization: this.humanization,
            isSignInProgress: this.isSignInProgress,
            isBroadcastInProgress: this.isBroadcastInProgress,
            isSignAndBroadcastInProgress: this.isSignAndBroadcastInProgress,
            banners: this.banners,
            canAccountBroadcastByItself: this.canAccountBroadcastByItself,
            selectedOptionGasPrices: this.selectedOptionGasPrices,
            canSetCustomGasPrices: this.canSetCustomGasPrices,
            canSetCustomGas: this.canSetCustomGas,
            isErc4337Enabled: this.isErc4337Enabled,
            canEnableErc4337: this.canEnableErc4337,
            threshold: this.threshold,
            canBroadcast: this.canBroadcast,
            isFeePayerNotLinkedToSafe: this.isFeePayerNotLinkedToSafe,
            isSafeFeePayerChoiceRequired: this.isSafeFeePayerChoiceRequired,
            hasSafeApiFailed: this.hasSafeApiFailed,
            hardwareWalletSigningRequest: this.hardwareWalletSigningRequest,
            safeEip712Data: this.safeEip712Data,
            gasFeeChangedConfirmationRequired: this.gasFeeChangedConfirmationRequired,
            previousFee: this.previousFee,
            signingAuthRequirement: this.signingAuthRequirement
        };
    }
}
exports.SignAccountOpController = SignAccountOpController;
//# sourceMappingURL=signAccountOp.js.map