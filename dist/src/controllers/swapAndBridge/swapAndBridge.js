"use strict";
// @ts-nocheck
Object.defineProperty(exports, "__esModule", { value: true });
exports.SwapAndBridgeController = exports.SwapAndBridgeFormStatus = void 0;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const networks_1 = require("@/libs/networks/networks");
const EmittableError_1 = tslib_1.__importDefault(require("../../classes/EmittableError"));
const recurringTimeout_1 = require("../../classes/recurringTimeout/recurringTimeout");
const SwapAndBridgeError_1 = tslib_1.__importDefault(require("../../classes/SwapAndBridgeError"));
const intervals_1 = require("../../consts/intervals");
const getBaseAccount_1 = require("../../libs/account/getBaseAccount");
const types_1 = require("../../libs/accountOp/types");
const banners_1 = require("../../libs/banners/banners");
const erc7677_1 = require("../../libs/erc7677/erc7677");
const utils_1 = require("../../libs/humanizer/utils");
const helpers_1 = require("../../libs/portfolio/helpers");
const swapAndBridge_1 = require("../../libs/swapAndBridge/swapAndBridge");
const swapAndBridgeErrorHumanizer_1 = require("../../libs/swapAndBridge/swapAndBridgeErrorHumanizer");
const amount_1 = require("../../libs/transfer/amount");
const constants_1 = require("../../services/socket/constants");
const validate_1 = require("../../services/validations/validate");
const formatters_1 = require("../../utils/numbers/formatters");
const uuid_1 = require("../../utils/uuid");
const wait_1 = tslib_1.__importDefault(require("../../utils/wait"));
const types_2 = require("../estimation/types");
const eventEmitter_1 = tslib_1.__importDefault(require("../eventEmitter/eventEmitter"));
const signAccountOp_1 = require("../signAccountOp/signAccountOp");
const HARD_CODED_CURRENCY = 'usd';
const isSwapAndBridge = (route) => route === 'swap-and-bridge';
const CONVERSION_PRECISION = 16;
const CONVERSION_PRECISION_POW = BigInt(10 ** CONVERSION_PRECISION);
const NETWORK_MISMATCH_MESSAGE = 'Swap & Bridge network configuration mismatch. Please try again or contact Ambire support.';
// For performance reasons, limit the max number of tokens in the to token list
const TO_TOKEN_LIST_LIMIT = 100;
var SwapAndBridgeFormStatus;
(function (SwapAndBridgeFormStatus) {
    SwapAndBridgeFormStatus["Empty"] = "empty";
    SwapAndBridgeFormStatus["Invalid"] = "invalid";
    SwapAndBridgeFormStatus["FetchingRoutes"] = "fetching-routes";
    SwapAndBridgeFormStatus["NoRoutesFound"] = "no-routes-found";
    SwapAndBridgeFormStatus["InvalidRouteSelected"] = "invalid-route-selected";
    SwapAndBridgeFormStatus["ReadyToEstimate"] = "ready-to-estimate";
    SwapAndBridgeFormStatus["ReadyToSubmit"] = "ready-to-submit";
    SwapAndBridgeFormStatus["Proceeded"] = "proceeded";
})(SwapAndBridgeFormStatus || (exports.SwapAndBridgeFormStatus = SwapAndBridgeFormStatus = {}));
const STATUS_WRAPPED_METHODS = {
    addToTokenByAddress: 'INITIAL'
};
const SUPPORTED_CHAINS_CACHE_THRESHOLD = 1000 * 60 * 60 * 24; // 1 day
const TO_TOKEN_LIST_CACHE_THRESHOLD = 1000 * 60 * 60 * 4; // 4 hours
/**
 * The Swap and Bridge controller is responsible for managing the state and
 * logic related to swapping and bridging tokens across different networks.
 * Key responsibilities:
 *  - Initially setting up the swap and bridge form with the necessary data.
 *  - Managing form state for token swap and bridge operations (including user preferences).
 *  - Fetching and updating token lists (from and to).
 *  - Fetching and updating quotes for token swaps and bridges.
 *  - Manages token active routes
 */
