"use strict";
// @ts-nocheck
Object.defineProperty(exports, "__esModule", { value: true });
exports.SwapAndBridgeController = exports.sortSwapAndBridgeRoutes = void 0;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const networks_1 = require("../../libs/networks/networks");
const constants_1 = require("../../libs/swapAndBridge/constants");
const fee_1 = require("../../libs/swapAndBridge/fee");
const EmittableError_1 = tslib_1.__importDefault(require("../../classes/EmittableError"));
const recurringTimeout_1 = require("../../classes/recurringTimeout/recurringTimeout");
const SwapAndBridgeError_1 = tslib_1.__importDefault(require("../../classes/SwapAndBridgeError"));
const addresses_1 = require("../../consts/addresses");
const intervals_1 = require("../../consts/intervals");
const swapAndBridge_1 = require("../../consts/swapAndBridge");
const ui_1 = require("../../interfaces/ui");
const getBaseAccount_1 = require("../../libs/account/getBaseAccount");
const types_1 = require("../../libs/accountOp/types");
const banners_1 = require("../../libs/banners/banners");
const erc7677_1 = require("../../libs/erc7677/erc7677");
const utils_1 = require("../../libs/humanizer/utils");
const helpers_1 = require("../../libs/portfolio/helpers");
const portfolio_1 = require("../../libs/portfolio/portfolio");
const swapAndBridge_2 = require("../../libs/swapAndBridge/swapAndBridge");
const swapAndBridgeErrorHumanizer_1 = require("../../libs/swapAndBridge/swapAndBridgeErrorHumanizer");
const tokenMarketData_1 = require("../../libs/swapAndBridge/tokenMarketData");
const amount_1 = require("../../libs/transfer/amount");
const constants_2 = require("../../services/socket/constants");
const validate_1 = require("../../services/validations/validate");
const batcher_1 = tslib_1.__importDefault(require("../../utils/batcher"));
const formatters_1 = require("../../utils/numbers/formatters");
const uuid_1 = require("../../utils/uuid");
const wait_1 = tslib_1.__importDefault(require("../../utils/wait"));
const with_timeout_1 = require("../../utils/with-timeout");
const types_2 = require("../estimation/types");
const eventEmitter_1 = tslib_1.__importDefault(require("../eventEmitter/eventEmitter"));
const signAccountOp_1 = require("../signAccountOp/signAccountOp");
const isSwapAndBridge = (route) => route === 'swap-and-bridge';
const COW_SWAP_PROVIDER_ID = 'cowswap';
const STATUS_WRAPPED_METHODS = {
    addToTokenByAddress: 'INITIAL'
};
const sortSwapAndBridgeRoutes = (r1, r2, outputTokenPriceUSD) => {
    const isBridge = r1.fromChainId !== r1.toChainId;
    // the amount threshold in %. If below, we check the time as
    // the deciding sort factor
    const threshold = swapAndBridge_1.ROUTE_SORT_AMOUNT_THRESHOLD_PERCENT;
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
        // Normalize the output with the shared token price for sorting, while preserving
        // each provider's reported gas-cost difference. This keeps the comparison fair
        // without changing the provider USD values displayed in the UI.
        // Uniswap is very gas-efficient even when its rate is slightly worse. A slightly
        // worse rate can still be preferable to paying a much larger transaction fee,
        // which is why routes are sorted by their output value after gas.
        const aOutputValues = (0, swapAndBridge_2.getRouteOutputValuesForSorting)(r1, outputTokenPriceUSD);
        const bOutputValues = (0, swapAndBridge_2.getRouteOutputValuesForSorting)(r2, outputTokenPriceUSD);
        const aOutputValueAfterGasInUsd = aOutputValues.outputValueAfterGasInUsd;
        const bOutputValueAfterGasInUsd = bOutputValues.outputValueAfterGasInUsd;
        if (aOutputValueAfterGasInUsd !== undefined &&
            bOutputValueAfterGasInUsd !== undefined &&
            Number.isFinite(aOutputValueAfterGasInUsd) &&
            Number.isFinite(bOutputValueAfterGasInUsd)) {
            if (aOutputValueAfterGasInUsd === bOutputValueAfterGasInUsd) {
                if (!isBridge)
                    return 0;
                return sortByTime();
            }
            const higherOutputValueAfterGasInUsd = Math.max(aOutputValueAfterGasInUsd, bOutputValueAfterGasInUsd);
            const lowerOutputValueAfterGasInUsd = Math.min(aOutputValueAfterGasInUsd, bOutputValueAfterGasInUsd);
            const outputComparison = aOutputValueAfterGasInUsd > bOutputValueAfterGasInUsd ? -1 : 1;
            // if it's not a bridge, just return the higher output route
            if (!isBridge || higherOutputValueAfterGasInUsd <= 0)
                return outputComparison;
            const percentage = ((higherOutputValueAfterGasInUsd - lowerOutputValueAfterGasInUsd) /
                higherOutputValueAfterGasInUsd) *
                100;
            if (percentage < threshold)
                return sortByTime();
            return outputComparison;
        }
        const a = BigInt(r1.toAmount);
        const b = BigInt(r2.toAmount);
        // if value is the same, check time if bridge
        if (a === b) {
            if (!isBridge)
                return 0;
            return sortByTime();
        }
        const aUsd = Number(aOutputValues.outputValueInUsd ?? 0);
        const bUsd = Number(bOutputValues.outputValueInUsd ?? 0);
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
};
exports.sortSwapAndBridgeRoutes = sortSwapAndBridgeRoutes;
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
    #signAccountOpPreference;
    #featureFlags;
    #platform;
    #serviceProviderAPI;
    #activeRoutes = [];
    statuses = STATUS_WRAPPED_METHODS;
    updateQuoteStatus = 'INITIAL';
    #updateQuoteId;
    #swapProviderSettingsUpdateId = 0;
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
    feePercent = (0, fee_1.getFeePercent)();
    quoteRoutesStatuses = {};
    portfolioTokenList = [];
    isTokenListLoading = false;
    errors = [];
    #toTokenList = {};
    /**
     * Market data (24h price movement and exchanges) for the "to" tokens, fetched on demand.
     * Kept private for the same reason as `#toTokenList` - it holds far more tokens than the
     * UI ever renders and the whole public state is serialized on every update. Only the
     * records of the currently visible tokens are exposed, through `toTokenMarketData`.
     * Addresses are lowercased.
     */
    #toTokenMarketData = {};
    #batchedTokenMarketData;
    /**
     * Similar to the `#toTokenList[key].apiTokens`, this helps in avoiding repeated API
     * calls to fetch the supported chains from our service provider.
     */
    #cachedSupportedChains = { lastFetched: 0, data: [] };
    /** A "to" token to select once a provider returns it, e.g. a preselected one. */
    #requestedToToken = null;
    /**
     * Lowercased fields the "to" token search matches against, cached per token so that a
     * keystroke does not lowercase the service provider's whole list again. Keyed weakly,
     * so entries are reclaimed with the token list and a token added later simply misses
     * the cache instead of being matched against stale fields.
     */
    #toTokenSearchFields = new WeakMap();
    routePriority = 'output';
    disabledSwapProviderIds = [];
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
    #erc7730;
    #contractInfo;
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
    /**
     * Identifies the txns of a swap that went out before the rest of it failed, e.g. the
     * approval was sent but the swap was rejected on the hardware wallet. Once they are
     * confirmed, the quote is refreshed so the swap is built again from the onchain state
     * (e.g. without the approval). The form isn't blocked meanwhile, as they can get stuck
     */
    #sentSwapPartIdentifier = null;
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
    constructor({ eventEmitterRegistry, callRelayer, fetch, accounts, keystore, portfolio, externalSignerControllers, providers, selectedAccount, networks, activity, storage, signAccountOpPreference, featureFlags, platform, phishing, dapps, erc7730, contractInfo, portfolioUpdate, relayerUrl, isCurrentSignAccountOpThrowingAnEstimationError, getUserRequests, getVisibleUserRequests, swapProvider, onBroadcastSuccess, onBroadcastFailed, ui }) {
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
        this.#signAccountOpPreference = signAccountOpPreference;
        this.#featureFlags = featureFlags;
        this.#platform = platform;
        this.#phishing = phishing;
        this.#dapps = dapps;
        this.#erc7730 = erc7730;
        this.#contractInfo = contractInfo;
        this.#relayerUrl = relayerUrl;
        this.#getUserRequests = getUserRequests;
        this.#getVisibleUserRequests = getVisibleUserRequests;
        this.#onBroadcastSuccess = onBroadcastSuccess;
        this.#onBroadcastFailed = onBroadcastFailed;
        this.#ui = ui;
        this.#batchedTokenMarketData = (0, batcher_1.default)(fetch, tokenMarketData_1.marketDataRequestBatcher, {
            // Groups the tokens requested for the same list into as few requests as possible
            batchDebounce: 100,
            dedupeByKeys: ['chainId', 'address'],
            timeoutSettings: {
                timeoutAfter: 5000,
                timeoutErrorMessage: 'Token market data request timed out'
            }
        });
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
            // A closing panel destroys its screens without unmounting them, so the session has to be
            // unloaded here for the form to start fresh next time.
            if ((0, ui_1.isSidePanelView)(view))
                this.unloadScreen(view.type, true);
        });
    }
    #emitUpdateIfNeeded(forceUpdate = false) {
        const shouldSkipUpdate = 
        // No need to emit emit updates if there are no active sessions
        !this.sessionIds.length &&
            // but ALSO there are no active routes (otherwise, banners need the updates)
            !this.activeRoutes.length &&
            // Force update is needed when UI-visible state changes outside an active form session
            !forceUpdate;
        if (shouldSkipUpdate)
            return;
        super.emitUpdate();
    }
    #updateFeePercent(portfolioTokens) {
        const selectedAccountAddress = this.#selectedAccount.account?.addr;
        if (!selectedAccountAddress) {
            this.feePercent = (0, fee_1.getFeePercent)();
            return;
        }
        const selectedAccountMainnetTokens = this.#portfolio.getAccountPortfolioState(selectedAccountAddress)['1']?.result?.tokens;
        const stkWalletToken = (portfolioTokens ?? selectedAccountMainnetTokens)?.find(({ address, chainId }) => chainId === 1n && address.toLowerCase() === addresses_1.STK_WALLET.toLowerCase());
        this.feePercent = (0, fee_1.getFeePercentForStkWalletToken)(stkWalletToken);
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
        const tokenPrice = this.fromSelectedToken?.priceIn.find((p) => p.baseCurrency === swapAndBridge_1.HARD_CODED_CURRENCY)?.price;
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
            this.fromAmount = (0, ethers_1.formatUnits)((amountInFiatBigInt * swapAndBridge_1.CONVERSION_PRECISION_POW) / tokenPriceBigInt, 
            // Shift the decimal point by the number of decimals in the token price
            amountInFiatDecimals + swapAndBridge_1.CONVERSION_PRECISION - tokenPriceDecimals);
            return;
        }
        if (this.fromAmountFieldMode === 'token') {
            this.fromAmount = fromAmount;
            if (!this.fromSelectedToken)
                return;
            // Convert the field value to big int
            const formattedAmount = (0, ethers_1.parseUnits)((0, formatters_1.getSafeAmountFromFieldValue)(fromAmount, this.fromSelectedToken.decimals), this.fromSelectedToken.decimals);
            const { tokenPriceBigInt, tokenPriceDecimals } = (0, formatters_1.convertTokenPriceToBigInt)(tokenPrice);
            // There is absolutely 0 reason to display the same amount of decimals for the usd
            // amount as it's only used for display and validation purposes and the amount being sent is
            // the token amount. So we truncate the amount to a reasonable number that can be displayed nicely.
            this.fromAmountInFiat = (0, formatters_1.truncateFiatAmountDecimals)((0, ethers_1.formatUnits)(formattedAmount * tokenPriceBigInt, 
            // Shift the decimal point by the number of decimals in the token price
            this.fromSelectedToken.decimals + tokenPriceDecimals));
        }
    }
    async #load() {
        await this.#networks.initialLoadPromise;
        await this.#selectedAccount.initialLoadPromise;
        try {
            const storedDisabledProviderIds = await this.#storage.get('disabledSwapProviderIds', []);
            const availableProviderIds = new Set(this.swapProviders.map(({ id }) => id));
            this.disabledSwapProviderIds = [
                ...new Set(storedDisabledProviderIds.filter((id) => typeof id === 'string' && availableProviderIds.has(id)))
            ];
        }
        catch (error) {
            const loadError = error instanceof Error ? error : new Error('Unable to load swap provider preferences');
            this.emitError({
                error: loadError,
                level: 'silent',
                message: 'Unable to load saved swap provider preferences.'
            });
        }
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
                    // To token list includes selected account portfolio tokens, it should get an update too.
                    // Deriving it sorts the service provider's whole list and emits twice, so it is only
                    // redone when the portfolio tokens it actually reads have changed - or when its cached
                    // copy of the provider's list is due for a refetch. Without this, every portfolio
                    // refresh rebuilt an identical list and took the JS thread away from the screen.
                    if (this.#isToTokenApiListStale() ||
                        this.#getToTokenPortfolioSignature() !== this.#currentToTokenList?.portfolioSignature) {
                        await this.updateToTokenList(false);
                    }
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
        (0, swapAndBridge_2.getIsTokenEligibleForSwapAndBridge)(t, false));
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
        const tokenPrice = tokenRef?.priceIn.find((p) => p.baseCurrency === swapAndBridge_1.HARD_CODED_CURRENCY)?.price;
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
    /**
     * Whether the swap is being signed or broadcast right now, e.g. waiting for a hardware wallet.
     * Reads the private controller on purpose, as the public getter may return null for it.
     */
    get isSignAndBroadcastInProgress() {
        return !!this.#signAccountOpController?.isSignAndBroadcastInProgress;
    }
    get formStatus() {
        // The swap being signed keeps the form locked even if hasProceeded got reset, e.g. when
        // the popup is replaced by a request window. Otherwise the quote refreshes under the
        // signed transaction and its route can no longer be tracked
        if (this.hasProceeded || this.isSignAndBroadcastInProgress)
            return constants_1.SwapAndBridgeFormStatus.Proceeded;
        if (this.isFormEmpty)
            return constants_1.SwapAndBridgeFormStatus.Empty;
        if (this.validateFromAmount.message || this.swapSignErrors.length)
            return constants_1.SwapAndBridgeFormStatus.Invalid;
        if (this.updateQuoteStatus === 'LOADING')
            return constants_1.SwapAndBridgeFormStatus.FetchingRoutes;
        if (!this.quote || !this.quote.routes.length)
            return constants_1.SwapAndBridgeFormStatus.NoRoutesFound;
        if (this.quote?.selectedRoute?.disabled)
            return constants_1.SwapAndBridgeFormStatus.InvalidRouteSelected;
        if (!this.signAccountOpController ||
            this.signAccountOpController.estimation.status !== types_2.EstimationStatus.Success)
            return constants_1.SwapAndBridgeFormStatus.ReadyToEstimate;
        return constants_1.SwapAndBridgeFormStatus.ReadyToSubmit;
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
        const minServiceTime = (0, swapAndBridge_2.getActiveRoutesLowestServiceTime)(this.activeRoutesInProgress);
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
    /** Why the currently selected operation is exempt from the Swap & Bridge fee. */
    get feeExemptionReason() {
        if (this.quote?.selectedRoute?.feeExemptionReason) {
            return this.quote.selectedRoute.feeExemptionReason;
        }
        const fromSelectedToken = this.fromSelectedToken;
        return (0, fee_1.getFeeExemptionReason)({
            isWrapOrUnwrap: this.#getIsWrapOrUnwrap(),
            isFeeExemptToken: !!fromSelectedToken &&
                (0, swapAndBridge_2.isNoFeeToken)(Number(fromSelectedToken.chainId), fromSelectedToken.address)
        });
    }
    async initForm(sessionId, params) {
        const { preselectedFromToken, preselectedToToken, fromAmount, activeRouteIdToDelete } = params || {};
        await this.#initialLoadPromise;
        // if the provider is socket, convert the null addresses
        if (preselectedFromToken) {
            this.#emitSilentErrorIfNullAddress(preselectedFromToken.address);
            preselectedFromToken.address = (0, swapAndBridge_2.mapBannedToValidAddr)(Number(preselectedFromToken.chainId), (0, swapAndBridge_2.convertNullAddressToZeroAddressIfNeeded)(preselectedFromToken.address));
        }
        if (preselectedToToken) {
            this.#emitSilentErrorIfNullAddress(preselectedToToken.address);
            preselectedToToken.address = (0, swapAndBridge_2.mapBannedToValidAddr)(Number(preselectedToToken.chainId), (0, swapAndBridge_2.convertNullAddressToZeroAddressIfNeeded)(preselectedToToken.address));
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
            await this.removeFailedRouteAndHideBanner(activeRouteIdToDelete);
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
        if (address.toLocaleLowerCase() === constants_2.NULL_ADDRESS) {
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
    /** Returns serializable metadata for all available swap providers. */
    get swapProviders() {
        return this.#serviceProviderAPI.getProvidersInfo();
    }
    get #areAllSwapProvidersDisabled() {
        const swapProviders = this.swapProviders;
        return (swapProviders.length > 0 &&
            swapProviders.every(({ id }) => this.disabledSwapProviderIds.includes(id)));
    }
    /** Returns a copy of the provider ids the user has switched off. */
    getDisabledSwapProviderIds() {
        return [...this.disabledSwapProviderIds];
    }
    /** Enables or disables a provider for future route and supported-chain discovery. */
    async setSwapProviderEnabled(providerId, isEnabled) {
        if (!this.swapProviders.some(({ id }) => id === providerId))
            return;
        const isDisabled = this.disabledSwapProviderIds.includes(providerId);
        if (isEnabled === !isDisabled)
            return;
        await this.#setDisabledSwapProviderIds(isEnabled
            ? this.disabledSwapProviderIds.filter((id) => id !== providerId)
            : [...this.disabledSwapProviderIds, providerId]);
    }
    /** Restricts routes to CoW Swap or restores all available swap providers. */
    async setMevProtectionEnabled(isEnabled) {
        if (!this.swapProviders.some(({ id }) => id === COW_SWAP_PROVIDER_ID))
            return;
        const disabledSwapProviderIds = isEnabled
            ? this.swapProviders.filter(({ id }) => id !== COW_SWAP_PROVIDER_ID).map(({ id }) => id)
            : [];
        await this.#setDisabledSwapProviderIds(disabledSwapProviderIds);
    }
    /**
     * Replaces the providers the user has switched off (used by app data sync). Ids of
     * providers this product does not offer are dropped.
     */
    async setDisabledSwapProviderIds(disabledSwapProviderIds) {
        const availableProviderIds = new Set(this.swapProviders.map(({ id }) => id));
        await this.#setDisabledSwapProviderIds([...new Set(disabledSwapProviderIds)].filter((id) => availableProviderIds.has(id)));
    }
    async #setDisabledSwapProviderIds(disabledSwapProviderIds) {
        const hasSameDisabledProviders = disabledSwapProviderIds.length === this.disabledSwapProviderIds.length &&
            disabledSwapProviderIds.every((id) => this.disabledSwapProviderIds.includes(id));
        if (hasSameDisabledProviders)
            return;
        this.disabledSwapProviderIds = disabledSwapProviderIds;
        const providerSettingsUpdateId = ++this.#swapProviderSettingsUpdateId;
        if (this.#areAllSwapProvidersDisabled) {
            this.removeError('to-token-list-fetch-failed', false);
        }
        this.#cachedSupportedChains = { lastFetched: 0, data: [] };
        this.#toTokenList = {};
        this.#updateQuoteId = undefined;
        this.quote = null;
        this.quoteRoutesStatuses = {};
        this.#emitUpdateIfNeeded(true);
        try {
            await this.#storage.set('disabledSwapProviderIds', this.disabledSwapProviderIds);
        }
        catch (error) {
            const saveError = error instanceof Error ? error : new Error('Unable to save swap provider preferences');
            this.emitError({
                error: saveError,
                level: 'silent',
                message: 'Unable to save swap provider preferences.'
            });
        }
        if (providerSettingsUpdateId !== this.#swapProviderSettingsUpdateId)
            return;
        try {
            await Promise.all([
                this.#fetchSupportedChainsIfNeeded(),
                this.updateToTokenList(false),
                this.updateQuote({ skipQuoteUpdateOnSameValues: false })
            ]);
        }
        catch (error) {
            if (providerSettingsUpdateId !== this.#swapProviderSettingsUpdateId)
                return;
            const refreshError = error instanceof Error ? error : new Error('Unable to refresh Swap & Bridge');
            this.emitError({
                error: refreshError,
                level: 'silent',
                message: 'Unable to refresh Swap & Bridge after updating provider preferences.'
            });
        }
    }
    #fetchSupportedChainsIfNeeded = async (forceUpdate) => {
        const shouldNotReFetchSupportedChains = this.#cachedSupportedChains.data.length &&
            Date.now() - this.#cachedSupportedChains.lastFetched < swapAndBridge_1.SUPPORTED_CHAINS_CACHE_THRESHOLD;
        if (shouldNotReFetchSupportedChains)
            return;
        const providerSettingsUpdateId = this.#swapProviderSettingsUpdateId;
        try {
            const supportedChains = await this.#serviceProviderAPI.getSupportedChains();
            if (providerSettingsUpdateId !== this.#swapProviderSettingsUpdateId)
                return;
            this.#cachedSupportedChains = { lastFetched: Date.now(), data: supportedChains };
            this.#emitUpdateIfNeeded(forceUpdate);
        }
        catch (error) {
            if (providerSettingsUpdateId !== this.#swapProviderSettingsUpdateId)
                return;
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
    /** The "to" token list of the selected networks, or undefined before it is first requested. */
    get #currentToTokenList() {
        const toTokenListKey = this.#toTokenListKey;
        return toTokenListKey ? this.#toTokenList[toTokenListKey] : undefined;
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
        const { fromAmount, fromAmountInFiat, fromAmountFieldMode, toChainId, shouldSetMaxAmount, routePriority, activeRouteIdToDelete } = props;
        const fromSelectedToken = props.fromSelectedToken;
        if (fromSelectedToken) {
            this.#emitSilentErrorIfNullAddress(fromSelectedToken.address);
            // if the provider is socket, convert the null addresses
            fromSelectedToken.address = (0, swapAndBridge_2.convertNullAddressToZeroAddressIfNeeded)(fromSelectedToken.address);
        }
        const { emitUpdate = true, updateQuote = true, shouldIncrementFromAmountUpdateCounter = false, isToSelectionByUser = false } = updateProps || {};
        if (isToSelectionByUser)
            this.#requestedToToken = null;
        const chainId = toChainId ?? this.toChainId;
        let toSelectedTokenAddr;
        if (props.toSelectedTokenAddr && chainId) {
            this.#emitSilentErrorIfNullAddress(props.toSelectedTokenAddr);
            // if the provider is socket, convert the null addresses
            toSelectedTokenAddr = (0, swapAndBridge_2.convertNullAddressToZeroAddressIfNeeded)(props.toSelectedTokenAddr);
        }
        // when we init the form by using the retry button
        const shouldNotResetFromAmount = fromAmount && props.toSelectedTokenAddr && fromSelectedToken && toChainId;
        let shouldUpdateToTokenList = false;
        let isToNetworkChanged = false;
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
                // This branch is invoked when the from token is changed, but also when the form is initialized.
                // We want to persist the fromAmountFieldMode across sessions, but reset it when the user changes
                // the token and has entered a value.
                if (this.fromAmount !== '')
                    this.fromAmountFieldMode = 'token';
                this.#setFromAmountAndNotifyUI('');
                this.#setFromAmountInFiatAndNotifyUI('');
            }
            // Always update to reflect portfolio amount (or other props) changes
            this.fromSelectedToken = fromSelectedToken;
        }
        if (toChainId) {
            if (this.toChainId !== Number(toChainId)) {
                this.toChainId = Number(toChainId);
                isToNetworkChanged = true;
                shouldUpdateToTokenList = true;
            }
        }
        // A "to" token still loading stays on its network after a "from" network change,
        // so it is requested again in the new list
        const pendingToTokenAddr = isToNetworkChanged ? undefined : this.#requestedToToken?.address;
        const toTokensKey = this.#toTokenListKey;
        const toTokenList = toTokensKey ? this.#toTokenList[toTokensKey] : undefined;
        // Addresses passed from outside Swap & Bridge (e.g. a trending token, which comes lowercased
        // from CoinGecko) may be in a different case than the service provider's, so compare lowercased.
        const nextToToken = toTokenList
            ? toTokenList.tokens.find((t) => t.address.toLowerCase() === toSelectedTokenAddr?.toLowerCase())
            : null;
        if (nextToToken)
            this.toSelectedToken = { ...nextToToken };
        // The requested token isn't in the (possibly not yet fetched) list. Let updateToTokenList
        // select it once the list is there, instead of dropping the request silently.
        const shouldSelectToTokenFromList = !nextToToken && !!toSelectedTokenAddr;
        if (routePriority) {
            this.routePriority = routePriority;
            if (this.quote) {
                this.quote = null;
                this.quoteRoutesStatuses = {};
            }
        }
        if (activeRouteIdToDelete) {
            await this.removeFailedRouteAndHideBanner(activeRouteIdToDelete);
        }
        if (emitUpdate)
            this.#emitUpdateIfNeeded();
        await Promise.all([
            shouldUpdateToTokenList || shouldSelectToTokenFromList
                ? // we put toSelectedTokenAddr so that "retry" btn functionality works
                    // Only a "to" network change makes the selected "to" token invalid
                    this.updateToTokenList(isToNetworkChanged, nextToToken?.address || toSelectedTokenAddr || pendingToTokenAddr)
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
        this.toSelectedToken = null;
        this.#requestedToToken = null;
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
        const toTokenList = this.#currentToTokenList;
        this.resetForm();
        this.portfolioTokenList = [];
        if (toTokenList) {
            toTokenList.tokens = [];
            // The derived list is gone, so the signature no longer describes one - forget it,
            // or the next portfolio update with the same tokens would skip rebuilding it.
            toTokenList.portfolioSignature = '';
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
        this.#updateFeePercent(nextPortfolioTokenList);
        // If the user has switched TOKEN -> NULL that would make the fromSelectedToken
        // null, so we need to keep it null, even if the portfolio token list is updated
        // until the user manually selects a new token
        const isSelectedTokenFalsyBeforeListUpdate = !this.fromSelectedToken && !!this.toSelectedToken;
        const { preselectedToken, preselectedToToken, fromAmount } = params || {};
        // When price fetching is disabled or the endpoint is down, tokens come back without
        // a USD price. We must not exclude them as "priceless" in that case, otherwise
        // switching to an account with such tokens would wrongly hide them. Skip the price
        // requirement entirely when disabled and for chains with a current price fetch error.
        const chainIdsWithPriceError = new Set();
        const priceError = this.#selectedAccount.balanceAffectingErrors.find((error) => error.id === portfolio_1.PORTFOLIO_LIB_ERROR_NAMES.PriceFetchError);
        priceError?.networkNames.forEach((networkName) => {
            const network = this.#networks.networks.find((n) => n.name === networkName);
            if (network)
                chainIdsWithPriceError.add(network.chainId.toString());
        });
        const areTokenPricesEnabled = this.#featureFlags.isFeatureEnabled('tokenPrices');
        const tokens = nextPortfolioTokenList
            .filter((token) => 
        // Filtering out hidden tokens here means: 1) They won't be displayed in
        // the "From" token list (`this.portfolioTokenList`) and 2) They won't be
        // added to the "Receive" token list as additional tokens from portfolio,
        // BUT 3) They will appear in the "Receive" if they are present in service
        // provider's to token list. This is the desired behavior.
        (0, swapAndBridge_2.getIsTokenEligibleForSwapAndBridge)(token, true, areTokenPricesEnabled && !chainIdsWithPriceError.has(token.chainId.toString())) && !token.flags.isHidden)
            .map((token) => ({
            ...token,
            address: (0, swapAndBridge_2.mapBannedToValidAddr)(Number(token.chainId), token.address)
        }));
        this.portfolioTokenList = (0, swapAndBridge_2.sortPortfolioTokenList)(tokens);
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
                // Keep the network of a selected "to" token, or of one still loading
                toChainId: preselectedToToken?.chainId ??
                    (this.toSelectedToken || this.isToTokenSelectionPending
                        ? undefined
                        : nextFromSelectedToken?.chainId),
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
        const providerSettingsUpdateId = this.#swapProviderSettingsUpdateId;
        if (!toTokenListKeyAtStart || !fromChainId || !toChainId)
            return;
        if (this.#areAllSwapProvidersDisabled) {
            const hasTokenListFetchError = this.errors.some(({ id }) => id === 'to-token-list-fetch-failed');
            const shouldResetSelectedToken = shouldReset && !!this.toSelectedToken;
            const hasRequestedToToken = !!this.#requestedToToken;
            if (shouldReset)
                this.toSelectedToken = null;
            // No list can load without a provider, so it can never be selected
            this.#requestedToToken = null;
            this.removeError('to-token-list-fetch-failed', hasTokenListFetchError || shouldResetSelectedToken || hasRequestedToToken);
            return;
        }
        if (shouldReset) {
            this.toSelectedToken = null;
            // Belongs to the previous list
            this.#requestedToToken = null;
        }
        // Kept when the same token is requested again, so its running lookup still counts
        const isAlreadyRequested = this.#requestedToToken?.listKey === toTokenListKeyAtStart &&
            this.#requestedToToken.address.toLowerCase() === addressToSelect?.toLowerCase();
        if (addressToSelect && !isAlreadyRequested) {
            this.#requestedToToken = { listKey: toTokenListKeyAtStart, address: addressToSelect };
        }
        let toTokenList = this.#toTokenList[toTokenListKeyAtStart];
        // Prevent fetching the same token list twice
        if (toTokenList?.isFetching) {
            await this.#selectRequestedToToken(providerSettingsUpdateId);
            this.#emitUpdateIfNeeded();
            return;
        }
        // Create the list if it doesn’t exist yet, or set its status to LOADING if it does.
        if (!toTokenList) {
            this.#toTokenList[toTokenListKeyAtStart] = {
                status: 'LOADING',
                isFetching: false,
                loadingProviderNames: [],
                apiTokens: [],
                addedTokens: [],
                tokens: [],
                portfolioSignature: '',
                lastUpdate: 0
            };
            toTokenList = this.#toTokenList[toTokenListKeyAtStart];
        }
        else {
            toTokenList.status = 'LOADING';
        }
        this.removeError('to-token-list-fetch-failed', false);
        // Emit an update to set the loading state in the UI
        this.#emitUpdateIfNeeded();
        const now = Date.now();
        const shouldFetchTokenList = !toTokenList.apiTokens.length || now - toTokenList.lastUpdate >= swapAndBridge_1.TO_TOKEN_LIST_CACHE_THRESHOLD;
        if (shouldFetchTokenList) {
            await new Promise((resolve) => {
                // eslint-disable-next-line @typescript-eslint/no-floating-promises
                this.#fetchToTokenList({
                    listKey: toTokenListKeyAtStart,
                    fromChainId,
                    toChainId,
                    providerSettingsUpdateId,
                    onFirstAnswer: resolve
                });
            });
            if (providerSettingsUpdateId !== this.#swapProviderSettingsUpdateId)
                return;
        }
        this.#deriveToTokens(toTokenList, fromChainId, toChainId);
        const toTokenNetwork = this.#networks.networks.find((n) => Number(n.chainId) === toChainId);
        // should never happen
        if (!toTokenNetwork) {
            toTokenList.status = 'INITIAL';
            this.#emitUpdateIfNeeded();
            throw new SwapAndBridgeError_1.default(swapAndBridge_1.NETWORK_MISMATCH_MESSAGE);
        }
        toTokenList.status = 'INITIAL';
        await this.#applyToTokenListUpdate(toTokenListKeyAtStart, providerSettingsUpdateId);
    }
    /**
     * Fetches the "to" token list and applies every answer. Calls `onFirstAnswer` on the first
     * answer, or at the end if no provider answered.
     */
    async #fetchToTokenList({ listKey, fromChainId, toChainId, providerSettingsUpdateId, onFirstAnswer }) {
        const toTokenList = this.#toTokenList[listKey];
        // should never happen
        if (!toTokenList) {
            onFirstAnswer();
            return;
        }
        let hasAnswered = false;
        toTokenList.isFetching = true;
        // Nothing awaits the later answers, so their errors are reported here
        const applyLaterAnswer = () => this.#applyToTokenListUpdate(listKey, providerSettingsUpdateId).catch((error) => {
            this.emitError({
                level: 'silent',
                error: error instanceof Error ? error : new Error(String(error)),
                message: 'Failed to update the list of receive tokens',
                sendCrashReport: true
            });
        });
        try {
            const apiTokens = await this.#serviceProviderAPI.getToTokenList({
                fromChainId,
                toChainId,
                onUpdate: (tokens, loadingProviderNames) => {
                    if (providerSettingsUpdateId !== this.#swapProviderSettingsUpdateId)
                        return;
                    toTokenList.apiTokens = tokens;
                    toTokenList.loadingProviderNames = loadingProviderNames;
                    toTokenList.lastUpdate = Date.now();
                    // `updateToTokenList` applies the first answer
                    if (!hasAnswered) {
                        hasAnswered = true;
                        onFirstAnswer();
                        return;
                    }
                    this.#deriveToTokens(toTokenList, fromChainId, toChainId);
                    // eslint-disable-next-line @typescript-eslint/no-floating-promises
                    applyLaterAnswer();
                }
            });
            if (providerSettingsUpdateId !== this.#swapProviderSettingsUpdateId)
                return;
            // Same list as the last update, unless the provider has no updates
            if (apiTokens !== toTokenList.apiTokens) {
                toTokenList.apiTokens = apiTokens;
                this.#deriveToTokens(toTokenList, fromChainId, toChainId);
            }
            toTokenList.lastUpdate = Date.now();
        }
        catch (error) {
            if (providerSettingsUpdateId !== this.#swapProviderSettingsUpdateId)
                return;
            // Display an error only if there is no cached data
            if (!toTokenList.apiTokens.length) {
                const { message } = (0, swapAndBridgeErrorHumanizer_1.getHumanReadableSwapAndBridgeError)(error);
                this.addOrUpdateError({
                    id: 'to-token-list-fetch-failed',
                    title: 'Token list fetch failed',
                    text: message,
                    level: 'error'
                });
            }
        }
        finally {
            toTokenList.isFetching = false;
            toTokenList.loadingProviderNames = [];
            onFirstAnswer();
        }
        // Without an answer, `updateToTokenList` handles the outcome
        if (hasAnswered)
            await applyLaterAnswer();
    }
    /** Builds the displayed "to" tokens from the providers' tokens and the portfolio. */
    #deriveToTokens(toTokenList, fromChainId, toChainId) {
        toTokenList.tokens = this.#getToTokens(fromChainId, toChainId);
        // Committed here rather than where the rebuild is decided, so it describes the portfolio
        // the list was actually derived from.
        toTokenList.portfolioSignature = this.#getToTokenPortfolioSignature(toChainId);
    }
    /** Keeps a token looked up by address in its list, so it survives later provider answers. */
    #addToTokenToList(toTokenList, token, fromChainId, toChainId) {
        const address = token.address.toLowerCase();
        const isAlreadyAdded = toTokenList.addedTokens.some((t) => t.address.toLowerCase() === address);
        if (!isAlreadyAdded)
            toTokenList.addedTokens.push(token);
        this.#deriveToTokens(toTokenList, fromChainId, toChainId);
    }
    /** Selects the requested token, updates the search and fetches market data. */
    async #applyToTokenListUpdate(listKey, providerSettingsUpdateId) {
        if (listKey !== this.#toTokenListKey)
            return;
        if (providerSettingsUpdateId !== this.#swapProviderSettingsUpdateId)
            return;
        await this.#selectRequestedToToken(providerSettingsUpdateId);
        if (providerSettingsUpdateId !== this.#swapProviderSettingsUpdateId)
            return;
        if (this.toTokenSearchTerm)
            this.#updateToTokenSearchResults();
        this.#emitUpdateIfNeeded();
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.#fetchToTokenMarketData(this.toTokenShortList);
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        if (this.toTokenSearchTerm)
            this.#fetchToTokenMarketData(this.toTokenSearchResults);
    }
    /**
     * Selects the requested "to" token once the list has it. If the first provider answered
     * without it, looks it up by address, without waiting for the slower providers.
     */
    async #selectRequestedToToken(providerSettingsUpdateId) {
        const requestedToToken = this.#requestedToToken;
        const listKey = this.#toTokenListKey;
        if (!requestedToToken || requestedToToken.listKey !== listKey)
            return;
        // Already selected in the meantime
        if (this.toSelectedToken) {
            this.#requestedToToken = null;
            return;
        }
        const toTokenList = this.#toTokenList[listKey];
        if (!toTokenList)
            return;
        // Compare lowercased, as the address may come from outside Swap & Bridge (e.g. a trending
        // token) in a different case than the service provider's.
        const requestedAddress = requestedToToken.address.toLowerCase();
        const tokenInList = toTokenList.tokens.find((t) => t.address.toLowerCase() === requestedAddress);
        if (!tokenInList) {
            // The list always leaves banned tokens out, so a lookup could never get it selected
            const isRequestedTokenBanned = (0, swapAndBridge_2.getBannedToTokenList)(String(this.toChainId)).some((address) => address.toLowerCase() === requestedAddress);
            if (isRequestedTokenBanned) {
                this.#requestedToToken = null;
                return;
            }
            // No provider has answered yet, and the first answer usually has it
            if (toTokenList.status === 'LOADING')
                return;
            if (requestedToToken.lookupProviderSettingsUpdateId === providerSettingsUpdateId) {
                // Neither the lookup nor any provider has it
                if (requestedToToken.isLookupFailed && !toTokenList.isFetching) {
                    this.#requestedToToken = null;
                }
                // Otherwise the running lookup or a slower provider selects it
                return;
            }
            requestedToToken.lookupProviderSettingsUpdateId = providerSettingsUpdateId;
            requestedToToken.isLookupFailed = false;
        }
        const token = tokenInList ||
            (await this.#fetchAndCacheToTokenToSelect(requestedToToken.address, providerSettingsUpdateId));
        if (providerSettingsUpdateId !== this.#swapProviderSettingsUpdateId)
            return;
        // Replaced by another request during the lookup
        if (this.#requestedToToken !== requestedToToken)
            return;
        if (!token && this.#toTokenList[listKey]?.isFetching) {
            requestedToToken.isLookupFailed = true;
            return;
        }
        this.#requestedToToken = null;
        if (!token || this.toSelectedToken || listKey !== this.#toTokenListKey)
            return;
        await this.updateForm({ toSelectedTokenAddr: token.address }, { emitUpdate: false });
    }
    #getMarketDataRecord(chainId, address) {
        const record = this.#toTokenMarketData[chainId]?.get(address.toLowerCase());
        const isStale = !record || Date.now() - record.updatedAt > swapAndBridge_1.MARKET_DATA_THRESHOLD_BY_STATUS[record.status];
        return { record, isStale };
    }
    #setMarketDataRecord(chainId, address, record) {
        if (!this.#toTokenMarketData[chainId])
            this.#toTokenMarketData[chainId] = new Map();
        this.#toTokenMarketData[chainId].set(address.toLowerCase(), record);
    }
    /**
     * Fetches the market data of the passed tokens, skipping the ones that already have
     * fresh data or a request in flight. Fire-and-forget, so that displaying the token
     * list never waits on it.
     */
    async #fetchToTokenMarketData(tokens) {
        // Opted out of sending the receive token addresses to our price API
        if (!this.#featureFlags.isFeatureEnabled('swapAndBridgeTokenInfo'))
            return;
        // Indexed once instead of scanned per token, and reused by the fetch below.
        const networkByChainId = new Map(this.#networks.networks.map((n) => [Number(n.chainId), n]));
        const tokensToFetch = tokens.filter((token) => {
            const network = networkByChainId.get(token.chainId);
            // Without a platform id our price API has nothing to look the token up by. This is
            // the case for custom networks, which are simply left without market data.
            if (!network?.platformId)
                return false;
            // Native tokens aren't real contracts, so the contract-address route can't look
            // them up either. Without a recognized CoinGecko coin id there is nothing to fall
            // back to, so they are left without market data too.
            const isNative = token.address === ethers_1.ZeroAddress;
            if (isNative && (!network.nativeAssetId || network.nativeAssetId === 'LOADING'))
                return false;
            return this.#getMarketDataRecord(token.chainId, token.address).isStale;
        });
        if (!tokensToFetch.length)
            return;
        // Not emitting an update here on purpose. Tokens without a record are already
        // reported as loading by `toTokenMarketData`, so marking them changes nothing for
        // the UI and emitting would serialize the whole controller state for nothing.
        tokensToFetch.forEach((token) => {
            this.#setMarketDataRecord(token.chainId, token.address, {
                status: 'LOADING',
                updatedAt: Date.now()
            });
        });
        const results = await Promise.allSettled(tokensToFetch.map((token) => {
            const network = networkByChainId.get(token.chainId);
            const isNative = token.address === ethers_1.ZeroAddress;
            return this.#batchedTokenMarketData({
                address: token.address,
                chainId: token.chainId,
                platformId: network?.platformId,
                nativeAssetId: network?.nativeAssetId,
                // Native tokens are looked up by their CoinGecko coin id (e.g. "ethereum")
                // instead, as the contract-address route doesn't support them
                responseIdentifier: isNative ? network?.nativeAssetId : token.address.toLowerCase()
            });
        }));
        let failure;
        results.forEach((result, index) => {
            const token = tokensToFetch[index];
            if (!token)
                return;
            if (result.status === 'rejected') {
                failure = result.reason;
                this.#setMarketDataRecord(token.chainId, token.address, {
                    status: 'FAIL',
                    updatedAt: Date.now()
                });
                return;
            }
            // Our price API omits the tokens it has no data for, instead of returning empty entries
            if (!result.value) {
                this.#setMarketDataRecord(token.chainId, token.address, {
                    status: 'NOT_FOUND',
                    updatedAt: Date.now()
                });
                return;
            }
            this.#setMarketDataRecord(token.chainId, token.address, {
                status: 'DONE',
                updatedAt: Date.now(),
                data: (0, helpers_1.convertApiTokenDataToTokenDataCache)(result.value)
            });
        });
        // Emitted once for the whole batch, as emitting per token would serialize the
        // entire controller state dozens of times in a row.
        this.#emitUpdateIfNeeded();
        if (failure) {
            this.emitError({
                level: 'silent',
                error: failure instanceof Error ? failure : new Error(String(failure)),
                message: 'Failed to fetch the market data of the Swap & Bridge receive tokens',
                sendCrashReport: true
            });
        }
    }
    /**
     * The market data of the currently visible "to" tokens only, because the whole
     * `#toTokenMarketData` is far too large to be sent to the UI on every update.
     * Records that went stale are reported as loading - they are hidden until the
     * refresh triggered alongside this list completes, so that the UI never displays
     * an outdated exchange list.
     */
    get toTokenMarketData() {
        // Whatever was fetched before the user opted out stays out of the UI state too
        if (!this.#featureFlags.isFeatureEnabled('swapAndBridgeTokenInfo'))
            return {};
        const visibleTokens = [
            ...this.toTokenShortList,
            ...this.toTokenSearchResults,
            ...(this.toSelectedToken ? [this.toSelectedToken] : [])
        ];
        return visibleTokens.reduce((acc, token) => {
            const key = (0, tokenMarketData_1.getTokenMarketDataKey)(token.chainId, token.address);
            if (acc[key])
                return acc;
            const { record, isStale } = this.#getMarketDataRecord(token.chainId, token.address);
            if (!record || isStale || record.status === 'LOADING') {
                acc[key] = { status: 'LOADING' };
                return acc;
            }
            if (record.status !== 'DONE') {
                acc[key] = { status: record.status };
                return acc;
            }
            acc[key] = {
                status: 'DONE',
                exchanges: record.data?.meta?.exchanges
            };
            return acc;
        }, {});
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
            const fromSelectedTokenAddress = this.fromSelectedToken?.address;
            const shortList = [];
            // Stops at the limit instead of filtering the whole list first. This getter is part
            // of the state sent to the UI, so it runs on every update of this controller, and
            // the list it reads runs to thousands of tokens.
            for (let i = 0; i < tokens.length && shortList.length < swapAndBridge_1.TO_TOKEN_LIST_LIMIT; i++) {
                const token = tokens[i];
                // Swaps between same "from" and "to" tokens are not feasible, filter them out
                if (token.address === fromSelectedTokenAddress)
                    continue;
                shortList.push(token);
            }
            return shortList;
        }
        return tokens.slice(0, swapAndBridge_1.TO_TOKEN_LIST_LIMIT);
    }
    /**
     * Everything `#getToTokens` reads off the portfolio, as a comparable string: which of the
     * account's tokens sit on the "to" chain, and the values their order depends on.
     */
    #getToTokenPortfolioSignature(chainId = this.toChainId) {
        if (!chainId)
            return '';
        const toChainIdBigInt = BigInt(chainId);
        return this.portfolioTokenList
            .filter((t) => t.chainId === toChainIdBigInt)
            .map((t) => {
            const priceUSD = t.priceIn.find(({ baseCurrency }) => baseCurrency === 'usd')?.price;
            return `${t.address}:${t.amount}:${t.amountPostSimulation ?? ''}:${priceUSD ?? ''}`;
        })
            .join();
    }
    /** Whether the service provider's cached "to" token list is due for a refetch. */
    #isToTokenApiListStale() {
        const toTokenList = this.#currentToTokenList;
        if (!toTokenList)
            return true;
        return (!toTokenList.apiTokens.length ||
            Date.now() - toTokenList.lastUpdate >= swapAndBridge_1.TO_TOKEN_LIST_CACHE_THRESHOLD);
    }
    #getToTokens(fromChainId, toChainId) {
        const toTokenListKey = SwapAndBridgeController.getToTokenListKey(fromChainId, toChainId);
        if (!toTokenListKey || !fromChainId || !toChainId)
            return [];
        const toTokenList = this.#toTokenList[toTokenListKey];
        const apiTokens = toTokenList?.apiTokens ||
            (0, swapAndBridge_2.addCustomTokensIfNeeded)({
                chainId: toChainId,
                tokens: []
            });
        const toChainIdBigInt = BigInt(toChainId);
        const portfolioTokens = this.portfolioTokenList.filter((t) => t.chainId === toChainIdBigInt);
        const apiTokenAddresses = new Set(apiTokens.map((t) => t.address.toLowerCase()));
        // A provider may have added it to its list since
        const addedTokens = (toTokenList?.addedTokens || []).filter((t) => !apiTokenAddresses.has(t.address.toLowerCase()));
        const providerTokenAddresses = new Set([
            ...apiTokenAddresses,
            ...addedTokens.map((t) => t.address.toLowerCase())
        ]);
        const additionalTokensFromPortfolio = portfolioTokens
            .filter((token) => !providerTokenAddresses.has(token.address.toLowerCase()))
            .map((t) => (0, swapAndBridge_2.convertPortfolioTokenToSwapAndBridgeToToken)(t, toChainId));
        const chainBannedTokens = new Set((0, swapAndBridge_2.getBannedToTokenList)(toChainId.toString()).map((address) => address.toLowerCase()));
        const tokens = [...apiTokens, ...addedTokens, ...additionalTokensFromPortfolio].filter((t) => !chainBannedTokens.has(t.address.toLowerCase()));
        return (0, swapAndBridge_2.sortTokenListResponse)(tokens, portfolioTokens);
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
    /** Providers that haven't returned their tokens for the current "to" list yet. */
    get toTokenListLoadingProviderNames() {
        return this.#currentToTokenList?.loadingProviderNames || [];
    }
    /** Whether a requested "to" token (e.g. a trending one) is waiting for its list. */
    get isToTokenSelectionPending() {
        return (!!this.#requestedToToken &&
            this.#requestedToToken.listKey === this.#toTokenListKey &&
            !this.toSelectedToken);
    }
    /**
     * Fetches a single token that the service provider left out of its "to" token list and caches it,
     * so a token preselected from outside Swap & Bridge (e.g. from the trending tokens list) can
     * still be selected. Fails silently, because the selection is not user-initiated.
     */
    async #fetchAndCacheToTokenToSelect(address, providerSettingsUpdateId) {
        const fromChainId = this.fromChainId;
        const toChainId = this.toChainId;
        const tokenList = this.#currentToTokenList;
        if (!fromChainId || !toChainId || !tokenList || !(0, ethers_1.isAddress)(address))
            return null;
        try {
            const token = await this.#serviceProviderAPI.getToken({ address, chainId: toChainId });
            if (providerSettingsUpdateId !== this.#swapProviderSettingsUpdateId)
                return null;
            if (!token)
                return null;
            // Cache it the same way tokens added by address are cached
            this.#addToTokenToList(tokenList, token, fromChainId, toChainId);
            return token;
        }
        catch (error) {
            if (providerSettingsUpdateId !== this.#swapProviderSettingsUpdateId)
                return null;
            const { message } = (0, swapAndBridgeErrorHumanizer_1.getHumanReadableSwapAndBridgeError)(error);
            this.emitError({ error, level: 'silent', message });
            return null;
        }
    }
    async #addToTokenByAddress(address) {
        const fromChainId = this.fromChainId;
        const toChainId = this.toChainId;
        if (!fromChainId || !toChainId)
            return; // should never happen
        if (!(0, ethers_1.isAddress)(address))
            return; // no need to attempt with invalid addresses
        const tokenList = this.#currentToTokenList;
        if (!tokenList)
            return;
        const isAlreadyInTheList = tokenList.tokens.some(
        // Compare lowercase, address param comes from a search term that is lowercased
        (t) => t.address.toLowerCase() === address.toLowerCase());
        if (isAlreadyInTheList)
            return;
        let token;
        try {
            token = await this.#serviceProviderAPI.getToken({ address, chainId: toChainId });
            if (!token)
                throw new SwapAndBridgeError_1.default('Token with this address is not supported by our service provider.');
        }
        catch (error) {
            const { message } = (0, swapAndBridgeErrorHumanizer_1.getHumanReadableSwapAndBridgeError)(error);
            throw new EmittableError_1.default({ error, level: 'silent', message });
        }
        // Cache the tokens added by address
        this.#addToTokenToList(tokenList, token, fromChainId, toChainId);
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
    addToTokenByAddress = async (address) => this.withStatus('addToTokenByAddress', () => this.#addToTokenByAddress(address), true, 'silent');
    async searchToToken(searchTerm) {
        // Reset the search results
        this.toTokenSearchTerm = '';
        this.toTokenSearchResults = [];
        this.#emitUpdateIfNeeded();
        if (!searchTerm)
            return; // should never happen
        if (!this.#toTokenListKey || !this.#toTokenList[this.#toTokenListKey])
            return;
        this.toTokenSearchTerm = searchTerm.trim().toLowerCase();
        this.#updateToTokenSearchResults();
        this.#emitUpdateIfNeeded();
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.#fetchToTokenMarketData(this.toTokenSearchResults);
    }
    /** Matches the "to" token list against `toTokenSearchTerm`. */
    #updateToTokenSearchResults() {
        const normalizedSearchTerm = this.toTokenSearchTerm;
        const tokens = this.#currentToTokenList?.tokens || [];
        // Read once rather than per token: the list runs to thousands of them and this is
        // walked again on every keystroke.
        const isSwappingOnSameChain = !!this.toChainId && this.fromChainId === this.toChainId;
        const fromSelectedTokenAddress = this.fromSelectedToken?.address;
        const exactMatches = [];
        const partialMatches = [];
        tokens.forEach((token) => {
            // Filter out the from token if swapping on the same chain
            if (isSwappingOnSameChain && token.address === fromSelectedTokenAddress)
                return;
            const fieldsToSearch = this.#getToTokenSearchFields(token);
            // Prioritize exact matches, partial matches come after
            let isExactMatch = false;
            let isPartialMatch = false;
            for (let i = 0; i < fieldsToSearch.length; i++) {
                const field = fieldsToSearch[i];
                if (field === normalizedSearchTerm) {
                    isExactMatch = true;
                    break;
                }
                if (field.includes(normalizedSearchTerm))
                    isPartialMatch = true;
            }
            if (isExactMatch)
                exactMatches.push(token);
            else if (isPartialMatch)
                partialMatches.push(token);
        });
        this.toTokenSearchResults = [...exactMatches, ...partialMatches].slice(0, swapAndBridge_1.TO_TOKEN_LIST_LIMIT);
    }
    #getToTokenSearchFields(token) {
        const cached = this.#toTokenSearchFields.get(token);
        if (cached)
            return cached;
        const fields = [
            token.address.toLowerCase(),
            token.symbol.toLowerCase(),
            token.name.toLowerCase()
        ];
        this.#toTokenSearchFields.set(token, fields);
        return fields;
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
        if (this.formStatus === constants_1.SwapAndBridgeFormStatus.Proceeded)
            return;
        // no quote fetch if there are errors
        if (this.swapSignErrors.length)
            return;
        const providerSettingsUpdateId = this.#swapProviderSettingsUpdateId;
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
                const toSelectedToken = this.toSelectedToken;
                const selectedAccountAddress = this.#selectedAccount.account.addr;
                this.#updateFeePercent();
                const toTokenPricePromise = (0, with_timeout_1.withTimeout)(() => this.#portfolio.getTokenPrice(selectedAccountAddress, BigInt(this.toChainId), toSelectedToken.address), {
                    timeoutMs: swapAndBridge_1.TO_TOKEN_PRICE_TIMEOUT_MS,
                    message: `Fetching the receive token price for ${toSelectedToken.address} on chainId ${this.toChainId} timed out.`
                }).catch((error) => {
                    this.emitError({
                        error,
                        level: 'silent',
                        message: `Unable to fetch the receive token price for ${toSelectedToken.address} on chainId ${this.toChainId}.`
                    });
                    return null;
                });
                const [toTokenPriceUSD, quoteResult] = await Promise.all([
                    toTokenPricePromise,
                    this.#serviceProviderAPI.quote({
                        fromAsset: this.fromSelectedToken,
                        fromChainId: this.fromChainId,
                        fromTokenAddress: this.fromSelectedToken.address,
                        toAsset: toSelectedToken,
                        toChainId: this.toChainId,
                        toTokenAddress: toSelectedToken.address,
                        fromAmount: bigintFromAmount,
                        userAddress: selectedAccountAddress,
                        sort: this.routePriority,
                        isWrapOrUnwrap,
                        accountNativeBalance: this.#accountNativeBalance(bigintFromAmount),
                        nativeSymbol: network?.nativeAssetSymbol || 'ETH',
                        feePercent: this.feePercent
                    })
                ]);
                // sort the routes by value and them by disabled, making disabled last
                quoteResult.routes = quoteResult.routes
                    .map((route) => (0, swapAndBridge_2.enrichRouteWithOutputTokenPrice)(route, toTokenPriceUSD))
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
                    .sort((a, b) => (0, exports.sortSwapAndBridgeRoutes)(a, b, toTokenPriceUSD))
                    .sort((a, b) => Number(a.disabled === true) - Number(b.disabled === true));
                // select the first enabled route
                quoteResult.selectedRoute = quoteResult.routes.length ? quoteResult.routes[0] : undefined;
                quoteResult.selectedRouteSteps = quoteResult.selectedRoute
                    ? quoteResult.selectedRoute.steps
                    : [];
                if (this.#isQuoteIdObsoleteAfterAsyncOperation(quoteId) ||
                    providerSettingsUpdateId !== this.#swapProviderSettingsUpdateId)
                    return;
                // no updates if the user has commited
                if (this.formStatus === constants_1.SwapAndBridgeFormStatus.Proceeded)
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
                if (this.#isQuoteIdObsoleteAfterAsyncOperation(quoteId) ||
                    providerSettingsUpdateId !== this.#swapProviderSettingsUpdateId)
                    return;
                const { message } = (0, swapAndBridgeErrorHumanizer_1.getHumanReadableSwapAndBridgeError)(error);
                this.emitError({ error, level: 'silent', message });
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
        if (this.#updateQuoteId !== quoteId ||
            providerSettingsUpdateId !== this.#swapProviderSettingsUpdateId)
            return;
        const isSuccessful = await updateQuoteFunction();
        if (this.#updateQuoteId !== quoteId ||
            providerSettingsUpdateId !== this.#swapProviderSettingsUpdateId)
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
        if (this.formStatus !== constants_1.SwapAndBridgeFormStatus.ReadyToEstimate &&
            this.formStatus !== constants_1.SwapAndBridgeFormStatus.ReadyToSubmit)
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
    async recordIntentActivity(txnId, activeRoute, status) {
        await this.#initialLoadPromise;
        // when the status is completed, we expect the funds to land on the
        // destination chain => we use toChainId;
        // when it's refunded, we expect the source chain => fromChainId
        const chainId = status === 'completed' ? activeRoute.route?.toChainId : activeRoute.route?.fromChainId;
        if (!chainId) {
            const message = 'recordIntentActivity: no chainId found';
            this.emitError({
                level: 'silent',
                message,
                error: new Error(message)
            });
            return;
        }
        const provider = this.#providers.providers[chainId.toString()];
        if (!provider) {
            const message = 'recordIntentActivity: no provider found';
            this.emitError({
                level: 'silent',
                message,
                error: new Error(message)
            });
            return;
        }
        const receipt = await provider.getTransactionReceipt(txnId);
        if (!receipt) {
            const message = `recordIntentActivity: no receipt found for txnId: ${txnId}`;
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
            if (activeRoute.route?.providerId === 'cowswap' &&
                activeRouteSubmittedAccountOp.status !== types_1.AccountOpStatus.Success)
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
                    routeId: activeRoute.route.routeId,
                    rawRoute: activeRoute.route.rawRoute
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
                activeRoute.route &&
                (0, swapAndBridge_2.getIsIntentRoute)(activeRoute.route)) {
                // we shouldn't be awaiting this as it's OK to have it at a later stage
                this.recordIntentActivity(routeStatusResult.txnId, activeRoute, status).catch((error) => {
                    this.emitError({
                        level: 'silent',
                        message: 'recordIntentActivity failed',
                        error
                    });
                });
            }
            if (status === 'completed') {
                this.updateActiveRoute(activeRoute.activeRouteId, {
                    routeStatus: 'completed',
                    error: undefined
                }, true);
                if (this.#portfolioUpdate && (0, swapAndBridge_2.getIsIntentRoute)(activeRoute.route)) {
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
            else if (status === 'failed') {
                this.updateActiveRoute(activeRoute.activeRouteId, {
                    routeStatus: 'failed',
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
            constants_1.SwapAndBridgeFormStatus.ReadyToSubmit,
            constants_1.SwapAndBridgeFormStatus.ReadyToEstimate,
            constants_1.SwapAndBridgeFormStatus.InvalidRouteSelected
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
            throw new EmittableError_1.default({ error: new Error(message), level: 'silent', message });
        }
        try {
            const route = finalQuote.selectedRoute;
            const activeRoute = {
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
            };
            const activeRouteIndex = this.activeRoutes.findIndex((r) => r.activeRouteId === activeRoute.activeRouteId);
            this.activeRoutes =
                activeRouteIndex === -1
                    ? [...this.activeRoutes, activeRoute]
                    : this.activeRoutes.map((r, i) => (i === activeRouteIndex ? activeRoute : r));
            this.emitUpdate();
        }
        catch (error) {
            const { message } = (0, swapAndBridgeErrorHumanizer_1.getHumanReadableSwapAndBridgeError)(error);
            throw new EmittableError_1.default({ error, level: 'silent', message });
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
                    activeRouteRoute.currentUserTxIndex = activeRouteRoute.userTxs.filter((tx) => !(0, swapAndBridge_2.isTxnBridge)(tx)).length;
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
     * Removes failed active routes and hides the failed txn banner
     */
    async removeFailedRouteAndHideBanner(activeRouteId) {
        const route = this.activeRoutes.find((r) => r.activeRouteId === activeRouteId);
        if (!route)
            return;
        if (!route.identifiedBy || !route.route)
            return;
        const op = this.#activity.findByIdentifiedBy(route.identifiedBy, route.sender, BigInt(route.route.fromChainId));
        if (op) {
            this.#activity.setDashboardBannersSeen('dashboard', route.sender, {
                accountOpIds: [op.id],
                emitUpdate: true,
                hideImmediately: true
            });
        }
        this.removeActiveRoute(activeRouteId);
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
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.#handleSentSwapPartResolved(op);
        this.#handleUpdateActiveRouteFromSwapTxnMeta(op);
        op.calls.forEach((call) => {
            this.#handleActiveRouteBroadcastedTransaction(call.id, op.status);
            this.#handleActiveRouteBroadcastedApproval(call.id, op.status);
            this.#handleActiveRoutesWithReadyApproval(call.id, op.status);
            this.#handleUpdateActiveRoutesUserTxData(call.id, op);
            this.#handleActiveRoutesCompleted(call.id, op.status);
        });
    }
    async #handleSentSwapPartResolved(op) {
        if (op.status === types_1.AccountOpStatus.BroadcastedButNotConfirmed)
            return;
        if (!this.#sentSwapPartIdentifier)
            return;
        if (this.#sentSwapPartIdentifier !== op.identifiedBy.identifier)
            return;
        this.#sentSwapPartIdentifier = null;
        // The new quote builds only the txns still needed,
        // e.g. no approval if the sent one was confirmed
        await this.#refreshQuoteAfterPartialSwap();
    }
    async #refreshQuoteAfterPartialSwap() {
        try {
            // A new quote would select the best route instead of the one the user picked,
            // so only the txns are built again for it (reading the allowance from the chain)
            if (this.quote?.selectedRoute?.isSelectedManually) {
                if (this.#updateQuoteId)
                    await this.initSignAccountOpIfNeeded(this.#updateQuoteId);
                this.emitUpdate();
                return;
            }
            await this.updateQuote({ skipPreviousQuoteRemoval: true, skipQuoteUpdateOnSameValues: false });
        }
        catch (error) {
            this.emitError({
                level: 'silent',
                message: 'Failed to refresh the swap quote after a partly sent swap',
                error
            });
        }
    }
    #handleUpdateActiveRouteFromSwapTxnMeta(submittedAccountOp) {
        const swapTxn = submittedAccountOp.meta?.swapTxn;
        if (!swapTxn)
            return;
        const activeRoute = this.activeRoutes.find((r) => r.activeRouteId === swapTxn.activeRouteId);
        if (!activeRoute)
            return;
        if (!activeRoute.userTxHash && submittedAccountOp.txnId) {
            this.updateActiveRoute(activeRoute.activeRouteId, {
                userTxHash: submittedAccountOp.txnId,
                identifiedBy: submittedAccountOp.identifiedBy
            });
        }
        if (submittedAccountOp.status === types_1.AccountOpStatus.Failure ||
            submittedAccountOp.status === types_1.AccountOpStatus.Rejected) {
            const errorMessage = submittedAccountOp.status === types_1.AccountOpStatus.Rejected
                ? 'The transaction was rejected'
                : 'The transaction failed onchain';
            this.updateActiveRoute(activeRoute.activeRouteId, {
                routeStatus: 'failed',
                error: errorMessage
            });
        }
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
        if (activeRoute.route.providerId === 'cowswap' &&
            activeRoute.routeStatus === 'in-progress' &&
            opStatus === types_1.AccountOpStatus.Success) {
            this.#updateActiveRoutesInterval.restart({
                timeout: (0, swapAndBridge_2.getActiveRoutesLowestServiceTime)(this.activeRoutesInProgress),
                runImmediately: true
            });
        }
        let shouldUpdateActiveRouteStatus = false;
        const isSwap = !(0, swapAndBridge_2.getIsIntentRoute)(activeRoute.route);
        // Regular swaps finish with the user's transaction. Intent routes stay in progress until the
        // provider reports that their asynchronous finalization has completed.
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
        if (this.formStatus === constants_1.SwapAndBridgeFormStatus.Proceeded)
            return;
        // Read once, as the selection can change while this awaits, and the quote guards below
        // drop the result then. Missing when a Privacy Pools account is selected.
        const { account } = this.#selectedAccount;
        if (!account)
            return;
        // again it shouldn't happen but there might be a case where the from token
        // disappears because of a strange update event. It's fine to just not
        // continue from the point forward
        if (!this.fromSelectedToken || !this.toSelectedToken || !this.toChainId)
            return;
        if (this.formStatus !== constants_1.SwapAndBridgeFormStatus.ReadyToEstimate &&
            this.formStatus !== constants_1.SwapAndBridgeFormStatus.ReadyToSubmit)
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
        const accountState = await this.#accounts.getOrFetchAccountOnChainState(account.addr, network.chainId);
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
        const userRequestCalls = this.#getUserRequests().find((r) => r.kind === 'calls' && r.id === `${account.addr}-${network.chainId}`)?.signAccountOp.accountOp.calls || [];
        const swapOrBridgeCalls = await (0, swapAndBridge_2.getSwapAndBridgeCalls)(userTxn, account, provider, accountState);
        if (this.#isQuoteIdObsoleteAfterAsyncOperation(quoteIdGuard))
            return;
        const feeToken = (0, swapAndBridge_2.getFeeTokenForSponsorship)(this.fromSelectedToken, this.quote, this.fromAmount);
        const isIntent = this.quote?.selectedRoute
            ? (0, swapAndBridge_2.getIsIntentRoute)(this.quote.selectedRoute)
            : !!this.fromChainId && !!this.toChainId && this.fromChainId !== this.toChainId;
        const calls = !isIntent ? [...userRequestCalls, ...swapOrBridgeCalls] : [...swapOrBridgeCalls];
        const native = this.#portfolio
            .getAccountPortfolioState(account.addr)[network.chainId.toString()]?.result?.tokens.find((token) => token.address === ethers_1.ZeroAddress);
        const nativePrice = native?.priceIn.find((price) => price.baseCurrency === 'usd')?.price;
        const baseAcc = (0, getBaseAccount_1.getBaseAccount)(account, accountState, network, this.#featureFlags.isFeatureEnabled('erc4337'), this.#featureFlags.isFeatureEnabled('eip7702'));
        const swapSponsorship = (0, swapAndBridge_2.getSwapSponsorship)({
            isErc4337Enabled: this.#featureFlags.isFeatureEnabled('erc4337'),
            hasConvinienceFee: this.quote?.selectedRoute?.withConvenienceFee || false,
            nativePrice,
            fromAmountInUsd: Number(this.fromAmountInFiat),
            feeTokenPriceInUsd: feeToken.feeTokenPriceInUsd,
            feeTokenDecimals: feeToken.decimals,
            providerId: this.quote?.selectedRoute?.providerId,
            isIntent,
            feePercent: this.feePercent
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
            accountAddr: account.addr,
            chainId: network.chainId,
            signingKeyAddr: null,
            signingKeyType: null,
            gasLimit: null,
            gasFeePayment: null,
            nonce: accountState.nonce,
            signature: null,
            calls,
            meta: {
                swapTxn: userTxn,
                paymasterService: (0, erc7677_1.getAmbirePaymasterService)(baseAcc, this.#relayerUrl),
                fromQuoteId: quoteIdGuard,
                swapSponsorship
            }
        };
        await this.#signAccountOpPreference.initialLoadPromise;
        let hasSentPartOfSwap = false;
        this.#signAccountOpController = new signAccountOp_1.SignAccountOpController({
            type: 'one-click-swap-and-bridge',
            callRelayer: this.#callRelayer,
            accounts: this.#accounts,
            networks: this.#networks,
            keystore: this.#keystore,
            portfolio: this.#portfolio,
            featureFlags: this.#featureFlags,
            platform: this.#platform,
            signAccountOpPreference: this.#signAccountOpPreference,
            externalSignerControllers: this.#externalSignerControllers,
            activity: this.#activity,
            account,
            network,
            provider,
            phishing: this.#phishing,
            dapps: this.#dapps,
            erc7730: this.#erc7730,
            contractInfo: this.#contractInfo,
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
            onBroadcastFailed: this.#onBroadcastFailed,
            onPartialBroadcast: async (sentAccountOp) => {
                hasSentPartOfSwap = true;
                await this.#activity.addAccountOp((0, swapAndBridge_2.getSentPartOfSwap)(sentAccountOp));
                this.#sentSwapPartIdentifier = sentAccountOp.identifiedBy.identifier;
            }
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
        // Need to use THIS signAccountOpController specifically, the one that emitted the error.
        // NOT the field (this.#signAccountOpController), which can be replaced or nulled before
        // the error arrives, and NOT the getter (this.signAccountOpController) that is ALWAYS
        // up-to-date with the current quote and the current form state.
        const signAccountOpController = this.#signAccountOpController;
        signAccountOpController.onError(async (error) => {
            // Forwarded as is, as SignAccountOp already keeps its background errors silent
            // on the swap screen (e.g. failed gas price refreshes)
            this.emitError(error);
            // Need to clean the pending results for THIS signAccountOpController
            await this.#portfolio.overrideSimulationResults(signAccountOpController.accountOp);
            // Part of its txns went out, so it can't be signed again. That would send them twice,
            // e.g. a second approval after the first one is confirmed. A new one is built right away
            // from the onchain state. If the sent approval is still pending, the new one replaces it,
            // as it's sent with the same nonce
            // TODO: While the sent part is pending (it can get stuck), show a modal to speed it up or
            // cancel it, so the user fixes it first. Until that UX exists, the user isn't blocked
            if (hasSentPartOfSwap && this.#signAccountOpController === signAccountOpController) {
                hasSentPartOfSwap = false;
                this.destroySignAccountOp();
                this.emitUpdate();
                await this.#refreshQuoteAfterPartialSwap();
            }
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
        const isIntent = this.quote?.selectedRoute
            ? (0, swapAndBridge_2.getIsIntentRoute)(this.quote.selectedRoute)
            : !!this.fromChainId && !!this.toChainId && this.fromChainId !== this.toChainId;
        const fromSelectedTokenWithUpToDateAmount = this.#getFromSelectedTokenInPortfolio();
        if (isIntent &&
            fromSelectedTokenWithUpToDateAmount &&
            fromSelectedTokenWithUpToDateAmount.amountPostSimulation &&
            fromSelectedTokenWithUpToDateAmount.amount !==
                fromSelectedTokenWithUpToDateAmount.amountPostSimulation) {
            errors.push({
                title: `${fromSelectedTokenWithUpToDateAmount.symbol} detected in batch. Please complete the batch before continuing`
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
        const activeRoutesForSelectedAccount = (0, swapAndBridge_2.getActiveRoutesForAccount)(this.#selectedAccount.account.addr, this.activeRoutes);
        const callsUserRequests = this.#getVisibleUserRequests().filter(({ kind }) => kind === 'calls');
        // Regular swaps complete with the user's transaction. Intents finish asynchronously and
        // remain visible in the same progress UI as bridges until the provider reports completion.
        return (0, banners_1.getIntentBanners)(activeRoutesForSelectedAccount, callsUserRequests, this.#selectedAccount.account.addr);
    }
    get #shouldAutoUpdateQuote() {
        return (this.#isOnSwapAndBridgeRoute &&
            this.formStatus === constants_1.SwapAndBridgeFormStatus.ReadyToSubmit &&
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
        const minServiceTime = (0, swapAndBridge_2.getActiveRoutesLowestServiceTime)(this.activeRoutesInProgress);
        const startTimeout = minServiceTime === this.#updateActiveRoutesInterval.currentTimeout
            ? intervals_1.BRIDGE_STATUS_INTERVAL
            : this.#updateActiveRoutesInterval.currentTimeout + intervals_1.BRIDGE_STATUS_INTERVAL;
        this.#updateActiveRoutesInterval.updateTimeout({
            timeout: startTimeout < intervals_1.BRIDGE_STATUS_INTERVAL_CEILING
                ? startTimeout
                : intervals_1.BRIDGE_STATUS_INTERVAL_CEILING
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
            toTokenMarketData: this.toTokenMarketData,
            updateToTokenListStatus: this.updateToTokenListStatus,
            toTokenListLoadingProviderNames: this.toTokenListLoadingProviderNames,
            isToTokenSelectionPending: this.isToTokenSelectionPending,
            maxFromAmount: this.maxFromAmount,
            validateFromAmount: this.validateFromAmount,
            isFormEmpty: this.isFormEmpty,
            formStatus: this.formStatus,
            activeRoutesInProgress: this.activeRoutesInProgress,
            activeRoutes: this.activeRoutes,
            isHealthy: this.isHealthy,
            shouldEnableRoutesSelection: this.shouldEnableRoutesSelection,
            feeExemptionReason: this.feeExemptionReason,
            supportedChainIds: this.supportedChainIds,
            swapProviders: this.swapProviders,
            swapSignErrors: this.swapSignErrors,
            signAccountOpController: this.signAccountOpController,
            banners: this.banners
        };
    }
}
exports.SwapAndBridgeController = SwapAndBridgeController;
//# sourceMappingURL=swapAndBridge.js.map