class SwapAndBridgeController extends eventEmitter_1.default {
    #callRelayer;
    #selectedAccount;
    #networks;
    #activity;
    #storage;
    #serviceProviderAPI;
    #activeRoutes = [];
    statuses = STATUS_WRAPPED_METHODS;
    updateQuoteStatus = 'INITIAL';
    #updateQuoteId;
    switchTokensStatus = 'INITIAL';
    sessionIds = [];
    fromChainId = 1;
    fromSelectedToken = null;
    fromAmount = '';
    fromAmountInFiat = '';
    /**
     * A counter used to trigger UI updates when the amount is changed programmatically
     * by the controller.
     */
    fromAmountUpdateCounter = 0;
    fromAmountFieldMode = 'token';
    toChainId = 1;
    toSelectedToken = null;
    toTokenSearchTerm = '';
    toTokenSearchResults = [];
    quote = null;
    quoteRoutesStatuses = {};
    portfolioTokenList = [];
    isTokenListLoading = false;
    errors = [];
    #toTokenList = {};
    /**
     * Similar to the `#toTokenList[key].apiTokens`, this helps in avoiding repeated API
     * calls to fetch the supported chains from our service provider.
     */
    #cachedSupportedChains = { lastFetched: 0, data: [] };
    routePriority = 'output';
    // Holds the initial load promise, so that one can wait until it completes
    #initialLoadPromise;
    #shouldDebounceFlags = {};
    #accounts;
    #keystore;
    #portfolio;
    #externalSignerControllers;
    #providers;
    #phishing;
    #dapps;
    /**
     * A possibly outdated instance of the SignAccountOpController. Please always
     * read the public getter `signAccountOpController` to get the up-to-date
     * instance. If updating a route consists of:
     * QUOTE FETCH -> ROUTE START -> ROUTE ESTIMATION
     *
     * This instance may be outdated during QUOTE FETCH -> ROUTE START
     * The reason is that the controller is not immediately destroyed after the
     * form changes, but instead is being updated after the route is started.
     */
    #signAccountOpController = null;
    #portfolioUpdate;
    #isCurrentSignAccountOpThrowingAnEstimationError;
    #getUserRequests;
    #getVisibleUserRequests;
    hasProceeded = false;
    #relayerUrl;
    #updateQuoteInterval;
    get updateQuoteInterval() {
        return this.#updateQuoteInterval;
    }
    #updateActiveRoutesInterval;
    get updateActiveRoutesInterval() {
        return this.#updateActiveRoutesInterval;
    }
    #continuouslyUpdateActiveRoutesPromise;
    #continuouslyUpdateActiveRoutesSessionId;
    #onBroadcastSuccess;
    #onBroadcastFailed;
    #ui;
    #isOnSwapAndBridgeRoute = false;
    constructor({ eventEmitterRegistry, callRelayer, accounts, keystore, portfolio, externalSignerControllers, providers, selectedAccount, networks, activity, storage, phishing, dapps, portfolioUpdate, relayerUrl, isCurrentSignAccountOpThrowingAnEstimationError, getUserRequests, getVisibleUserRequests, swapProvider, onBroadcastSuccess, onBroadcastFailed, ui }) {
        super(eventEmitterRegistry);
        this.#callRelayer = callRelayer;
        this.#accounts = accounts;
        this.#keystore = keystore;
        this.#portfolio = portfolio;
        this.#externalSignerControllers = externalSignerControllers;
        this.#providers = providers;
        this.#portfolioUpdate = portfolioUpdate;
        this.#isCurrentSignAccountOpThrowingAnEstimationError =
            isCurrentSignAccountOpThrowingAnEstimationError;
        this.#selectedAccount = selectedAccount;
        this.#networks = networks;
        this.#activity = activity;
        this.#serviceProviderAPI = swapProvider;
        this.#storage = storage;
        this.#phishing = phishing;
        this.#dapps = dapps;
        this.#relayerUrl = relayerUrl;
        this.#getUserRequests = getUserRequests;
        this.#getVisibleUserRequests = getVisibleUserRequests;
        this.#onBroadcastSuccess = onBroadcastSuccess;
        this.#onBroadcastFailed = onBroadcastFailed;
        this.#ui = ui;
        this.#initialLoadPromise = this.#load().finally(() => {
            this.#initialLoadPromise = undefined;
        });
        this.#updateQuoteInterval = new recurringTimeout_1.RecurringTimeout(async () => this.continuouslyUpdateQuote(), intervals_1.UPDATE_SWAP_AND_BRIDGE_QUOTE_INTERVAL, this.emitError.bind(this));
        this.#updateActiveRoutesInterval = new recurringTimeout_1.RecurringTimeout(async () => this.continuouslyUpdateActiveRoutes(), intervals_1.BRIDGE_STATUS_INTERVAL, this.emitError.bind(this));
        this.#ui.uiEvent.on('updateView', (view) => {
            if (isSwapAndBridge(view.currentRoute)) {
                this.#isOnSwapAndBridgeRoute = true;
                // Fetch a fresh quote immediately if the form is ready and the last
                // quote is older than 20 seconds (e.g. user was away on another screen).
                // If the user just briefly switched screens, skip the immediate fetch
                // and let the normal interval handle the next update.
                const isQuoteStale = Date.now() - this.updateQuoteInterval.startedRunningAt > 20_000;
                this.updateQuoteInterval.restart({
                    runImmediately: !!this.#shouldAutoUpdateQuote && isQuoteStale
                });
            }
            else if (isSwapAndBridge(view.previousRoute)) {
                this.#isOnSwapAndBridgeRoute = false;
                this.updateQuoteInterval.stop();
            }
        });
        this.#ui.uiEvent.on('removeView', (view) => {
            if (!isSwapAndBridge(view.currentRoute))
                return;
            this.#isOnSwapAndBridgeRoute = false;
            this.updateQuoteInterval.stop();
        });
    }
    #emitUpdateIfNeeded(forceUpdate = false) {
        const shouldSkipUpdate = 
        // No need to emit emit updates if there are no active sessions
        !this.sessionIds.length &&
            // but ALSO there are no active routes (otherwise, banners need the updates)
            !this.activeRoutes.length &&
            // Force update is needed when the form is reset
            // as the sessions are cleared
            !forceUpdate;
        if (shouldSkipUpdate)
            return;
        super.emitUpdate();
    }
    #setFromAmountAndNotifyUI(amount) {
        this.fromAmount = amount;
        this.fromAmountUpdateCounter += 1;
    }
    #setFromAmountInFiatAndNotifyUI(amountInFiat) {
        this.fromAmountInFiat = amountInFiat;
        this.fromAmountUpdateCounter += 1;
    }
    #setFromAmountAmount(fromAmount, isProgrammaticUpdate = false) {
        const fromAmountFormatted = fromAmount.indexOf('.') === 0 ? `0${fromAmount}` : fromAmount;
        this.fromAmount = fromAmount;
        if (isProgrammaticUpdate) {
            // There is no problem in updating this first as there are no
            // emit updates in this method
            this.fromAmountUpdateCounter += 1;
        }
        if (fromAmount === '') {
            this.fromAmountInFiat = '';
            return;
        }
        const tokenPrice = this.fromSelectedToken?.priceIn.find((p) => p.baseCurrency === HARD_CODED_CURRENCY)?.price;
        if (!tokenPrice) {
            this.fromAmountInFiat = '';
            return;
        }
        if (this.fromAmountFieldMode === 'fiat' &&
            typeof this.fromSelectedToken?.decimals === 'number') {
            this.fromAmountInFiat = fromAmount;
            // Get the number of decimals
            const amountInFiatDecimals = 10;
            const { tokenPriceBigInt, tokenPriceDecimals } = (0, formatters_1.convertTokenPriceToBigInt)(tokenPrice);
            // Convert the numbers to big int
            const amountInFiatBigInt = (0, ethers_1.parseUnits)((0, amount_1.getSanitizedAmount)(fromAmountFormatted, amountInFiatDecimals), amountInFiatDecimals);
            this.fromAmount = (0, ethers_1.formatUnits)((amountInFiatBigInt * CONVERSION_PRECISION_POW) / tokenPriceBigInt, 
            // Shift the decimal point by the number of decimals in the token price
            amountInFiatDecimals + CONVERSION_PRECISION - tokenPriceDecimals);
            return;
        }
        if (this.fromAmountFieldMode === 'token') {
            this.fromAmount = fromAmount;
            if (!this.fromSelectedToken)
                return;
            // Convert the field value to big int
            const formattedAmount = (0, ethers_1.parseUnits)((0, formatters_1.getSafeAmountFromFieldValue)(fromAmount, this.fromSelectedToken.decimals), this.fromSelectedToken.decimals);
            if (!formattedAmount)
                return;
            const { tokenPriceBigInt, tokenPriceDecimals } = (0, formatters_1.convertTokenPriceToBigInt)(tokenPrice);
            this.fromAmountInFiat = (0, ethers_1.formatUnits)(formattedAmount * tokenPriceBigInt, 
            // Shift the decimal point by the number of decimals in the token price
            this.fromSelectedToken.decimals + tokenPriceDecimals);
        }
    }
    async #load() {
        await this.#networks.initialLoadPromise;
        await this.#selectedAccount.initialLoadPromise;
        // FIXME: Temporarily omit getting prev activeRoutes from storage, because of
        // old records with different (unexpected) structure causing crashes.
        // this.activeRoutes = await this.#storage.get('swapAndBridgeActiveRoutes', [])
        // FIXME: Figure out a mechanism to clean up these routes in storage,
        // otherwise this is a potential storage leak (although we have unlimited storage permission).
        // also, just in case protection: filter out ready routes as we don't have
        // retry mechanism or follow up transaction handling anymore. Which means
        // ready routes in the storage are just leftover routes.
        // Same is true for completed, failed and refunded routes - they are just
        // leftover routes in storage
        // const filterOutStatuses = ['ready', 'completed', 'failed', 'refunded']
        // this.activeRoutes = this.activeRoutes.filter((r) => !filterOutStatuses.includes(r.routeStatus))
        this.#selectedAccount.onUpdate(() => {
            this.#debounceFunctionCallsOnSameTick('updateFormOnSelectedAccountUpdate', async () => {
                if (this.#selectedAccount.portfolio.isReadyToVisualize && this.sessionIds.length) {
                    this.isTokenListLoading = false;
                    await this.updatePortfolioTokenList(structuredClone(this.#selectedAccount.portfolio.tokens));
                    // To token list includes selected account portfolio tokens, it should get an update too
                    await this.updateToTokenList(false);
                }
            });
        });
        // Fetch the supported networks in the beginning so we can disable the
        // swap and bridge button of unsupported tokens on the dashboard, even if
        // the user hasn't yet opened the swap and bridge screen
        // (forceEmit true is crucial here)
        this.#fetchSupportedChainsIfNeeded(true);
    }
    // The token in portfolio is the source of truth for the amount, it updates
    // on every balance (pending or anything) change.
    #getFromSelectedTokenInPortfolio = () => this.portfolioTokenList.find((t) => t.address === this.fromSelectedToken?.address &&
        t.chainId === this.fromSelectedToken?.chainId &&
        // We skip the positive balance requirement here,
        // because we only need to retrieve the token from the portfolio list
        // and apply the basic eligibility checks (not a reward or Gas Tank token).
        // Enforcing a positive balance would prevent tokens with zero balance
        // from being found, which would break the MIN amount validation in `validateFromAmount()`.
        (0, swapAndBridge_1.getIsTokenEligibleForSwapAndBridge)(t, false));
    get maxFromAmount() {
        const tokenRef = this.#getFromSelectedTokenInPortfolio() || this.fromSelectedToken;
        if (!tokenRef || (0, helpers_1.getTokenAmount)(tokenRef) === 0n || typeof tokenRef.decimals !== 'number')
            return '0';
        return (0, ethers_1.formatUnits)((0, helpers_1.getTokenAmount)(tokenRef), tokenRef.decimals);
    }
    get maxFromAmountInFiat() {
        const tokenRef = this.#getFromSelectedTokenInPortfolio() || this.fromSelectedToken;
        if (!tokenRef || (0, helpers_1.getTokenAmount)(tokenRef) === 0n)
            return '0';
        const tokenPrice = tokenRef?.priceIn.find((p) => p.baseCurrency === HARD_CODED_CURRENCY)?.price;
        if (!tokenPrice || !Number(this.maxFromAmount))
            return '0';
        const maxAmount = (0, helpers_1.getTokenAmount)(tokenRef);
        const { tokenPriceBigInt, tokenPriceDecimals } = (0, formatters_1.convertTokenPriceToBigInt)(tokenPrice);
        // Multiply the max amount by the token price. The calculation is done in big int to avoid precision loss
        return (0, ethers_1.formatUnits)(BigInt(maxAmount) * tokenPriceBigInt, 
        // Shift the decimal point by the number of decimals in the token price
        tokenRef.decimals + tokenPriceDecimals);
    }
    get isFormEmpty() {
        return (!this.fromChainId ||
            !this.toChainId ||
            !this.fromAmount ||
            !this.fromSelectedToken ||
            !this.toSelectedToken);
    }
    /**
     * Returns an instance of the SignAccountOpController that is ALWAYS up-to-date with the current
     * quote and the current form state.
     */
    get signAccountOpController() {
        const controllerFromQuoteId = this.#signAccountOpController?.accountOp.meta?.fromQuoteId;
        const isSignAccountOpCtrlStale = controllerFromQuoteId && controllerFromQuoteId !== this.#updateQuoteId;
        if (isSignAccountOpCtrlStale)
            return null;
        return this.#signAccountOpController;
    }
    get formStatus() {
        if (this.hasProceeded)
            return SwapAndBridgeFormStatus.Proceeded;
        if (this.isFormEmpty)
            return SwapAndBridgeFormStatus.Empty;
        if (this.validateFromAmount.message || this.swapSignErrors.length)
            return SwapAndBridgeFormStatus.Invalid;
        if (this.updateQuoteStatus === 'LOADING')
            return SwapAndBridgeFormStatus.FetchingRoutes;
        if (!this.quote || !this.quote.routes.length)
            return SwapAndBridgeFormStatus.NoRoutesFound;
        if (this.quote?.selectedRoute?.disabled)
            return SwapAndBridgeFormStatus.InvalidRouteSelected;
        if (!this.signAccountOpController ||
            this.signAccountOpController.estimation.status !== types_2.EstimationStatus.Success)
            return SwapAndBridgeFormStatus.ReadyToEstimate;
        return SwapAndBridgeFormStatus.ReadyToSubmit;
    }
    get validateFromAmount() {
        const fromSelectedTokenWithUpToDateAmount = this.#getFromSelectedTokenInPortfolio();
        if (!fromSelectedTokenWithUpToDateAmount)
            return { severity: 'error', message: '' };
        if (!this.isFormEmpty &&
            !this.quote &&
            Object.values(this.quoteRoutesStatuses).some((val) => val.status === 'MIN_AMOUNT_NOT_MET')) {
            return {
                severity: 'success',
                message: '🔔 A route was found for this pair but the minimum token amount was not met.'
            };
        }
        return (0, validate_1.validateSendTransferAmount)(this.fromAmount, fromSelectedTokenWithUpToDateAmount);
    }
    get activeRoutesInProgress() {
        return this.activeRoutes.filter((r) => r.routeStatus === 'in-progress' && r.userTxHash);
    }
    get activeRoutes() {
        return this.#activeRoutes;
    }
    set activeRoutes(value) {
        this.#activeRoutes = value;
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.#storage.set('swapAndBridgeActiveRoutes', value);
        if (!this.activeRoutesInProgress.length) {
            this.#updateActiveRoutesInterval.stop();
            return;
        }
        const minServiceTime = (0, swapAndBridge_1.getActiveRoutesLowestServiceTime)(this.activeRoutesInProgress);
        if (!this.#updateActiveRoutesInterval.running) {
            this.#updateActiveRoutesInterval.start({ timeout: minServiceTime });
            return;
        }
        // If the interval is running, check if minServiceTime * 2 is still less than currentTimeout.
        // If it is, restart it with the new minServiceTime, as the difference makes it worth it.
        if (minServiceTime * 2 < this.#updateActiveRoutesInterval.currentTimeout) {
            this.#updateActiveRoutesInterval.restart({ timeout: minServiceTime });
        }
    }
    get shouldEnableRoutesSelection() {
        return (!!this.quote &&
            !!this.quote.routes &&
            this.quote.routes.length > 0 &&
            this.updateQuoteStatus !== 'LOADING');
    }
    async initForm(sessionId, params) {
        const { preselectedFromToken, preselectedToToken, fromAmount, activeRouteIdToDelete } = params || {};
        await this.#initialLoadPromise;
        // if the provider is socket, convert the null addresses
        if (preselectedFromToken) {
            this.#emitSilentErrorIfNullAddress(preselectedFromToken.address);
            preselectedFromToken.address = (0, swapAndBridge_1.mapBannedToValidAddr)(Number(preselectedFromToken.chainId), (0, swapAndBridge_1.convertNullAddressToZeroAddressIfNeeded)(preselectedFromToken.address));
        }
        if (preselectedToToken) {
            this.#emitSilentErrorIfNullAddress(preselectedToToken.address);
            preselectedToToken.address = (0, swapAndBridge_1.mapBannedToValidAddr)(Number(preselectedToToken.chainId), (0, swapAndBridge_1.convertNullAddressToZeroAddressIfNeeded)(preselectedToToken.address));
        }
        if (this.sessionIds.includes(sessionId))
            return;
        // reset only if there are no other instances opened/active
        if (!this.sessionIds.length) {
            this.reset(); // clear prev session form state
            // for each new session remove the completed activeRoutes from the previous session
            this.activeRoutes = this.activeRoutes.filter((r) => r.routeStatus !== 'completed');
            // remove activeRoutes errors from the previous session
            this.activeRoutes.forEach((r) => {
                if (r.routeStatus !== 'failed') {
                    delete r.error;
                }
            });
            if (this.activeRoutes.length) {
                // Otherwise there may be an emitUpdate with [] tokens
                this.isTokenListLoading = true;
                // update the activeRoute.route prop for the new session
                this.activeRoutes.forEach((r) => {
                    this.updateActiveRoute(r.activeRouteId, undefined, true);
                });
            }
        }
        this.sessionIds.push(sessionId);
        // do not await the health status check to prevent UI freeze while fetching
        this.#serviceProviderAPI.updateHealth();
        await this.updatePortfolioTokenList(structuredClone(this.#selectedAccount.portfolio.tokens), {
            preselectedToken: preselectedFromToken,
            preselectedToToken,
            fromAmount
        });
        this.isTokenListLoading = false;
        // Do not await on purpose as it's not critical for the controller state to be ready
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.#fetchSupportedChainsIfNeeded();
        if (activeRouteIdToDelete) {
            this.removeActiveRoute(activeRouteIdToDelete, false);
        }
        this.#emitUpdateIfNeeded();
    }
    // Temporary helper to monitor if NULL token addresses are still passed
    // to initForm or updateForm in the Swap & Bridge controller.
    // In theory, this should no longer happen after the fixes in socket/api.ts,
    // but we'll keep tracking it in Sentry for about a month to confirm.
    // If no errors are reported, we'll remove both this function and the
    // convertNullAddressToZeroAddressIfNeeded logic from initForm/updateForm.
    #emitSilentErrorIfNullAddress(address) {
        if (address.toLocaleLowerCase() === constants_1.NULL_ADDRESS) {
            const message = 'NULL token address detected while updating or initializing the Swap & Bridge controller.';
            this.emitError({
                level: 'silent',
                message,
                error: new Error(message)
            });
        }
    }
    get isHealthy() {
        return this.#serviceProviderAPI.isHealthy;
    }
    #fetchSupportedChainsIfNeeded = async (forceUpdate) => {
        const shouldNotReFetchSupportedChains = this.#cachedSupportedChains.data.length &&
            Date.now() - this.#cachedSupportedChains.lastFetched < SUPPORTED_CHAINS_CACHE_THRESHOLD;
        if (shouldNotReFetchSupportedChains)
            return;
        try {
            const supportedChains = await this.#serviceProviderAPI.getSupportedChains();
            this.#cachedSupportedChains = { lastFetched: Date.now(), data: supportedChains };
            this.#emitUpdateIfNeeded(forceUpdate);
        }
        catch (error) {
            // Fail silently, as this is not a critical feature, Swap & Bridge is still usable
            this.emitError({ error, level: 'silent', message: error?.message });
        }
    };
    get supportedChainIds() {
        return this.#cachedSupportedChains.data.map((c) => BigInt(c.chainId));
    }
    get #toTokenListKey() {
        if (this.fromChainId === null || this.toChainId === null)
            return null;
        return `from-${this.fromChainId}-to-${this.toChainId}`;
    }
    // Get the toTokenListKey from parameters instead of `this`,
    // because during async execution, the class state may already point
    // to a different chain pair.
    static getToTokenListKey(fromChainId, toChainId) {
        if (fromChainId === null || toChainId === null)
            return null;
        return `from-${fromChainId}-to-${toChainId}`;
    }
    unloadScreen(sessionId, forceUnload) {
        const isFormDirty = !!this.fromAmount || !!this.toSelectedToken;
        const shouldPersistState = isFormDirty && sessionId === 'popup' && !forceUnload;
        if (shouldPersistState)
            return;
        this.sessionIds = this.sessionIds.filter((id) => id !== sessionId);
        if (!this.sessionIds.length) {
            this.reset(true);
            // Reset health to prevent the error state from briefly flashing
            // before the next health check resolves when the Swap & Bridge
            // screen is opened after a some time
            this.#serviceProviderAPI.resetHealth();
        }
        this.hasProceeded = false;
    }
    addOrUpdateError(error) {
        const errorIndex = this.errors.findIndex((e) => e.id === error.id);
        if (errorIndex === -1) {
            this.errors.push(error);
        }
        else {
            this.errors[errorIndex] = error;
        }
        this.#emitUpdateIfNeeded();
    }
    removeError(id, shouldEmit) {
        this.errors = this.errors.filter((e) => e.id !== id);
        if (shouldEmit)
            this.#emitUpdateIfNeeded();
    }
    async updateForm(props, updateProps) {
        const { fromAmount, fromAmountInFiat, fromAmountFieldMode, toChainId, shouldSetMaxAmount, routePriority } = props;
        const fromSelectedToken = props.fromSelectedToken;
        if (fromSelectedToken) {
            this.#emitSilentErrorIfNullAddress(fromSelectedToken.address);
            // if the provider is socket, convert the null addresses
            fromSelectedToken.address = (0, swapAndBridge_1.convertNullAddressToZeroAddressIfNeeded)(fromSelectedToken.address);
        }
        const { emitUpdate = true, updateQuote = true, shouldIncrementFromAmountUpdateCounter = false } = updateProps || {};
        const chainId = toChainId ?? this.toChainId;
        let toSelectedTokenAddr;
        if (props.toSelectedTokenAddr && chainId) {
            this.#emitSilentErrorIfNullAddress(props.toSelectedTokenAddr);
            // if the provider is socket, convert the null addresses
            toSelectedTokenAddr = (0, swapAndBridge_1.convertNullAddressToZeroAddressIfNeeded)(props.toSelectedTokenAddr);
        }
        // when we init the form by using the retry button
        const shouldNotResetFromAmount = fromAmount && props.toSelectedTokenAddr && fromSelectedToken && toChainId;
        let shouldUpdateToTokenList = false;
        // fromAmountFieldMode must be set before fromAmount so it
        // works correctly when both are set at the same time
        if (fromAmountFieldMode) {
            this.fromAmountFieldMode = fromAmountFieldMode;
        }
        if (shouldSetMaxAmount) {
            // Always derive amounts from exact token balance. Using max fiat here
            // would run fiat→token rounding and often leave spendable dust.
            const previousFieldMode = this.fromAmountFieldMode;
            this.fromAmountFieldMode = 'token';
            this.#setFromAmountAmount(this.maxFromAmount, true);
            this.fromAmountFieldMode = previousFieldMode;
        }
        if (fromAmount !== undefined) {
            this.#setFromAmountAmount(fromAmount);
        }
        if (fromAmountInFiat !== undefined) {
            this.fromAmountInFiat = fromAmountInFiat;
        }
        if (shouldIncrementFromAmountUpdateCounter) {
            this.fromAmountUpdateCounter += 1;
        }
        if (typeof fromSelectedToken !== 'undefined') {
            const isFromNetworkChanged = this.fromSelectedToken?.chainId !== fromSelectedToken?.chainId;
            if (fromSelectedToken && isFromNetworkChanged) {
                const network = this.#networks.networks.find((n) => n.chainId === fromSelectedToken.chainId);
                if (network) {
                    this.fromChainId = Number(network.chainId);
                    shouldUpdateToTokenList = true;
                }
            }
            const shouldResetFromTokenAmount = !shouldNotResetFromAmount &&
                (isFromNetworkChanged ||
                    !fromSelectedToken ||
                    this.fromSelectedToken?.address !== fromSelectedToken.address);
            if (shouldResetFromTokenAmount) {
                this.#setFromAmountAndNotifyUI('');
                this.#setFromAmountInFiatAndNotifyUI('');
                this.fromAmountFieldMode = 'token';
            }
            // Always update to reflect portfolio amount (or other props) changes
            this.fromSelectedToken = fromSelectedToken;
        }
        if (toChainId) {
            if (this.toChainId !== Number(toChainId)) {
                this.toChainId = Number(toChainId);
                shouldUpdateToTokenList = true;
            }
        }
        const toTokensKey = this.#toTokenListKey;
        const toTokenList = toTokensKey ? this.#toTokenList[toTokensKey] : undefined;
        const nextToToken = toTokenList
            ? toTokenList.tokens.find((t) => t.address === toSelectedTokenAddr)
            : null;
        if (nextToToken)
            this.toSelectedToken = { ...nextToToken };
        if (routePriority) {
            this.routePriority = routePriority;
            if (this.quote) {
                this.quote = null;
                this.quoteRoutesStatuses = {};
            }
        }
        if (emitUpdate)
            this.#emitUpdateIfNeeded();
        await Promise.all([
            shouldUpdateToTokenList
                ? // we put toSelectedTokenAddr so that "retry" btn functionality works
                    this.updateToTokenList(true, nextToToken?.address || toSelectedTokenAddr)
                : undefined,
            updateQuote
                ? this.updateQuote({
                    skipQuoteUpdateOnSameValues: !shouldSetMaxAmount,
                    debounce: true
                })
                : undefined
        ]);
    }
    resetForm(shouldEmit) {
        // Preserve key form states instead of resetting the whole form to enhance UX and reduce confusion.
        // After form submission, maintain the state for fromSelectedToken, fromChainId, and toChainId,
        // while resetting all other state related to the form.
        this.#setFromAmountAndNotifyUI('');
        this.#setFromAmountInFiatAndNotifyUI('');
        this.fromAmountFieldMode = 'token';
        this.toSelectedToken = null;
        this.quote = null;
        this.updateQuoteStatus = 'INITIAL';
        this.quoteRoutesStatuses = {};
        this.destroySignAccountOp();
        this.hasProceeded = false;
        this.#updateQuoteId = undefined;
        this.fromAmountUpdateCounter = 0;
        if (shouldEmit)
            this.#emitUpdateIfNeeded(true);
    }
    reset(shouldEmit) {
        const toTokenListKey = this.#toTokenListKey;
        this.resetForm();
        this.portfolioTokenList = [];
        if (toTokenListKey && this.#toTokenList[toTokenListKey]) {
            this.#toTokenList[toTokenListKey].tokens = [];
        }
        this.fromChainId = 1;
        this.fromSelectedToken = null;
        this.toChainId = 1;
        this.errors = [];
        this.updateQuoteInterval.stop();
        if (shouldEmit)
            this.#emitUpdateIfNeeded(true);
    }
    async updatePortfolioTokenList(nextPortfolioTokenList, params) {
        // If the user has switched TOKEN -> NULL that would make the fromSelectedToken
        // null, so we need to keep it null, even if the portfolio token list is updated
        // until the user manually selects a new token
        const isSelectedTokenFalsyBeforeListUpdate = !this.fromSelectedToken && !!this.toSelectedToken;
        const { preselectedToken, preselectedToToken, fromAmount } = params || {};
        const tokens = nextPortfolioTokenList
            .filter((token) => 
        // Filtering out hidden tokens here means: 1) They won't be displayed in
        // the "From" token list (`this.portfolioTokenList`) and 2) They won't be
        // added to the "Receive" token list as additional tokens from portfolio,
        // BUT 3) They will appear in the "Receive" if they are present in service
        // provider's to token list. This is the desired behavior.
        (0, swapAndBridge_1.getIsTokenEligibleForSwapAndBridge)(token) && !token.flags.isHidden)
            .map((token) => ({
            ...token,
            address: (0, swapAndBridge_1.mapBannedToValidAddr)(Number(token.chainId), token.address)
        }));
        this.portfolioTokenList = (0, swapAndBridge_1.sortPortfolioTokenList)(tokens);
        const fromSelectedTokenInNextPortfolio = this.portfolioTokenList.find((t) => {
            if (preselectedToken) {
                return t.address === preselectedToken.address && t.chainId === preselectedToken.chainId;
            }
            return (t.address === this.fromSelectedToken?.address &&
                t.chainId === this.fromSelectedToken?.chainId);
        });
        const shouldUpdateFromSelectedToken = !this.fromSelectedToken || // initial (default) state
            // May happen if selected account gets changed or the token gets send away in the meantime
            !fromSelectedTokenInNextPortfolio ||
            // May happen if user receives or sends the token in the meantime
            fromSelectedTokenInNextPortfolio.amount !== this.fromSelectedToken?.amount ||
            preselectedToken;
        // If the token is not in the portfolio because it was a "to" token
        // and the user has switched the "from" and "to" tokens we should not
        // update the selected token
        if (!this.fromSelectedToken?.isSwitchedToToken &&
            !isSelectedTokenFalsyBeforeListUpdate &&
            shouldUpdateFromSelectedToken) {
            // get the networks that account is supported on and select
            // one from that list, not only the providers lists of networks
            const accNetworks = (0, networks_1.getAccountNetworks)(this.#networks.networks, this.#accounts.accountStates, this.#selectedAccount.account).map((n) => n.chainId);
            const nextFromSelectedToken = fromSelectedTokenInNextPortfolio ||
                // Select the first token in the portfolio that is not the same as the "to" token
                this.portfolioTokenList.find((t) => t.address !== this.toSelectedToken?.address &&
                    this.supportedChainIds.includes(t.chainId) &&
                    accNetworks.includes(t.chainId)) ||
                null;
            await this.updateForm({
                fromSelectedToken: nextFromSelectedToken,
                toSelectedTokenAddr: preselectedToToken?.address,
                toChainId: preselectedToToken?.chainId ??
                    (preselectedToken ? nextFromSelectedToken?.chainId : undefined),
                fromAmount
            }, {
                emitUpdate: false,
                shouldIncrementFromAmountUpdateCounter: true
            });
            return;
        }
        this.#addFromTokenToPortfolioListIfNeeded();
        this.#emitUpdateIfNeeded();
    }
    async updateToTokenList(shouldReset, addressToSelect) {
        const fromChainId = this.fromChainId;
        const toChainId = this.toChainId;
        const toTokenListKeyAtStart = this.#toTokenListKey;
        if (!toTokenListKeyAtStart || !fromChainId || !toChainId)
            return;
        let toTokenList = this.#toTokenList[toTokenListKeyAtStart];
        // Prevent updating the same token list twice
        if (toTokenList?.status === 'LOADING') {
            return;
        }
        // Create the list if it doesn’t exist yet, or set its status to LOADING if it does.
        if (!toTokenList) {
            this.#toTokenList[toTokenListKeyAtStart] = {
                status: 'LOADING',
                apiTokens: [],
                tokens: [],
                lastUpdate: 0
            };
            toTokenList = this.#toTokenList[toTokenListKeyAtStart];
        }
        else {
            toTokenList.status = 'LOADING';
        }
        if (shouldReset) {
            this.toSelectedToken = null;
        }
        this.removeError('to-token-list-fetch-failed', false);
        // Emit an update to set the loading state in the UI
        this.#emitUpdateIfNeeded();
        const now = Date.now();
        const shouldFetchTokenList = !toTokenList.apiTokens.length || now - toTokenList.lastUpdate >= TO_TOKEN_LIST_CACHE_THRESHOLD;
        if (shouldFetchTokenList) {
            try {
                toTokenList.apiTokens = await this.#serviceProviderAPI.getToTokenList({
                    fromChainId,
                    toChainId
                });
                toTokenList.lastUpdate = Date.now();
            }
            catch (error) {
                // Display an error only if there is no cached data
                if (!toTokenList.apiTokens.length) {
                    const { message } = (0, swapAndBridgeErrorHumanizer_1.getHumanReadableSwapAndBridgeError)(error);
                    this.addOrUpdateError({
                        id: 'to-token-list-fetch-failed',
                        title: 'Token list on the receiving network is temporarily unavailable.',
                        text: message,
                        level: 'error'
                    });
                }
            }
        }
        toTokenList.tokens = this.#getToTokens(fromChainId, toChainId);
        const toTokenNetwork = this.#networks.networks.find((n) => Number(n.chainId) === toChainId);
        // should never happen
        if (!toTokenNetwork) {
            toTokenList.status = 'INITIAL';
            this.#emitUpdateIfNeeded();
            throw new SwapAndBridgeError_1.default(NETWORK_MISMATCH_MESSAGE);
        }
        if (toTokenListKeyAtStart === this.#toTokenListKey && !this.toSelectedToken) {
            if (addressToSelect) {
                const token = toTokenList.tokens.find((t) => t.address === addressToSelect);
                if (token) {
                    await this.updateForm({ toSelectedTokenAddr: token.address }, { emitUpdate: false });
                    this.#emitUpdateIfNeeded();
                }
            }
        }
        toTokenList.status = 'INITIAL';
        this.#emitUpdateIfNeeded();
    }
    /**
     * Returns the short list of tokens for the "to" token list, because the full
     * list (stored in #toTokenList) could be HUGE, causing the controller to be
     * HUGE as well, that leads to performance problems.
     */
    get toTokenShortList() {
        const toTokenListKey = this.#toTokenListKey;
        const fromChainId = this.fromChainId;
        const toChainId = this.toChainId;
        if (!toTokenListKey || !fromChainId || !toChainId)
            return [];
        const tokens = this.#toTokenList[toTokenListKey]?.tokens || [];
        const isSwapping = fromChainId === toChainId;
        if (isSwapping) {
            return (tokens
                // Swaps between same "from" and "to" tokens are not feasible, filter them out
                .filter((t) => t.address !== this.fromSelectedToken?.address)
                .slice(0, TO_TOKEN_LIST_LIMIT));
        }
        return tokens.slice(0, TO_TOKEN_LIST_LIMIT);
    }
    #getToTokens(fromChainId, toChainId) {
        const toTokenListKey = SwapAndBridgeController.getToTokenListKey(fromChainId, toChainId);
        if (!toTokenListKey || !fromChainId || !toChainId)
            return [];
        const apiTokens = this.#toTokenList[toTokenListKey]?.apiTokens ||
            (0, swapAndBridge_1.addCustomTokensIfNeeded)({
                chainId: toChainId,
                tokens: []
            });
        const portfolioTokens = this.portfolioTokenList.filter((t) => t.chainId === BigInt(toChainId));
        const additionalTokensFromPortfolio = portfolioTokens
            .filter((token) => !apiTokens.some((t) => t.address === token.address))
            .map((t) => (0, swapAndBridge_1.convertPortfolioTokenToSwapAndBridgeToToken)(t, toChainId));
        const chainBannedTokens = (0, swapAndBridge_1.getBannedToTokenList)(toChainId.toString());
        return (0, swapAndBridge_1.sortTokenListResponse)([...apiTokens, ...additionalTokensFromPortfolio], portfolioTokens).filter((t) => !chainBannedTokens.includes((0, ethers_1.getAddress)(t.address)));
    }
    get updateToTokenListStatus() {
        const toTokenListKey = this.#toTokenListKey;
        if (!toTokenListKey)
            return 'INITIAL';
        const toTokenList = this.#toTokenList[toTokenListKey];
        if (!toTokenList)
            return 'INITIAL';
        return toTokenList.status;
    }
    async #addToTokenByAddress(address) {
        if (!this.toChainId)
            return; // should never happen
        if (!(0, ethers_1.isAddress)(address))
            return; // no need to attempt with invalid addresses
        const toTokenListKey = this.#toTokenListKey;
        if (!toTokenListKey || !this.#toTokenList[toTokenListKey])
            return;
        const tokenList = this.#toTokenList[toTokenListKey];
        const isAlreadyInTheList = tokenList.tokens.some(
        // Compare lowercase, address param comes from a search term that is lowercased
        (t) => t.address.toLowerCase() === address.toLowerCase());
        if (isAlreadyInTheList)
            return;
        let token;
        try {
            token = await this.#serviceProviderAPI.getToken({ address, chainId: this.toChainId });
            if (!token)
                throw new SwapAndBridgeError_1.default('Token with this address is not supported by our service provider.');
        }
        catch (error) {
            const { message } = (0, swapAndBridgeErrorHumanizer_1.getHumanReadableSwapAndBridgeError)(error);
            throw new EmittableError_1.default({ error, level: 'minor', message });
        }
        if (toTokenListKey)
            // Cache for sometime the tokens added by address
            tokenList.apiTokens.push(token);
        tokenList.tokens.push(token);
        const toTokenNetwork = this.#networks.networks.find((n) => Number(n.chainId) === this.toChainId);
        // should never happen
        if (!toTokenNetwork) {
            const error = new SwapAndBridgeError_1.default(NETWORK_MISMATCH_MESSAGE);
            throw new EmittableError_1.default({ error, level: 'minor', message: error?.message });
        }
        tokenList.tokens = (0, swapAndBridge_1.sortTokenListResponse)(tokenList.tokens, this.portfolioTokenList.filter((t) => t.chainId === toTokenNetwork.chainId));
        // Re-trigger search, because of the updated #toTokenList
        await this.searchToToken(token.address);
        this.#emitUpdateIfNeeded();
        return token;
    }
    #getIsWrapOrUnwrap() {
        const fromSelectedToken = this.fromSelectedToken;
        const toSelectedToken = this.toSelectedToken;
        if (!toSelectedToken || !fromSelectedToken)
            return false;
        const isSameChain = this.fromChainId === this.toChainId;
        if (!isSameChain)
            return false;
        const fromAddr = fromSelectedToken.address.toLowerCase();
        const toAddr = toSelectedToken.address.toLowerCase();
        if (fromAddr !== ethers_1.ZeroAddress && toAddr !== ethers_1.ZeroAddress)
            return false;
        const networkData = this.#networks.networks.find((n) => n.chainId === fromSelectedToken.chainId);
        if (!networkData)
            return false;
        const nativeWrappedAddress = networkData.wrappedAddr?.toLowerCase();
        const isWrap = fromAddr === ethers_1.ZeroAddress && toAddr === nativeWrappedAddress;
        const isUnwrap = fromAddr === nativeWrappedAddress && toAddr === ethers_1.ZeroAddress;
        return isWrap || isUnwrap;
    }
    #accountNativeBalance(amount) {
        if (!this.#selectedAccount.account || !this.fromChainId)
            return 0n;
        const currentPortfolio = this.#portfolio.getAccountPortfolioState(this.#selectedAccount.account.addr);
        const currentPortfolioNetwork = currentPortfolio[this.fromChainId.toString()];
        const native = currentPortfolioNetwork?.result?.tokens.find((token) => token.address === ethers_1.ZeroAddress);
        if (!native)
            return 0n;
        if (this.fromSelectedToken?.address !== ethers_1.ZeroAddress)
            return native.amount;
        // subtract the from amount from the portfolio available balance
        if (amount > native.amount)
            return 0n;
        return native.amount - amount;
    }
    /**
     * Add the selected token to the portfolio token list if needed. This is
     * necessary because the user may switch the "from" and "to" tokens, and the
     * to token may be a token that is not in the portfolio token list.
     */
    #addFromTokenToPortfolioListIfNeeded() {
        if (!this.fromSelectedToken)
            return;
        const isAlreadyInTheList = this.portfolioTokenList.some((t) => t.address === this.fromSelectedToken.address &&
            t.chainId === this.fromSelectedToken.chainId);
        if (isAlreadyInTheList || !this.fromSelectedToken.isSwitchedToToken)
            return;
        this.portfolioTokenList = [...this.portfolioTokenList, this.fromSelectedToken];
    }
    addToTokenByAddress = async (address) => this.withStatus('addToTokenByAddress', () => this.#addToTokenByAddress(address), true);
    async searchToToken(searchTerm) {
        // Reset the search results
        this.toTokenSearchTerm = '';
        this.toTokenSearchResults = [];
        this.#emitUpdateIfNeeded();
        if (!searchTerm)
            return; // should never happen
        if (!this.#toTokenListKey || !this.#toTokenList[this.#toTokenListKey])
            return;
        const normalizedSearchTerm = searchTerm.trim().toLowerCase();
        this.toTokenSearchTerm = normalizedSearchTerm;
        const tokens = this.#toTokenList[this.#toTokenListKey]?.tokens || [];
        const { exactMatches, partialMatches } = tokens.reduce((result, token) => {
            // Filter out the from token if swapping on the same chain
            if (this.toChainId &&
                this.fromChainId === this.toChainId &&
                token.address === this.fromSelectedToken?.address)
                return result;
            const fieldsToSearch = [
                token.address.toLowerCase(),
                token.symbol.toLowerCase(),
                token.name.toLowerCase()
            ];
            // Prioritize exact matches, partial matches come after
            const isExactMatch = fieldsToSearch.some((field) => field === normalizedSearchTerm);
            const isPartialMatch = fieldsToSearch.some((field) => field.includes(normalizedSearchTerm));
            if (isExactMatch) {
                result.exactMatches.push(token);
            }
            else if (isPartialMatch) {
                result.partialMatches.push(token);
            }
            return result;
        }, { exactMatches: [], partialMatches: [] });
        this.toTokenSearchResults = [...exactMatches, ...partialMatches].slice(0, TO_TOKEN_LIST_LIMIT);
        this.#emitUpdateIfNeeded();
    }
    async switchFromAndToTokens() {
        this.switchTokensStatus = 'LOADING';
        this.#emitUpdateIfNeeded();
        const prevFromSelectedToken = this.fromSelectedToken ? { ...this.fromSelectedToken } : null;
        // Update the from token
        if (!this.toSelectedToken) {
            await this.updateForm({
                fromAmount: '',
                fromAmountFieldMode: 'token',
                toSelectedTokenAddr: this.fromSelectedToken?.address || null
            }, {
                emitUpdate: false,
                updateQuote: false,
                shouldIncrementFromAmountUpdateCounter: true
            });
            this.fromSelectedToken = null;
        }
        else if (this.toChainId) {
            const toSelectedTokenNetwork = this.#networks.networks.find((n) => Number(n.chainId) === this.toChainId);
            const tokenInPortfolio = this.portfolioTokenList.find((token) => token.chainId === toSelectedTokenNetwork.chainId &&
                token.address === this.toSelectedToken?.address);
            const price = Number(this.quote?.selectedRoute?.toToken?.priceUSD || 0);
            this.fromSelectedToken = tokenInPortfolio || {
                ...this.toSelectedToken,
                chainId: BigInt(this.toChainId),
                amount: 0n,
                flags: {
                    onGasTank: false,
                    isFeeToken: false,
                    canTopUpGasTank: false,
                    rewardsType: null
                },
                marketDataIn: [],
                priceIn: price ? [{ baseCurrency: 'usd', price }] : []
            };
            this.fromSelectedToken.isSwitchedToToken = true;
            this.#addFromTokenToPortfolioListIfNeeded();
            // Update the amount to the one from the quote
            let fromAmount = '';
            // Try catch just in case because of formatUnits
            try {
                if (this.quote && this.quote.selectedRoute?.fromAmount) {
                    fromAmount = (0, ethers_1.formatUnits)(this.quote.selectedRoute.toAmount, this.quote.selectedRoute.toToken.decimals);
                }
            }
            catch (error) {
                console.error('Error formatting fromAmount', error);
            }
            await this.updateForm({
                fromAmount,
                fromAmountFieldMode: 'token'
            }, {
                emitUpdate: false,
                updateQuote: false,
                shouldIncrementFromAmountUpdateCounter: true
            });
        }
        // Update the chain ids
        ;
        [this.fromChainId, this.toChainId] = [this.toChainId, this.fromChainId];
        // Update the to token list
        await this.updateToTokenList(true, prevFromSelectedToken?.address);
        this.switchTokensStatus = 'INITIAL';
        this.#emitUpdateIfNeeded();
    }
    async updateQuote(options) {
        const { skipQuoteUpdateOnSameValues = true, skipPreviousQuoteRemoval = false, skipStatusUpdate = false, debounce = false } = options || {};
        // no updates if the user has commited
        if (this.formStatus === SwapAndBridgeFormStatus.Proceeded)
            return;
        // no quote fetch if there are errors
        if (this.swapSignErrors.length)
            return;
        const quoteId = (0, uuid_1.generateUuid)();
        this.#updateQuoteId = quoteId;
        const updateQuoteFunction = async () => {
            if (!this.#selectedAccount.account)
                return;
            if (!this.#getIsFormValidToFetchQuote())
                return;
            if (!this.fromAmount || !this.fromSelectedToken || !this.toSelectedToken)
                return;
            const bigintFromAmount = (0, ethers_1.parseUnits)((0, formatters_1.getSafeAmountFromFieldValue)(this.fromAmount, this.fromSelectedToken.decimals), this.fromSelectedToken.decimals);
            if (this.quote) {
                const isFromAmountSame = this.quote.selectedRoute?.fromAmount === bigintFromAmount.toString();
                const isFromNetworkSame = this.quote.fromChainId === this.fromChainId;
                const isFromAddressSame = this.quote.fromAsset.address === this.fromSelectedToken.address;
                const isToNetworkSame = this.quote.toChainId === this.toChainId;
                const isToAddressSame = this.quote.toAsset.address === this.toSelectedToken.address;
                if (skipQuoteUpdateOnSameValues &&
                    isFromAmountSame &&
                    isFromNetworkSame &&
                    isFromAddressSame &&
                    isToNetworkSame &&
                    isToAddressSame) {
                    // We consider reusing the same quote a success (hence we return true).
                    // Otherwise, at the end of `updateQuote`, if we treat it as a falsy value,
                    // the quote will be reset and the signAccountOp will be destroyed,
                    // which is incorrect behavior, given that we already have a valid quote.
                    return true;
                }
            }
            if (!skipPreviousQuoteRemoval) {
                if (this.quote) {
                    this.quote = null;
                    this.updateQuoteStatus = 'LOADING';
                }
                this.quoteRoutesStatuses = {};
                this.#emitUpdateIfNeeded();
            }
            try {
                const network = this.#networks.networks.find((n) => Number(n.chainId) === this.fromChainId);
                const isWrapOrUnwrap = this.#getIsWrapOrUnwrap();
                const quoteResult = await this.#serviceProviderAPI.quote({
                    fromAsset: this.fromSelectedToken,
                    fromChainId: this.fromChainId,
                    fromTokenAddress: this.fromSelectedToken.address,
                    toAsset: this.toSelectedToken,
                    toChainId: this.toChainId,
                    toTokenAddress: this.toSelectedToken.address,
                    fromAmount: bigintFromAmount,
                    userAddress: this.#selectedAccount.account.addr,
                    sort: this.routePriority,
                    isWrapOrUnwrap,
                    accountNativeBalance: this.#accountNativeBalance(bigintFromAmount),
                    nativeSymbol: network?.nativeAssetSymbol || 'ETH'
                });
                // sort the routes by value and them by disabled, making disabled last
                quoteResult.routes = quoteResult.routes
                    .filter((route) => {
                    const hasNoRouteId = !route.routeId;
                    if (hasNoRouteId) {
                        this.emitError({
                            level: 'silent',
                            error: new SwapAndBridgeError_1.default(`Received route with no routeId from ${this.#serviceProviderAPI.name}. From: ${this.fromSelectedToken?.address} (${this.fromSelectedToken?.chainId}) To: ${this.toSelectedToken?.address} (${this.toSelectedToken?.chainId})`),
                            message: 'Received route with no routeId'
                        });
                    }
                    return !hasNoRouteId;
                })
                    .sort((r1, r2) => {
                    const isBridge = r1.fromChainId !== r1.toChainId;
                    // the amount threshold in %. If below, we check the time as
                    // the deciding sort factor
                    const threshold = 1.2;
                    const sortByTime = () => {
                        const aTime = Number(r1.serviceTime);
                        const bTime = Number(r2.serviceTime);
                        if (aTime === bTime)
                            return 0;
                        if (aTime > bTime)
                            return 1;
                        return -1;
                    };
                    const sortByPerformance = () => {
                        // if it's a bridge, prioritize across and relay as we find
                        // across and relay the best bridges out where with a close
                        // to 100% success rate and an approximate bridge time of 30s
                        if (isBridge) {
                            const aHasAcross = r1.usedBridgeNames?.includes('across');
                            const bHasAcross = r2.usedBridgeNames?.includes('across');
                            if (aHasAcross && !bHasAcross)
                                return -1;
                            if (bHasAcross && !aHasAcross)
                                return 1;
                            const aHasRelay = r1.usedBridgeNames?.includes('relaydepository');
                            const bHasRelay = r2.usedBridgeNames?.includes('relaydepository');
                            if (aHasRelay && !bHasRelay)
                                return -1;
                            if (bHasRelay && !aHasRelay)
                                return 1;
                        }
                        else {
                            // if it's a swap, deprioritize the bungee auto route as it's an intent
                            // engine. And intent engines are bad UX
                            const aHasBungeeAutoRoute = r1.usedBridgeNames?.includes('bungeeAutoRoute');
                            const bHasBungeeAutoRoute = r2.usedBridgeNames?.includes('bungeeAutoRoute');
                            if (aHasBungeeAutoRoute && !bHasBungeeAutoRoute)
                                return 1;
                            if (bHasBungeeAutoRoute && !aHasBungeeAutoRoute)
                                return -1;
                        }
                        const a = BigInt(r1.toAmount);
                        const b = BigInt(r2.toAmount);
                        // if value is the same, check time if bridge
                        if (a === b) {
                            if (!isBridge)
                                return 0;
                            return sortByTime();
                        }
                        const aUsd = Number(r1.outputValueInUsd ?? 0);
                        const bUsd = Number(r2.outputValueInUsd ?? 0);
                        if (a > b) {
                            // if it's not a bridge, just return the higher output route
                            if (!isBridge)
                                return -1;
                            // if the bigint amount says a > b but the usd amount says
                            // the opposite, we're stuck, so just return a as the winner
                            if (bUsd > aUsd || aUsd === 0)
                                return -1;
                            const percentage = ((aUsd - bUsd) / aUsd) * 100;
                            if (percentage < threshold)
                                return sortByTime();
                            return -1;
                        }
                        // if it's not a bridge, just return the higher output route
                        if (!isBridge)
                            return 1;
                        // if the bigint amount says b > a but the usd amount says
                        // the opposite, we're stuck, so just return b as the winner
                        if (aUsd > bUsd || bUsd === 0)
                            return 1;
                        const percentage = ((bUsd - aUsd) / bUsd) * 100;
                        if (percentage < threshold)
                            return sortByTime();
                        return 1;
                    };
                    // move the routes with service fee to the bottom
                    const r1ServiceFee = r1.serviceFee && Number(r1.serviceFee.amountUSD) > 0;
                    const r2ServiceFee = r2.serviceFee && Number(r2.serviceFee.amountUSD) > 0;
                    if (r1ServiceFee && !r2ServiceFee)
                        return 1;
                    if (r2ServiceFee && !r1ServiceFee)
                        return -1;
                    return sortByPerformance();
                })
                    .sort((a, b) => Number(a.disabled === true) - Number(b.disabled === true));
                // select the first enabled route
                quoteResult.selectedRoute = quoteResult.routes.length ? quoteResult.routes[0] : undefined;
                quoteResult.selectedRouteSteps = quoteResult.selectedRoute
                    ? quoteResult.selectedRoute.steps
                    : [];
                if (this.#isQuoteIdObsoleteAfterAsyncOperation(quoteId))
                    return;
                // no updates if the user has commited
                if (this.formStatus === SwapAndBridgeFormStatus.Proceeded)
                    return;
                if (this.#getIsFormValidToFetchQuote() &&
                    quoteResult &&
                    quoteResult.fromChainId === this.fromChainId &&
                    quoteResult.toChainId === this.toChainId &&
                    quoteResult.toAsset.address === this.toSelectedToken?.address) {
                    const routes = quoteResult.routes || [];
                    if (!routes.length || !quoteResult.selectedRoute) {
                        this.quote = null;
                        return;
                    }
                    this.quote = {
                        fromAsset: quoteResult.fromAsset,
                        fromChainId: quoteResult.fromChainId,
                        toAsset: quoteResult.toAsset,
                        toChainId: quoteResult.toChainId,
                        selectedRoute: quoteResult.selectedRoute,
                        selectedRouteSteps: quoteResult.selectedRoute.steps,
                        routes
                    };
                }
                this.quoteRoutesStatuses = quoteResult.bridgeRouteErrors || {};
                return true;
            }
            catch (error) {
                if (this.#isQuoteIdObsoleteAfterAsyncOperation(quoteId))
                    return;
                const { message } = (0, swapAndBridgeErrorHumanizer_1.getHumanReadableSwapAndBridgeError)(error);
                this.emitError({ error, level: 'major', message });
                return false;
            }
        };
        if (!this.#getIsFormValidToFetchQuote()) {
            if (this.quote || this.quoteRoutesStatuses) {
                this.#resetQuote();
            }
            return;
        }
        if (!skipStatusUpdate) {
            this.updateQuoteStatus = 'LOADING';
            this.removeError('no-routes');
            this.removeError('all-routes-failed');
            this.#emitUpdateIfNeeded();
        }
        // Debounce the updateQuote function to avoid multiple calls
        if (debounce)
            await (0, wait_1.default)(500);
        if (this.#updateQuoteId !== quoteId)
            return;
        const isSuccessful = await updateQuoteFunction();
        if (this.#updateQuoteId !== quoteId)
            return;
        this.updateQuoteStatus = 'INITIAL';
        this.#emitUpdateIfNeeded();
        if (isSuccessful) {
            await this.initSignAccountOpIfNeeded(quoteId);
        }
        else {
            // When destroying the signAccountOp, we must also reset the quote and its status;
            // otherwise, the toToken state remains stuck in a loading state.
            // This ensures the user can retry fetching the quote.
            this.destroySignAccountOp();
            this.#resetQuote();
        }
        this.updateQuoteInterval.restart();
    }
    #resetQuote() {
        this.quote = null;
        this.quoteRoutesStatuses = {};
        this.updateQuoteStatus = 'INITIAL';
        this.removeError('no-routes');
        this.removeError('all-routes-failed');
        this.#emitUpdateIfNeeded();
    }
    async getRouteStartUserTx() {
        if (this.formStatus !== SwapAndBridgeFormStatus.ReadyToEstimate &&
            this.formStatus !== SwapAndBridgeFormStatus.ReadyToSubmit)
            return null;
        if (!this.quote || !this.quote.selectedRoute)
            return null;
        try {
            const routeResult = await this.#serviceProviderAPI.startRoute(this.quote.selectedRoute);
            return {
                ...routeResult,
                activeRouteId: this.quote.selectedRoute.routeId,
                success: true
            };
        }
        catch (error) {
            const humanizedError = (0, swapAndBridgeErrorHumanizer_1.getHumanReadableSwapAndBridgeError)(error);
            // Display the error in the UI only if it has a shortMessage
            // as we don't have much space and there is a default error message
            if ('shortMessage' in humanizedError &&
                humanizedError.shortMessage &&
                typeof humanizedError.shortMessage === 'string') {
                return {
                    success: false,
                    id: 'no-routes',
                    title: humanizedError.shortMessage,
                    level: 'error'
                };
            }
            return null;
        }
    }
    async recordBridgeActivity(txnId, activeRoute, status) {
        await this.#initialLoadPromise;
        // when the status is completed, we expect the funds to land on the
        // destination chain => we use toChainId;
        // when it's refunded, we expect the source chain => fromChainId
        const chainId = status === 'completed' ? activeRoute.route?.toChainId : activeRoute.route?.fromChainId;
        if (!chainId) {
            const message = 'recordBridgeActivity: no chainId found';
            this.emitError({
                level: 'silent',
                message,
                error: new Error(message)
            });
            return;
        }
        const provider = this.#providers.providers[chainId.toString()];
        if (!provider) {
            const message = 'recordBridgeActivity: no provider found';
            this.emitError({
                level: 'silent',
                message,
                error: new Error(message)
            });
            return;
        }
        const receipt = await provider.getTransactionReceipt(txnId);
        if (!receipt) {
            const message = `recordBridgeActivity: no receipt found for txnId: ${txnId}`;
            this.emitError({
                level: 'silent',
                message,
                error: new Error(message)
            });
            return;
        }
        await this.#activity.addExternalAccountOp({
            accountAddr: activeRoute.sender,
            chainId: BigInt(chainId),
            txnId,
            receipt,
            callId: `${activeRoute.activeRouteId}-external`
        });
    }
    async checkForActiveRoutesStatusUpdate() {
        await this.#initialLoadPromise;
        const fetchAndUpdateRoute = async (activeRoute) => {
            let status = null;
            let routeStatusResult = { status: null };
            if (!activeRoute.userTxHash || activeRoute.routeStatus === 'completed')
                return;
            const latestSubmittedAccountOps = this.#activity.getAccountOpsForAccount({
                accountAddr: activeRoute.sender,
                from: 0,
                numberOfItems: 10
            });
            const activeRouteSubmittedAccountOp = latestSubmittedAccountOps.find((op) => op.txnId === activeRoute.userTxHash);
            if (!activeRouteSubmittedAccountOp)
                return;
            try {
                // should never happen
                if (!activeRoute.route)
                    throw new Error('Route data is missing.');
                routeStatusResult = await this.#serviceProviderAPI.getRouteStatus({
                    fromChainId: activeRoute.route.fromChainId,
                    toChainId: activeRoute.route.toChainId,
                    bridge: activeRoute.route.usedBridgeNames?.[0],
                    txHash: activeRoute.userTxHash,
                    providerId: activeRoute.route.providerId,
                    requestId: activeRoute.route.rawRoute?.requestId,
                    routeId: activeRoute.route.routeId
                });
                status = routeStatusResult.status;
            }
            catch (e) {
                const { message } = (0, swapAndBridgeErrorHumanizer_1.getHumanReadableSwapAndBridgeError)(e);
                this.updateActiveRoute(activeRoute.activeRouteId, { error: message });
                return;
            }
            // prevent race condition in case there is a newer update
            if (this.#continuouslyUpdateActiveRoutesSessionId !== this.#getActiveRoutesInProgressSessionId()) {
                return;
            }
            const route = this.activeRoutes.find((r) => r.activeRouteId === activeRoute.activeRouteId);
            if (route?.error) {
                this.updateActiveRoute(activeRoute.activeRouteId, {
                    error: undefined
                });
            }
            if (routeStatusResult.txnId &&
                (status === 'completed' || status === 'refunded') &&
                activeRoute.route?.fromChainId !== activeRoute.route?.toChainId) {
                // we shouldn't be awaiting this as it's OK to have it at a later stage
                this.recordBridgeActivity(routeStatusResult.txnId, activeRoute, status).catch(console.error);
            }
            if (status === 'completed') {
                this.updateActiveRoute(activeRoute.activeRouteId, {
                    routeStatus: 'completed',
                    error: undefined
                }, true);
                if (this.#portfolioUpdate && (0, swapAndBridge_1.getIsBridgeRoute)(activeRoute.route)) {
                    this.#portfolioUpdate([BigInt(activeRoute.route.toChainId)]);
                }
            }
            else if (status === 'ready') {
                this.updateActiveRoute(activeRoute.activeRouteId, {
                    routeStatus: 'ready',
                    error: undefined
                }, true);
            }
            else if (status === 'refunded') {
                this.updateActiveRoute(activeRoute.activeRouteId, {
                    routeStatus: 'refunded',
                    error: undefined
                }, true);
            }
        };
        await Promise.all(this.activeRoutesInProgress.map(async (route) => {
            await fetchAndUpdateRoute(route);
        }));
    }
    async selectRoute(route, opts) {
        const { isManualSelection = false } = opts || {};
        if (!this.quote || !this.quote.routes.length)
            return;
        if (![
            SwapAndBridgeFormStatus.ReadyToSubmit,
            SwapAndBridgeFormStatus.ReadyToEstimate,
            SwapAndBridgeFormStatus.InvalidRouteSelected
        ].includes(this.formStatus))
            return;
        this.quote.selectedRoute = route;
        this.quote.selectedRouteSteps = route.steps;
        if (isManualSelection)
            this.quote.selectedRoute.isSelectedManually = true;
        if (this.#updateQuoteId)
            await this.initSignAccountOpIfNeeded(this.#updateQuoteId);
        this.emitUpdate();
    }
    addActiveRoute({ userTxIndex, quote, routeStatus = 'ready' }) {
        const finalQuote = quote || this.quote;
        if (!finalQuote || !finalQuote.selectedRoute) {
            const message = 'Unexpected swap & bridge error: no quote found. Please contact support';
            throw new EmittableError_1.default({ error: new Error(message), level: 'major', message });
        }
        try {
            const route = finalQuote.selectedRoute;
            this.activeRoutes.push({
                serviceProviderId: finalQuote.selectedRoute.providerId,
                activeRouteId: route.routeId.toString(),
                userTxIndex,
                routeStatus,
                userTxHash: null,
                fromAsset: {
                    ...finalQuote.fromAsset,
                    icon: finalQuote.fromAsset.icon || '',
                    logoURI: finalQuote.fromAsset.icon || ''
                },
                toAsset: {
                    ...finalQuote.toAsset,
                    icon: finalQuote.toAsset.icon || '',
                    logoURI: finalQuote.toAsset.icon || ''
                },
                fromAssetAddress: finalQuote.fromAsset.address,
                toAssetAddress: finalQuote.toAsset.address,
                steps: route.steps,
                sender: route.userAddress,
                identifiedBy: null,
                route: {
                    ...route,
                    routeStatus,
                    transactionData: null
                }
            });
            this.emitUpdate();
        }
        catch (error) {
            const { message } = (0, swapAndBridgeErrorHumanizer_1.getHumanReadableSwapAndBridgeError)(error);
            throw new EmittableError_1.default({ error, level: 'major', message });
        }
    }
    updateActiveRoute(activeRouteId, activeRoute, forceUpdateRoute) {
        const currentActiveRoutes = [...this.activeRoutes];
        const activeRouteIndex = currentActiveRoutes.findIndex((r) => r.activeRouteId === activeRouteId);
        if (activeRouteIndex !== -1 && currentActiveRoutes[activeRouteIndex]) {
            if (forceUpdateRoute) {
                // eslint-disable-next-line @typescript-eslint/no-floating-promises
                ;
                (async () => {
                    const route = currentActiveRoutes[activeRouteIndex].route;
                    this.updateActiveRoute(activeRouteId, { route });
                })();
            }
            if (activeRoute) {
                currentActiveRoutes[activeRouteIndex] = {
                    ...currentActiveRoutes[activeRouteIndex],
                    ...activeRoute
                };
            }
            else {
                currentActiveRoutes[activeRouteIndex] = { ...currentActiveRoutes[activeRouteIndex] };
            }
            if (activeRoute?.routeStatus === 'completed' || activeRoute?.routeStatus === 'refunded') {
                // Change the currentUserTxIndex to the length of the userTxs array
                // a.k.a. all transactions are completed
                const activeRouteRoute = currentActiveRoutes[activeRouteIndex].route;
                if (activeRouteRoute) {
                    activeRouteRoute.currentUserTxIndex = activeRouteRoute.userTxs.length;
                }
            }
            else if (activeRoute?.userTxHash) {
                // Mark all source destination actions as completed
                // when the transaction is mined
                const activeRouteRoute = currentActiveRoutes[activeRouteIndex].route;
                if (activeRouteRoute) {
                    activeRouteRoute.currentUserTxIndex = activeRouteRoute.userTxs.filter((tx) => !(0, swapAndBridge_1.isTxnBridge)(tx)).length;
                }
            }
            this.activeRoutes = currentActiveRoutes;
            this.#emitUpdateIfNeeded();
        }
    }
    removeActiveRoute(activeRouteId, shouldEmitUpdate = true) {
        this.activeRoutes = this.activeRoutes.filter((r) => r.activeRouteId !== activeRouteId);
        // Purposely not using `this.#emitUpdateIfNeeded()` here, as this should always emit to update banners
        if (shouldEmitUpdate)
            this.emitUpdate();
    }
    /**
     * Find the next route in line and try to re-estimate with it
     */
    async onEstimationFailure(activeRouteId) {
        if (!this.quote || !this.quote.selectedRoute || this.quote.selectedRoute.isSelectedManually)
            return;
        const routeId = activeRouteId ?? this.quote.selectedRoute.routeId;
        let routeIndex = null;
        this.quote.routes.forEach((route, i) => {
            if (route.routeId === routeId)
                routeIndex = i;
        });
        // this shouldn't happen; there's no reason for the activeRouteId to not be
        // present in the this.quote.routes;
        // however, just to be on the safe side if it ever were to happen, reset all
        if (routeIndex === null) {
            this.quote.selectedRoute = undefined;
            this.quote.routes = [];
            this.updateQuoteStatus = 'INITIAL';
            this.emitUpdate();
            return;
        }
        const firstEnabledRoute = this.quote.routes.find((r) => !r.disabled);
        if (!firstEnabledRoute) {
            this.updateQuoteStatus = 'INITIAL';
            this.emitUpdate();
            return;
        }
        // push the failed route to the end of the routes array
        // and select the next one
        const route = this.quote.routes[routeIndex];
        this.quote.routes.splice(routeIndex, 1);
        this.quote.routes.push(route);
        await this.selectRoute(firstEnabledRoute);
    }
    /**
     * We need this as a separate method as it's called from the UI as well
     */
    async markSelectedRouteAsFailed(disabledReason) {
        if (!this.quote || !this.quote.selectedRoute)
            return;
        this.quote.selectedRoute.disabled = true;
        this.quote.selectedRoute.disabledReason = disabledReason;
        const routeId = this.quote.selectedRoute.routeId;
        this.quote.routes.forEach((route, i) => {
            if (route.routeId === routeId) {
                this.quote.routes[i].disabled = true;
                this.quote.routes[i].disabledReason = disabledReason;
            }
        });
    }
    // update active route if needed on SubmittedAccountOp update
    handleUpdateActiveRouteOnSubmittedAccountOpStatusUpdate(op) {
        op.calls.forEach((call) => {
            this.#handleActiveRouteBroadcastedTransaction(call.id, op.status);
            this.#handleActiveRouteBroadcastedApproval(call.id, op.status);
            this.#handleActiveRoutesWithReadyApproval(call.id, op.status);
            this.#handleUpdateActiveRoutesUserTxData(call.id, op);
            this.#handleActiveRoutesCompleted(call.id, op.status);
        });
    }
    #handleActiveRouteBroadcastedTransaction(callId, opStatus) {
        if (opStatus !== types_1.AccountOpStatus.BroadcastedButNotConfirmed)
            return;
        const activeRoute = this.activeRoutes.find((r) => r.activeRouteId === callId);
        if (!activeRoute)
            return;
        // learn the additional step tokens so if the route fails alongs the way,
        // the user has the token learnt in his portfolio
        activeRoute.route?.steps.forEach((step) => {
            this.#portfolio.addTokensToBeLearned([step.toAsset.address], BigInt(step.toAsset.chainId));
        });
        this.updateActiveRoute(activeRoute.activeRouteId, { routeStatus: 'in-progress' });
    }
    #handleActiveRouteBroadcastedApproval(callId, opStatus) {
        if (opStatus !== types_1.AccountOpStatus.BroadcastedButNotConfirmed)
            return;
        const activeRoute = this.activeRoutes.find((r) => `${r.activeRouteId}-approval` === callId);
        if (!activeRoute)
            return;
        this.updateActiveRoute(activeRoute.activeRouteId, {
            routeStatus: 'waiting-approval-to-resolve'
        });
    }
    #handleActiveRoutesWithReadyApproval(callId, opStatus) {
        const activeRouteWaitingApproval = this.activeRoutes.find((r) => r.routeStatus === 'waiting-approval-to-resolve' && `${r.activeRouteId}-approval` === callId);
        if (!activeRouteWaitingApproval)
            return;
        if (opStatus === types_1.AccountOpStatus.Success) {
            this.updateActiveRoute(activeRouteWaitingApproval.activeRouteId, {
                routeStatus: 'ready'
            });
        }
        if (opStatus === types_1.AccountOpStatus.Failure || opStatus === types_1.AccountOpStatus.Rejected) {
            const errorMessage = opStatus === types_1.AccountOpStatus.Rejected
                ? 'The approval was rejected but you can try to sign it again'
                : 'The approval failed but you can try to sign it again';
            this.updateActiveRoute(activeRouteWaitingApproval.activeRouteId, {
                routeStatus: 'ready',
                error: errorMessage
            });
        }
    }
    #handleUpdateActiveRoutesUserTxData(callId, submittedAccountOp) {
        const activeRoute = this.activeRoutes.find((r) => r.activeRouteId === callId);
        if (!activeRoute)
            return;
        if (submittedAccountOp && !activeRoute.userTxHash) {
            this.updateActiveRoute(activeRoute.activeRouteId, {
                userTxHash: submittedAccountOp?.txnId,
                identifiedBy: submittedAccountOp.identifiedBy
            });
        }
    }
    #handleActiveRoutesCompleted(callId, opStatus) {
        const activeRoute = this.activeRoutes.find((r) => r.activeRouteId === callId);
        if (!activeRoute || !activeRoute.route)
            return;
        let shouldUpdateActiveRouteStatus = false;
        const isSwap = !(0, swapAndBridge_1.getIsBridgeRoute)(activeRoute.route);
        // force update the active route status if the route is of type 'swap'
        if (isSwap)
            shouldUpdateActiveRouteStatus = true;
        // force update the active route with an error message if the tx fails (for both swap and bridge)
        if (opStatus === types_1.AccountOpStatus.Failure || opStatus === types_1.AccountOpStatus.Rejected)
            shouldUpdateActiveRouteStatus = true;
        if (!shouldUpdateActiveRouteStatus)
            return;
        if (opStatus === types_1.AccountOpStatus.Success) {
            this.updateActiveRoute(activeRoute.activeRouteId, { routeStatus: 'completed' });
            return;
        }
        // If the transaction fails, update the status to "ready" to allow the user to sign it again
        if (opStatus === types_1.AccountOpStatus.Failure || opStatus === types_1.AccountOpStatus.Rejected) {
            const errorMessage = opStatus === types_1.AccountOpStatus.Rejected
                ? 'The transaction was rejected'
                : 'The transaction failed onchain';
            this.updateActiveRoute(activeRoute.activeRouteId, {
                routeStatus: 'failed',
                error: errorMessage
            });
        }
    }
    #getIsFormValidToFetchQuote() {
        return (this.fromChainId &&
            this.toChainId &&
            !!(0, formatters_1.getSafeAmountFromFieldValue)(this.fromAmount, this.fromSelectedToken?.decimals) &&
            this.fromSelectedToken &&
            this.toSelectedToken &&
            // Allow the quote fetch if the error is insufficient amount, as the user might want
            // to see the routes even if he has insufficient balance
            (this.validateFromAmount.severity === 'success' ||
                this.validateFromAmount.id === 'insufficient_amount'));
    }
    #debounceFunctionCallsOnSameTick(funcName, func) {
        if (this.#shouldDebounceFlags[funcName])
            return;
        this.#shouldDebounceFlags[funcName] = true;
        // Debounce multiple calls in the same tick and only execute one of them
        setTimeout(() => {
            this.#shouldDebounceFlags[funcName] = false;
            func();
        }, 0);
    }
    destroySignAccountOp() {
        if (!this.#signAccountOpController)
            return;
        this.#signAccountOpController.destroy();
        this.#signAccountOpController = null;
        this.hasProceeded = false;
    }
    /**
     * Guard to ensure we only proceed with data that matches the latest active quote in `this.#updateQuoteId`.
     */
    #isQuoteIdObsoleteAfterAsyncOperation(quoteIdGuard) {
        return quoteIdGuard && quoteIdGuard !== this.#updateQuoteId;
    }
    /**
     * This method might be called multiple times due to async updates (e.g., tokens, routes, etc.).
     * The `quoteIdGuard` acts as a guard to ensure we only proceed with data that matches
     * the latest active quote in `this.#updateQuoteId`.
     *
     * If the component re-renders or receives stale async events (e.g., an old estimation result),
     * this check prevents applying outdated data to the current form state.
     *
     * ⚠️ IMPORTANT: If you make changes here and they involve async operations,
     * make sure to check `isQuoteIdObsoleteAfterAsyncOperation` afterwards
     * to ensure you’re not acting on obsolete data.
     */
    async initSignAccountOpIfNeeded(quoteIdGuard) {
        // no updates if the user has committed
        if (this.formStatus === SwapAndBridgeFormStatus.Proceeded)
            return;
        // shouldn't happen ever
        if (!this.#selectedAccount.account)
            return;
        // again it shouldn't happen but there might be a case where the from token
        // disappears because of a strange update event. It's fine to just not
        // continue from the point forward
        if (!this.fromSelectedToken || !this.toSelectedToken || !this.toChainId)
            return;
        if (this.formStatus !== SwapAndBridgeFormStatus.ReadyToEstimate &&
            this.formStatus !== SwapAndBridgeFormStatus.ReadyToSubmit)
            return;
        const fromToken = this.fromSelectedToken;
        const network = this.#networks.networks.find((net) => net.chainId === fromToken.chainId);
        // shouldn't happen ever
        if (!network)
            return;
        const provider = this.#providers.providers[network.chainId.toString()];
        // shouldn't happen ever
        if (!provider)
            return;
        const accountState = await this.#accounts.getOrFetchAccountOnChainState(this.#selectedAccount.account.addr, network.chainId);
        if (!accountState) {
            this.updateQuoteStatus = 'INITIAL';
            this.addOrUpdateError({
                id: 'all-routes-failed',
                level: 'error',
                title: 'Missing mandatory account data. Please try again later.'
            });
            return;
        }
        if (this.#isQuoteIdObsoleteAfterAsyncOperation(quoteIdGuard))
            return;
        const userTxn = await this.getRouteStartUserTx();
        if (this.#isQuoteIdObsoleteAfterAsyncOperation(quoteIdGuard))
            return;
        // if no txn is provided because of a route failure (large slippage),
        // auto select the next route and continue on
        if (!userTxn || !userTxn.success) {
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            this.markSelectedRouteAsFailed(userTxn?.title || 'Invalid quote');
            if (!this.quote?.selectedRoute?.isSelectedManually) {
                // eslint-disable-next-line @typescript-eslint/no-floating-promises
                this.onEstimationFailure(undefined);
                return;
            }
            this.updateQuoteStatus = 'INITIAL';
            this.emitUpdate();
            return;
        }
        // learn the token in the portfolio
        this.#portfolio.addTokensToBeLearned([this.toSelectedToken.address], BigInt(this.toChainId));
        // check if we have an accountOp in main
        const userRequestCalls = this.#getUserRequests().find((r) => r.kind === 'calls' &&
            r.id === `${this.#selectedAccount.account.addr}-${network.chainId}`)?.signAccountOp.accountOp.calls || [];
        const swapOrBridgeCalls = await (0, swapAndBridge_1.getSwapAndBridgeCalls)(userTxn, this.#selectedAccount.account, provider, accountState);
        if (this.#isQuoteIdObsoleteAfterAsyncOperation(quoteIdGuard))
            return;
        // get the price from the portfolio;
        // if not present there, try to calculate it from the quote
        let fromTokenPriceInUsd = this.fromSelectedToken.priceIn.find((p) => p.baseCurrency === 'usd')?.price;
        if (!fromTokenPriceInUsd && this.quote?.selectedRoute?.inputValueInUsd && this.fromAmount) {
            fromTokenPriceInUsd = this.quote.selectedRoute.inputValueInUsd / Number(this.fromAmount);
        }
        const isBridge = this.quote?.selectedRoute
            ? (0, swapAndBridge_1.getIsBridgeRoute)(this.quote.selectedRoute)
            : !!this.fromChainId && !!this.toChainId && this.fromChainId !== this.toChainId;
        const calls = !isBridge ? [...userRequestCalls, ...swapOrBridgeCalls] : [...swapOrBridgeCalls];
        const native = this.#portfolio
            .getAccountPortfolioState(this.#selectedAccount.account.addr)[network.chainId.toString()]?.result?.tokens.find((token) => token.address === ethers_1.ZeroAddress);
        const nativePrice = native?.priceIn.find((price) => price.baseCurrency === 'usd')?.price;
        const baseAcc = (0, getBaseAccount_1.getBaseAccount)(this.#selectedAccount.account, accountState, network);
        const swapSponsorship = (0, swapAndBridge_1.getSwapSponsorship)({
            hasConvinienceFee: this.quote?.selectedRoute?.withConvenienceFee || false,
            nativePrice,
            fromAmountInUsd: Number(this.fromAmountInFiat),
            fromTokenPriceInUsd,
            fromTokenDecimals: this.quote?.fromAsset.decimals,
            providerId: this.quote?.selectedRoute?.providerId
        });
        if (this.#signAccountOpController) {
            // if the chain id has changed, we need to destroy the sign account op
            if (this.#signAccountOpController.accountOp.meta &&
                this.#signAccountOpController.accountOp.meta.swapTxn &&
                this.#signAccountOpController.accountOp.meta.swapTxn.chainId !== userTxn.chainId) {
                this.destroySignAccountOp();
            }
            else {
                // add the real swapTxn
                this.#signAccountOpController.update({
                    accountOpData: {
                        calls,
                        meta: {
                            ...(this.#signAccountOpController.accountOp.meta || {}),
                            swapTxn: userTxn,
                            fromQuoteId: quoteIdGuard,
                            swapSponsorship
                        }
                    }
                });
                return;
            }
        }
        const accountOp = {
            id: (0, uuid_1.generateUuid)(),
            accountAddr: this.#selectedAccount.account.addr,
            chainId: network.chainId,
            signingKeyAddr: null,
            signingKeyType: null,
            gasLimit: null,
            gasFeePayment: null,
            nonce: accountState.nonce,
            signature: null,
            calls,
            flags: {
                hideActivityBanner: this.fromSelectedToken.chainId !== BigInt(this.toSelectedToken.chainId)
            },
            meta: {
                swapTxn: userTxn,
                paymasterService: (0, erc7677_1.getAmbirePaymasterService)(baseAcc, this.#relayerUrl),
                fromQuoteId: quoteIdGuard,
                swapSponsorship
            }
        };
        this.#signAccountOpController = new signAccountOp_1.SignAccountOpController({
            type: 'one-click-swap-and-bridge',
            callRelayer: this.#callRelayer,
            accounts: this.#accounts,
            networks: this.#networks,
            keystore: this.#keystore,
            portfolio: this.#portfolio,
            externalSignerControllers: this.#externalSignerControllers,
            activity: this.#activity,
            account: this.#selectedAccount.account,
            network,
            provider,
            phishing: this.#phishing,
            dapps: this.#dapps,
            fromRequestId: (0, utils_1.randomId)(), // the account op and the request are fabricated,
            accountOp,
            shouldSimulate: false,
            onBroadcastSuccess: async (props) => {
                this.#portfolio
                    .simulateAccountOp(props.accountOp)
                    .then(() => {
                    this.#portfolio.markSimulationAsBroadcasted(accountOp.accountAddr, accountOp.chainId);
                })
                    .catch((e) => {
                    this.emitError({
                        level: 'silent',
                        message: 'swap&bridge simulation failed',
                        error: e
                    });
                });
                await this.#onBroadcastSuccess(props);
            },
            onBroadcastFailed: this.#onBroadcastFailed
        });
        this.emitUpdate();
        this.#signAccountOpController.onUpdate((forceEmit) => {
            this.propagateUpdate(forceEmit);
            if (this.#signAccountOpController?.broadcastStatus === 'SUCCESS') {
                // Reset the form on the next tick so the FE receives the final
                // signAccountOpController update before resetForm destroys it
                setTimeout(() => {
                    this.resetForm();
                }, 0);
            }
        }, 'swap-and-bridge');
        this.#signAccountOpController.onError(async (error) => {
            // Need to clean the pending results for THIS signAccountOpController
            // specifically. NOT the one from the getter (this.signAccountOpController)
            // that is ALWAYS up-to-date with the current quote and the current form state.
            // Due to the async nature, it might not exist - an issue caught by our crash reporting.
            this.emitError(error);
            if (this.#signAccountOpController)
                await this.#portfolio.overrideSimulationResults(this.#signAccountOpController.accountOp);
        });
        // if the estimation emits an error, handle it
        this.#signAccountOpController.estimation.onUpdate(() => {
            if (this.#signAccountOpController?.accountOp.meta?.swapTxn?.activeRouteId &&
                this.#signAccountOpController.estimation.status === types_2.EstimationStatus.Error) {
                // eslint-disable-next-line @typescript-eslint/no-floating-promises
                this.markSelectedRouteAsFailed(this.#signAccountOpController.estimation.error?.message || 'Invalid quote');
                // eslint-disable-next-line @typescript-eslint/no-floating-promises
                this.onEstimationFailure(this.#signAccountOpController.accountOp.meta.swapTxn.activeRouteId);
            }
        });
    }
    async callSignAccountOpMethod(method, args) {
        if (!this.signAccountOpController)
            return;
        await this.signAccountOpController[method](...args);
    }
    setUserProceeded(hasProceeded) {
        this.hasProceeded = hasProceeded;
        this.emitUpdate();
    }
    get swapSignErrors() {
        const errors = [];
        const isBridge = this.quote?.selectedRoute
            ? (0, swapAndBridge_1.getIsBridgeRoute)(this.quote.selectedRoute)
            : !!this.fromChainId && !!this.toChainId && this.fromChainId !== this.toChainId;
        const fromSelectedTokenWithUpToDateAmount = this.#getFromSelectedTokenInPortfolio();
        if (isBridge &&
            fromSelectedTokenWithUpToDateAmount &&
            fromSelectedTokenWithUpToDateAmount.amountPostSimulation &&
            fromSelectedTokenWithUpToDateAmount.amount !==
                fromSelectedTokenWithUpToDateAmount.amountPostSimulation) {
            errors.push({
                title: `${fromSelectedTokenWithUpToDateAmount.symbol} detected in batch. Please complete the batch before bridging`
            });
        }
        // Check if there are any errors from the main SignAccountOp controller
        // This prevents proceeding with a swap/bridge if there are estimation errors
        // in the pending batch of transactions
        if (this.#isCurrentSignAccountOpThrowingAnEstimationError &&
            this.#isCurrentSignAccountOpThrowingAnEstimationError(this.fromChainId, this.toChainId)) {
            errors.push({
                title: 'Error detected in the pending batch. Please review it before proceeding'
            });
        }
        return errors;
    }
    get banners() {
        if (!this.#selectedAccount.account)
            return [];
        const activeRoutesForSelectedAccount = (0, swapAndBridge_1.getActiveRoutesForAccount)(this.#selectedAccount.account.addr, this.activeRoutes);
        const callsUserRequests = this.#getVisibleUserRequests().filter(({ kind }) => kind === 'calls');
        // Swap banners aren't generated because swaps are completed instantly,
        // thus the activity banner on broadcast is sufficient
        return (0, banners_1.getBridgeBanners)(activeRoutesForSelectedAccount, callsUserRequests);
    }
    get #shouldAutoUpdateQuote() {
        return (this.#isOnSwapAndBridgeRoute &&
            this.formStatus === SwapAndBridgeFormStatus.ReadyToSubmit &&
            !this.hasProceeded &&
            this.quote &&
            !this.quote.selectedRoute?.disabled &&
            !this.quote.selectedRoute?.isSelectedManually);
    }
    async continuouslyUpdateQuote() {
        if (!this.#shouldAutoUpdateQuote) {
            this.updateQuoteInterval.stop();
            return;
        }
        await this.updateQuote({
            skipPreviousQuoteRemoval: true,
            skipQuoteUpdateOnSameValues: false,
            skipStatusUpdate: false
        });
    }
    #getActiveRoutesInProgressSessionId() {
        if (!this.activeRoutesInProgress.length)
            return undefined;
        return this.activeRoutesInProgress
            .map((r) => r.activeRouteId)
            .sort()
            .join('|');
    }
    async continuouslyUpdateActiveRoutes() {
        if (this.#continuouslyUpdateActiveRoutesPromise &&
            this.#continuouslyUpdateActiveRoutesSessionId === this.#getActiveRoutesInProgressSessionId()) {
            await this.#continuouslyUpdateActiveRoutesPromise;
            return;
        }
        this.#continuouslyUpdateActiveRoutesPromise = this.#continuouslyUpdateActiveRoutes().finally(() => {
            this.#continuouslyUpdateActiveRoutesPromise = undefined;
        });
        await this.#continuouslyUpdateActiveRoutesPromise;
    }
    async #continuouslyUpdateActiveRoutes() {
        this.#continuouslyUpdateActiveRoutesSessionId = this.#getActiveRoutesInProgressSessionId();
        if (!this.activeRoutesInProgress.length) {
            this.#updateActiveRoutesInterval.stop();
            return;
        }
        await this.checkForActiveRoutesStatusUpdate();
        if (!this.activeRoutesInProgress.length) {
            this.#updateActiveRoutesInterval.stop();
            return;
        }
        // coming here means the bridge should complete any second now
        // so start with BRIDGE_STATUS_INTERVAL
        // upon status pending, increase by BRIDGE_STATUS_INTERVAL until the ceiling is hit
        const ceiling = 60000;
        const minServiceTime = (0, swapAndBridge_1.getActiveRoutesLowestServiceTime)(this.activeRoutesInProgress);
        const startTimeout = minServiceTime === this.#updateActiveRoutesInterval.currentTimeout
            ? intervals_1.BRIDGE_STATUS_INTERVAL
            : this.#updateActiveRoutesInterval.currentTimeout + intervals_1.BRIDGE_STATUS_INTERVAL;
        this.#updateActiveRoutesInterval.updateTimeout({
            timeout: startTimeout < ceiling ? startTimeout : ceiling
        });
    }
    /**
     * Unbrick mechanism.
     * Use this only when you are sure there's no way to continue, or
     * a promise waiting to resolve that might change the state
     */
    cancelSignReq() {
        this.signAccountOpController?.cancelSignReq();
    }
    toJSON() {
        return {
            ...this,
            ...super.toJSON(),
            toTokenShortList: this.toTokenShortList,
            updateToTokenListStatus: this.updateToTokenListStatus,
            maxFromAmount: this.maxFromAmount,
            validateFromAmount: this.validateFromAmount,
            isFormEmpty: this.isFormEmpty,
            formStatus: this.formStatus,
            activeRoutesInProgress: this.activeRoutesInProgress,
            activeRoutes: this.activeRoutes,
            isHealthy: this.isHealthy,
            shouldEnableRoutesSelection: this.shouldEnableRoutesSelection,
            supportedChainIds: this.supportedChainIds,
            swapSignErrors: this.swapSignErrors,
            signAccountOpController: this.signAccountOpController,
            banners: this.banners
        };
    }
}
exports.SwapAndBridgeController = SwapAndBridgeController;
//# sourceMappingURL=swapAndBridge.js.map