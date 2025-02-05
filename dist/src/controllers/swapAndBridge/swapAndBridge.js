"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SwapAndBridgeController = exports.SwapAndBridgeFormStatus = void 0;
const tslib_1 = require("tslib");
/* eslint-disable no-await-in-loop */
const ethers_1 = require("ethers");
const uuid_1 = require("uuid");
const EmittableError_1 = tslib_1.__importDefault(require("../../classes/EmittableError"));
const SwapAndBridgeError_1 = tslib_1.__importDefault(require("../../classes/SwapAndBridgeError"));
const account_1 = require("../../libs/account/account");
const accountOp_1 = require("../../libs/accountOp/accountOp");
const banners_1 = require("../../libs/banners/banners");
const helpers_1 = require("../../libs/portfolio/helpers");
const swapAndBridge_1 = require("../../libs/swapAndBridge/swapAndBridge");
const swapAndBridgeErrorHumanizer_1 = require("../../libs/swapAndBridge/swapAndBridgeErrorHumanizer");
const amount_1 = require("../../libs/transfer/amount");
const api_1 = require("../../services/socket/api");
const constants_1 = require("../../services/socket/constants");
const validate_1 = require("../../services/validations/validate");
const formatDecimals_1 = tslib_1.__importDefault(require("../../utils/formatDecimals/formatDecimals"));
const formatters_1 = require("../../utils/numbers/formatters");
const wait_1 = tslib_1.__importDefault(require("../../utils/wait"));
const eventEmitter_1 = tslib_1.__importDefault(require("../eventEmitter/eventEmitter"));
const HARD_CODED_CURRENCY = 'usd';
const CONVERSION_PRECISION = 16;
const CONVERSION_PRECISION_POW = BigInt(10 ** CONVERSION_PRECISION);
const NETWORK_MISMATCH_MESSAGE = 'Swap & Bridge network configuration mismatch. Please try again or contact Ambire support.';
var SwapAndBridgeFormStatus;
(function (SwapAndBridgeFormStatus) {
    SwapAndBridgeFormStatus["Empty"] = "empty";
    SwapAndBridgeFormStatus["Invalid"] = "invalid";
    SwapAndBridgeFormStatus["FetchingRoutes"] = "fetching-routes";
    SwapAndBridgeFormStatus["NoRoutesFound"] = "no-routes-found";
    SwapAndBridgeFormStatus["InvalidRouteSelected"] = "invalid-route-selected";
    SwapAndBridgeFormStatus["ReadyToSubmit"] = "ready-to-submit";
})(SwapAndBridgeFormStatus = exports.SwapAndBridgeFormStatus || (exports.SwapAndBridgeFormStatus = {}));
const STATUS_WRAPPED_METHODS = {
    addToTokenByAddress: 'INITIAL'
};
const SUPPORTED_CHAINS_CACHE_THRESHOLD = 1000 * 60 * 60 * 24; // 1 day
const TO_TOKEN_LIST_CACHE_THRESHOLD = 1000 * 60 * 60 * 4; // 4 hours
const PROTOCOLS_WITH_CONTRACT_FEE_IN_NATIVE = [
    'stargate',
    'stargate-v2',
    'arbitrum-bridge',
    'zksync-native'
];
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
    #selectedAccount;
    #networks;
    #actions;
    #activity;
    #invite;
    #storage;
    #socketAPI;
    #activeRoutes = [];
    statuses = STATUS_WRAPPED_METHODS;
    updateQuoteStatus = 'INITIAL';
    #updateToTokenListThrottle = {
        time: 0,
        shouldReset: true,
        throttled: false
    };
    #updateQuoteId;
    #updateQuoteTimeout;
    updateToTokenListStatus = 'INITIAL';
    sessionIds = [];
    fromChainId = 1;
    fromSelectedToken = null;
    fromAmount = '';
    fromAmountInFiat = '';
    fromAmountFieldMode = 'token';
    toChainId = 1;
    toSelectedToken = null;
    quote = null;
    quoteRoutesStatuses = {};
    portfolioTokenList = [];
    isTokenListLoading = false;
    /**
     * Needed to efficiently manage and cache token lists for different chain
     * combinations (fromChainId and toChainId) without having to fetch them
     * repeatedly from the API. Moreover, this way tokens added to a list by
     * address are also cached for sometime.
     */
    #cachedToTokenLists = {};
    #toTokenList = [];
    /**
     * Similar to the `#cachedToTokenLists`, this helps in avoiding repeated API
     * calls to fetch the supported chains from our service provider.
     */
    #cachedSupportedChains = { lastFetched: 0, data: [] };
    routePriority = 'output';
    // Holds the initial load promise, so that one can wait until it completes
    #initialLoadPromise;
    #shouldDebounceFlags = {};
    constructor({ selectedAccount, networks, activity, socketAPI, storage, actions, invite }) {
        super();
        this.#selectedAccount = selectedAccount;
        this.#networks = networks;
        this.#activity = activity;
        this.#socketAPI = socketAPI;
        this.#storage = storage;
        this.#actions = actions;
        this.#invite = invite;
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.#initialLoadPromise = this.#load();
    }
    #emitUpdateIfNeeded() {
        const shouldSkipUpdate = 
        // No need to emit emit updates if there are no active sessions
        !this.sessionIds.length &&
            // but ALSO there are no active routes (otherwise, banners need the updates)
            !this.activeRoutes.length;
        if (shouldSkipUpdate)
            return;
        super.emitUpdate();
    }
    async #load() {
        await this.#networks.initialLoadPromise;
        await this.#selectedAccount.initialLoadPromise;
        this.activeRoutes = await this.#storage.get('swapAndBridgeActiveRoutes', []);
        this.#selectedAccount.onUpdate(() => {
            this.#debounceFunctionCallsOnSameTick('updateFormOnSelectedAccountUpdate', () => {
                if (this.#selectedAccount.portfolio.isAllReady) {
                    this.isTokenListLoading = false;
                    this.updatePortfolioTokenList(this.#selectedAccount.portfolio.tokens);
                    // To token list includes selected account portfolio tokens, it should get an update too
                    // eslint-disable-next-line @typescript-eslint/no-floating-promises
                    this.updateToTokenList(false);
                }
            });
        });
        this.#emitUpdateIfNeeded();
    }
    // The token in portfolio is the source of truth for the amount, it updates
    // on every balance (pending or anything) change.
    #getFromSelectedTokenInPortfolio = () => this.portfolioTokenList.find((t) => t.address === this.fromSelectedToken?.address &&
        t.networkId === this.fromSelectedToken?.networkId &&
        (0, swapAndBridge_1.getIsTokenEligibleForSwapAndBridge)(t));
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
    get formStatus() {
        if (this.isFormEmpty)
            return SwapAndBridgeFormStatus.Empty;
        if (this.validateFromAmount.message)
            return SwapAndBridgeFormStatus.Invalid;
        if (this.updateQuoteStatus !== 'INITIAL' && !this.quote)
            return SwapAndBridgeFormStatus.FetchingRoutes;
        if (!this.quote?.selectedRoute)
            return SwapAndBridgeFormStatus.NoRoutesFound;
        if (this.quote?.selectedRoute?.errorMessage)
            return SwapAndBridgeFormStatus.InvalidRouteSelected;
        return SwapAndBridgeFormStatus.ReadyToSubmit;
    }
    get validateFromAmount() {
        if (!this.fromSelectedToken)
            return { success: false, message: '' };
        if (!this.isFormEmpty &&
            !this.quote &&
            Object.values(this.quoteRoutesStatuses).some((val) => val.status === 'MIN_AMOUNT_NOT_MET')) {
            return {
                success: true,
                message: '🔔 A route was found for this pair but the minimum token amount was not met.'
            };
        }
        return (0, validate_1.validateSendTransferAmount)(this.fromAmount, Number(this.maxFromAmount), Number(this.maxFromAmountInFiat), this.fromSelectedToken);
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
    }
    get isSwitchFromAndToTokensEnabled() {
        if (!this.toSelectedToken)
            return false;
        if (!this.portfolioTokenList.length)
            return false;
        const toSelectedTokenNetwork = this.#networks.networks.find((n) => Number(n.chainId) === this.toChainId);
        return !!this.portfolioTokenList.find((token) => token.address === this.toSelectedToken.address &&
            token.networkId === toSelectedTokenNetwork.id);
    }
    get shouldEnableRoutesSelection() {
        return (!!this.quote &&
            !!this.quote.routes &&
            this.quote.routes.length > 1 &&
            this.updateQuoteStatus !== 'LOADING');
    }
    async initForm(sessionId) {
        await this.#initialLoadPromise;
        if (this.sessionIds.includes(sessionId))
            return;
        // reset only if there are no other instances opened/active
        if (!this.sessionIds.length) {
            this.resetForm(); // clear prev session form state
            // for each new session remove the completed activeRoutes from the previous session
            this.activeRoutes = this.activeRoutes.filter((r) => r.routeStatus !== 'completed');
            // remove activeRoutes errors from the previous session
            this.activeRoutes.forEach((r) => {
                if (r.routeStatus !== 'failed') {
                    // eslint-disable-next-line no-param-reassign
                    delete r.error;
                }
            });
            if (this.activeRoutes.length) {
                // Otherwise there may be an emitUpdate with [] tokens
                this.isTokenListLoading = true;
                // update the activeRoute.route prop for the new session
                this.activeRoutes.forEach((r) => {
                    // eslint-disable-next-line @typescript-eslint/no-floating-promises
                    this.updateActiveRoute(r.activeRouteId, undefined, true);
                });
            }
        }
        this.sessionIds.push(sessionId);
        // do not await the health status check to prevent UI freeze while fetching
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.#socketAPI.updateHealth();
        this.updatePortfolioTokenList(this.#selectedAccount.portfolio.tokens);
        this.isTokenListLoading = false;
        // Do not await on purpose as it's not critical for the controller state to be ready
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.#fetchSupportedChainsIfNeeded();
        this.#emitUpdateIfNeeded();
    }
    get isHealthy() {
        return this.#socketAPI.isHealthy;
    }
    #fetchSupportedChainsIfNeeded = async () => {
        const shouldNotReFetchSupportedChains = this.#cachedSupportedChains.data.length &&
            Date.now() - this.#cachedSupportedChains.lastFetched < SUPPORTED_CHAINS_CACHE_THRESHOLD;
        if (shouldNotReFetchSupportedChains)
            return;
        try {
            const supportedChainsResponse = await this.#socketAPI.getSupportedChains();
            this.#cachedSupportedChains = {
                lastFetched: Date.now(),
                data: supportedChainsResponse.filter((c) => c.sendingEnabled && c.receivingEnabled)
            };
            this.#emitUpdateIfNeeded();
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
    unloadScreen(sessionId) {
        this.sessionIds = this.sessionIds.filter((id) => id !== sessionId);
        if (!this.sessionIds.length) {
            this.resetForm(true);
            // Reset health to prevent the error state from briefly flashing
            // before the next health check resolves when the Swap & Bridge
            // screen is opened after a some time
            this.#socketAPI.resetHealth();
        }
    }
    updateForm(props) {
        const { fromAmount, fromAmountInFiat, fromAmountFieldMode, fromSelectedToken, toChainId, toSelectedToken, routePriority } = props;
        if (fromAmount !== undefined) {
            this.fromAmount = fromAmount;
            (() => {
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
                    const amountInFiatDecimals = fromAmount.split('.')[1]?.length || 0;
                    const { tokenPriceBigInt, tokenPriceDecimals } = (0, formatters_1.convertTokenPriceToBigInt)(tokenPrice);
                    // Convert the numbers to big int
                    const amountInFiatBigInt = (0, ethers_1.parseUnits)(fromAmount, amountInFiatDecimals);
                    this.fromAmount = (0, ethers_1.formatUnits)((amountInFiatBigInt * CONVERSION_PRECISION_POW) / tokenPriceBigInt, 
                    // Shift the decimal point by the number of decimals in the token price
                    amountInFiatDecimals + CONVERSION_PRECISION - tokenPriceDecimals);
                    return;
                }
                if (this.fromAmountFieldMode === 'token') {
                    this.fromAmount = fromAmount;
                    if (!this.fromSelectedToken)
                        return;
                    const sanitizedFieldValue = (0, amount_1.getSanitizedAmount)(fromAmount, this.fromSelectedToken.decimals);
                    // Convert the field value to big int
                    const formattedAmount = (0, ethers_1.parseUnits)(sanitizedFieldValue, this.fromSelectedToken.decimals);
                    if (!formattedAmount)
                        return;
                    const { tokenPriceBigInt, tokenPriceDecimals } = (0, formatters_1.convertTokenPriceToBigInt)(tokenPrice);
                    this.fromAmountInFiat = (0, ethers_1.formatUnits)(formattedAmount * tokenPriceBigInt, 
                    // Shift the decimal point by the number of decimals in the token price
                    this.fromSelectedToken.decimals + tokenPriceDecimals);
                }
            })();
        }
        if (fromAmountInFiat !== undefined) {
            this.fromAmountInFiat = fromAmountInFiat;
        }
        if (fromAmountFieldMode) {
            this.fromAmountFieldMode = fromAmountFieldMode;
        }
        if (fromSelectedToken) {
            const isFromNetworkChanged = this.fromSelectedToken?.networkId !== fromSelectedToken?.networkId;
            if (isFromNetworkChanged) {
                const network = this.#networks.networks.find((n) => n.id === fromSelectedToken.networkId);
                if (network) {
                    this.fromChainId = Number(network.chainId);
                    // defaults to swap after network change (should keep fromChainId and toChainId in sync after fromChainId update)
                    this.toChainId = Number(network.chainId);
                    // eslint-disable-next-line @typescript-eslint/no-floating-promises
                    this.updateToTokenList(true);
                }
            }
            const shouldResetFromTokenAmount = isFromNetworkChanged || this.fromSelectedToken?.address !== fromSelectedToken.address;
            if (shouldResetFromTokenAmount) {
                this.fromAmount = '';
                this.fromAmountInFiat = '';
                this.fromAmountFieldMode = 'token';
            }
            // Always update to reflect portfolio amount (or other props) changes
            this.fromSelectedToken = fromSelectedToken;
        }
        if (toChainId) {
            if (this.toChainId !== Number(toChainId)) {
                this.toChainId = Number(toChainId);
                // eslint-disable-next-line @typescript-eslint/no-floating-promises
                this.updateToTokenList(true);
            }
        }
        if (toSelectedToken) {
            this.toSelectedToken = toSelectedToken;
        }
        if (routePriority) {
            this.routePriority = routePriority;
            if (this.quote) {
                this.quote = null;
                this.quoteRoutesStatuses = {};
            }
        }
        this.updateQuote();
        this.#emitUpdateIfNeeded();
    }
    resetForm(shouldEmit) {
        this.fromChainId = 1;
        this.fromSelectedToken = null;
        this.fromAmount = '';
        this.fromAmountInFiat = '';
        this.fromAmountFieldMode = 'token';
        this.toChainId = 1;
        this.toSelectedToken = null;
        this.quote = null;
        this.quoteRoutesStatuses = {};
        this.portfolioTokenList = [];
        this.#toTokenList = [];
        if (shouldEmit)
            this.#emitUpdateIfNeeded();
    }
    updatePortfolioTokenList(nextPortfolioTokenList) {
        const tokens = nextPortfolioTokenList.filter(swapAndBridge_1.getIsTokenEligibleForSwapAndBridge);
        this.portfolioTokenList = (0, swapAndBridge_1.sortPortfolioTokenList)(
        // Filtering out hidden tokens here means: 1) They won't be displayed in
        // the "From" token list (`this.portfolioTokenList`) and 2) They won't be
        // added to the "Receive" token list as additional tokens from portfolio,
        // BUT 3) They will appear in the "Receive" if they are present in service
        // provider's to token list. This is the desired behavior.
        tokens.filter((t) => !t.flags.isHidden));
        const fromSelectedTokenInNextPortfolio = this.portfolioTokenList.find((t) => t.address === this.fromSelectedToken?.address &&
            t.networkId === this.fromSelectedToken?.networkId);
        const shouldUpdateFromSelectedToken = !this.fromSelectedToken || // initial (default) state
            // May happen if selected account gets changed or the token gets send away in the meantime
            !fromSelectedTokenInNextPortfolio ||
            // May happen if user receives or sends the token in the meantime
            fromSelectedTokenInNextPortfolio.amount !== this.fromSelectedToken?.amount;
        if (shouldUpdateFromSelectedToken) {
            this.updateForm({
                fromSelectedToken: fromSelectedTokenInNextPortfolio || this.portfolioTokenList[0] || null
            });
        }
        else {
            this.#emitUpdateIfNeeded();
        }
    }
    async updateToTokenList(shouldReset, addressToSelect) {
        const now = Date.now();
        const timeSinceLastCall = now - this.#updateToTokenListThrottle.time;
        if (timeSinceLastCall <= 500) {
            this.#updateToTokenListThrottle.shouldReset = shouldReset;
            this.#updateToTokenListThrottle.addressToSelect = addressToSelect;
            if (!this.#updateToTokenListThrottle.throttled) {
                this.#updateToTokenListThrottle.throttled = true;
                await (0, wait_1.default)(500 - timeSinceLastCall);
                this.#updateToTokenListThrottle.throttled = false;
                await this.updateToTokenList(this.#updateToTokenListThrottle.shouldReset, this.#updateToTokenListThrottle.addressToSelect);
            }
            return;
        }
        this.updateToTokenListStatus = 'LOADING';
        this.#updateToTokenListThrottle.time = now;
        if (!this.fromChainId || !this.toChainId)
            return;
        if (shouldReset) {
            this.#toTokenList = [];
            this.toSelectedToken = null;
            this.#emitUpdateIfNeeded();
        }
        try {
            const toTokenListInCache = this.#toTokenListKey && this.#cachedToTokenLists[this.#toTokenListKey];
            let upToDateToTokenList = toTokenListInCache?.data || [];
            const shouldFetchTokenList = !upToDateToTokenList.length ||
                now - (toTokenListInCache?.lastFetched || 0) >= TO_TOKEN_LIST_CACHE_THRESHOLD;
            if (shouldFetchTokenList) {
                upToDateToTokenList = await this.#socketAPI.getToTokenList({
                    fromChainId: this.fromChainId,
                    toChainId: this.toChainId
                });
                if (this.#toTokenListKey)
                    this.#cachedToTokenLists[this.#toTokenListKey] = {
                        lastFetched: now,
                        data: upToDateToTokenList
                    };
            }
            const toTokenNetwork = this.#networks.networks.find((n) => Number(n.chainId) === this.toChainId);
            // should never happen
            if (!toTokenNetwork)
                throw new SwapAndBridgeError_1.default(NETWORK_MISMATCH_MESSAGE);
            const additionalTokensFromPortfolio = this.portfolioTokenList
                .filter((t) => t.networkId === toTokenNetwork.id)
                .filter((token) => !upToDateToTokenList.some((t) => t.address === token.address))
                .map((t) => (0, swapAndBridge_1.convertPortfolioTokenToSocketAPIToken)(t, Number(toTokenNetwork.chainId)));
            this.#toTokenList = (0, swapAndBridge_1.sortTokenListResponse)([...upToDateToTokenList, ...additionalTokensFromPortfolio], this.portfolioTokenList.filter((t) => t.networkId === toTokenNetwork.id));
            if (!this.toSelectedToken) {
                if (addressToSelect) {
                    const token = this.#toTokenList.find((t) => t.address === addressToSelect);
                    if (token) {
                        this.updateForm({ toSelectedToken: token });
                        this.updateToTokenListStatus = 'INITIAL';
                        this.#emitUpdateIfNeeded();
                        return;
                    }
                }
            }
        }
        catch (error) {
            const { message } = (0, swapAndBridgeErrorHumanizer_1.getHumanReadableSwapAndBridgeError)(error);
            this.emitError({ error, level: 'major', message });
        }
        this.updateToTokenListStatus = 'INITIAL';
        this.#emitUpdateIfNeeded();
    }
    get toTokenList() {
        const isSwapping = this.fromChainId === this.toChainId;
        if (isSwapping) {
            // Swaps between same "from" and "to" tokens are not feasible, filter them out
            return this.#toTokenList.filter((t) => t.address !== this.fromSelectedToken?.address);
        }
        return this.#toTokenList;
    }
    async #addToTokenByAddress(address) {
        if (!this.toChainId)
            return; // should never happen
        if (!(0, ethers_1.isAddress)(address))
            return; // no need to attempt with invalid addresses
        const isAlreadyInTheList = this.#toTokenList.some((t) => t.address === address);
        if (isAlreadyInTheList)
            return;
        let token;
        try {
            token = await this.#socketAPI.getToken({ address, chainId: this.toChainId });
            if (!token)
                throw new SwapAndBridgeError_1.default('Token with this address is not supported by our service provider.');
        }
        catch (error) {
            const { message } = (0, swapAndBridgeErrorHumanizer_1.getHumanReadableSwapAndBridgeError)(error);
            throw new EmittableError_1.default({ error, level: 'minor', message });
        }
        if (this.#toTokenListKey)
            // Cache for sometime the tokens added by address
            this.#cachedToTokenLists[this.#toTokenListKey]?.data.push(token);
        const toTokenNetwork = this.#networks.networks.find((n) => Number(n.chainId) === this.toChainId);
        // should never happen
        if (!toTokenNetwork) {
            const error = new SwapAndBridgeError_1.default(NETWORK_MISMATCH_MESSAGE);
            throw new EmittableError_1.default({ error, level: 'minor', message: error?.message });
        }
        const nextTokenList = [...this.#toTokenList, token];
        this.#toTokenList = (0, swapAndBridge_1.sortTokenListResponse)(nextTokenList, this.portfolioTokenList.filter((t) => t.networkId === toTokenNetwork.id));
        this.#emitUpdateIfNeeded();
        return token;
    }
    addToTokenByAddress = async (address) => this.withStatus('addToTokenByAddress', () => this.#addToTokenByAddress(address), true);
    async switchFromAndToTokens() {
        if (!this.isSwitchFromAndToTokensEnabled)
            return;
        const currentFromSelectedToken = { ...this.fromSelectedToken };
        const toSelectedTokenNetwork = this.#networks.networks.find((n) => Number(n.chainId) === this.toChainId);
        this.fromSelectedToken = this.portfolioTokenList.find((token) => token.address === this.toSelectedToken.address &&
            token.networkId === toSelectedTokenNetwork.id);
        this.fromAmount = '' // Reset fromAmount as it may no longer be valid for the new fromSelectedToken
        ;
        [this.fromChainId, this.toChainId] = [this.toChainId, this.fromChainId];
        await this.updateToTokenList(true, currentFromSelectedToken.address);
    }
    async updateQuote(options = {
        skipQuoteUpdateOnSameValues: true,
        skipPreviousQuoteRemoval: false,
        skipStatusUpdate: false
    }) {
        const quoteId = (0, uuid_1.v4)();
        this.#updateQuoteId = quoteId;
        const updateQuoteFunction = async () => {
            if (!this.#selectedAccount.account)
                return;
            if (!this.fromAmount)
                return;
            const sanitizedFromAmount = (0, amount_1.getSanitizedAmount)(this.fromAmount, this.fromSelectedToken.decimals);
            const bigintFromAmount = (0, ethers_1.parseUnits)(sanitizedFromAmount, this.fromSelectedToken.decimals);
            if (this.quote) {
                const isFromAmountSame = this.quote.selectedRoute.fromAmount === bigintFromAmount.toString();
                const isFromNetworkSame = this.quote.fromChainId === this.fromChainId;
                const isFromAddressSame = this.quote.fromAsset.address === this.fromSelectedToken.address;
                const isToNetworkSame = this.quote.toChainId === this.toChainId;
                const isToAddressSame = this.quote.toAsset.address === this.toSelectedToken.address;
                if (options.skipQuoteUpdateOnSameValues &&
                    isFromAmountSame &&
                    isFromNetworkSame &&
                    isFromAddressSame &&
                    isToNetworkSame &&
                    isToAddressSame) {
                    return;
                }
            }
            if (!options.skipPreviousQuoteRemoval) {
                if (this.quote)
                    this.quote = null;
                this.quoteRoutesStatuses = {};
                this.#emitUpdateIfNeeded();
            }
            try {
                const quoteResult = await this.#socketAPI.quote({
                    fromChainId: this.fromChainId,
                    fromTokenAddress: this.fromSelectedToken.address,
                    toChainId: this.toChainId,
                    toTokenAddress: this.toSelectedToken.address,
                    fromAmount: bigintFromAmount,
                    userAddress: this.#selectedAccount.account.addr,
                    isSmartAccount: (0, account_1.isSmartAccount)(this.#selectedAccount.account),
                    sort: this.routePriority,
                    isOG: this.#invite.isOG
                });
                if (quoteId !== this.#updateQuoteId)
                    return;
                if (this.#getIsFormValidToFetchQuote() &&
                    quoteResult &&
                    quoteResult?.routes?.[0] &&
                    quoteResult.fromChainId === this.fromChainId &&
                    quoteResult.toChainId === this.toChainId &&
                    quoteResult.toAsset.address === this.toSelectedToken?.address) {
                    let routeToSelect;
                    let routeToSelectSteps;
                    let routes = quoteResult.routes || [];
                    try {
                        routes = routes.map((route) => {
                            if (!route.userTxs)
                                return route;
                            const bridgeTx = route.userTxs.find((tx) => (0, swapAndBridge_1.getIsBridgeTxn)(tx.userTxType));
                            if (!bridgeTx)
                                return route;
                            const bridgeStep = bridgeTx.steps.find((s) => s.type === 'bridge');
                            if (!bridgeStep)
                                return route;
                            if (bridgeStep.protocolFees.amount === '0')
                                return route;
                            const normalizedProtocolFeeToken = (0, api_1.normalizeIncomingSocketToken)(bridgeStep.protocolFees.asset);
                            const doesProtocolRequireExtraContractFeeInNative = PROTOCOLS_WITH_CONTRACT_FEE_IN_NATIVE.includes(bridgeStep.protocol.name) &&
                                // When other tokens than the native ones are being bridged,
                                // Socket API takes the fee directly from the "From" amount.
                                normalizedProtocolFeeToken.address === constants_1.ZERO_ADDRESS;
                            if (!doesProtocolRequireExtraContractFeeInNative)
                                return route;
                            const protocolFeeTokenNetwork = this.#networks.networks.find((n) => Number(n.chainId) === normalizedProtocolFeeToken.chainId);
                            const isTokenToPayFeeWithTheSameAsFromToken = this.fromSelectedToken?.address === normalizedProtocolFeeToken.address &&
                                this.fromChainId === normalizedProtocolFeeToken.chainId;
                            const tokenToPayFeeWith = this.portfolioTokenList.find((t) => {
                                return (t.address === normalizedProtocolFeeToken.address &&
                                    t.networkId === protocolFeeTokenNetwork.id);
                            });
                            const protocolFeeTokenDecimals = bridgeStep.protocolFees.asset.decimals;
                            const portfolioTokenToPayFeeWithDecimals = tokenToPayFeeWith
                                ? tokenToPayFeeWith.decimals
                                : protocolFeeTokenDecimals;
                            const fromAmountNumber = Number(this.fromAmount);
                            const fromAmountScaledToTokenToPayFeeWithDecimals = BigInt(Math.round(fromAmountNumber * 10 ** portfolioTokenToPayFeeWithDecimals));
                            const tokenToPayFeeWithScaledToPortfolioTokenToPayFeeWithDecimals = tokenToPayFeeWith
                                ? // Scale tokenToPayFeeWith to the same decimals as portfolioTokenToPayFeeWithDecimals
                                    tokenToPayFeeWith.amount *
                                        BigInt(10 ** (protocolFeeTokenDecimals - portfolioTokenToPayFeeWithDecimals))
                                : BigInt(0);
                            const availableAfterSubtractionScaledToPortfolioTokenToPayFeeWithDecimals = isTokenToPayFeeWithTheSameAsFromToken
                                ? tokenToPayFeeWithScaledToPortfolioTokenToPayFeeWithDecimals -
                                    fromAmountScaledToTokenToPayFeeWithDecimals
                                : tokenToPayFeeWithScaledToPortfolioTokenToPayFeeWithDecimals;
                            const protocolFeesAmountScaledToPortfolioTokenToPayFeeWithDecimals = BigInt(Math.round(Number(bridgeStep.protocolFees.amount) *
                                10 ** (portfolioTokenToPayFeeWithDecimals - protocolFeeTokenDecimals)));
                            const hasEnoughAmountToPayFee = availableAfterSubtractionScaledToPortfolioTokenToPayFeeWithDecimals >=
                                protocolFeesAmountScaledToPortfolioTokenToPayFeeWithDecimals;
                            if (!hasEnoughAmountToPayFee) {
                                const protocolName = bridgeStep.protocol.displayName;
                                const insufficientTokenSymbol = bridgeStep.protocolFees.asset.symbol;
                                const insufficientTokenNetwork = protocolFeeTokenNetwork.name;
                                const insufficientAssetAmount = (0, ethers_1.formatUnits)(bridgeStep.protocolFees.amount, bridgeStep.protocolFees.asset.decimals);
                                const insufficientAssetAmountInUsd = (0, formatDecimals_1.default)(bridgeStep.protocolFees.feesInUsd, 'value');
                                // Trick to show the error message on the UI, as the API doesn't handle this
                                // eslint-disable-next-line no-param-reassign
                                route.errorMessage = `Insufficient ${insufficientTokenSymbol} on ${insufficientTokenNetwork}. You need ${insufficientAssetAmount} ${insufficientTokenSymbol} (${insufficientAssetAmountInUsd}) on ${insufficientTokenNetwork} to cover the ${protocolName} protocol fee for this route.`;
                            }
                            return route;
                        });
                        routes = routes.sort((a, b) => Number(!!a.errorMessage) - Number(!!b.errorMessage));
                    }
                    catch (error) {
                        // if the filtration fails for some reason continue with the original routes
                        // array without interrupting the rest of the logic
                        console.error(error);
                    }
                    if (!routes.length) {
                        this.quote = null;
                        return;
                    }
                    const alreadySelectedRoute = routes.find((nextRoute) => {
                        if (!this.quote)
                            return false;
                        // Because we only have routes with unique bridges (bridging case)
                        const selectedRouteUsedBridge = this.quote.selectedRoute.usedBridgeNames?.[0];
                        if (selectedRouteUsedBridge)
                            return nextRoute.usedBridgeNames?.[0] === selectedRouteUsedBridge;
                        // Assuming to only have routes with unique DEXes (swapping case)
                        const selectedRouteUsedDex = this.quote.selectedRoute.usedDexName;
                        if (selectedRouteUsedDex)
                            return nextRoute.usedDexName === selectedRouteUsedDex;
                        return false; // should never happen, but just in case of bad data
                    });
                    if (alreadySelectedRoute) {
                        routeToSelect = alreadySelectedRoute;
                        routeToSelectSteps = (0, swapAndBridge_1.getQuoteRouteSteps)(alreadySelectedRoute.userTxs);
                    }
                    else {
                        const bestRoute = this.routePriority === 'output'
                            ? routes[0] // API returns highest output first
                            : routes[routes.length - 1]; // API returns fastest... last
                        routeToSelect = bestRoute;
                        routeToSelectSteps = (0, swapAndBridge_1.getQuoteRouteSteps)(bestRoute.userTxs);
                    }
                    this.quote = {
                        fromAsset: quoteResult.fromAsset,
                        fromChainId: quoteResult.fromChainId,
                        toAsset: quoteResult.toAsset,
                        toChainId: quoteResult.toChainId,
                        selectedRoute: routeToSelect,
                        selectedRouteSteps: routeToSelectSteps,
                        routes
                    };
                }
                this.quoteRoutesStatuses = quoteResult.bridgeRouteErrors || {};
            }
            catch (error) {
                const { message } = (0, swapAndBridgeErrorHumanizer_1.getHumanReadableSwapAndBridgeError)(error);
                this.emitError({ error, level: 'major', message });
            }
        };
        if (!this.#getIsFormValidToFetchQuote()) {
            if (this.quote || this.quoteRoutesStatuses) {
                this.quote = null;
                this.quoteRoutesStatuses = {};
                this.#emitUpdateIfNeeded();
            }
            return;
        }
        let nextTimeout = 400; // timeout when there is no pending quote update
        if (this.#updateQuoteTimeout) {
            nextTimeout = 1000; // timeout when there is a pending quote update
            clearTimeout(this.#updateQuoteTimeout);
            this.#updateQuoteTimeout = undefined;
        }
        if (!options.skipStatusUpdate && !this.quote) {
            this.updateQuoteStatus = 'LOADING';
            this.#emitUpdateIfNeeded();
        }
        this.#updateQuoteTimeout = setTimeout(async () => {
            if (!options.skipStatusUpdate && !!this.quote) {
                this.updateQuoteStatus = 'LOADING';
                this.#emitUpdateIfNeeded();
            }
            await updateQuoteFunction();
            if (quoteId !== this.#updateQuoteId)
                return;
            this.updateQuoteStatus = 'INITIAL';
            this.#emitUpdateIfNeeded();
            clearTimeout(this.#updateQuoteTimeout);
            this.#updateQuoteTimeout = undefined;
        }, nextTimeout);
    }
    async getRouteStartUserTx() {
        if (this.formStatus !== SwapAndBridgeFormStatus.ReadyToSubmit)
            return;
        try {
            const routeResult = await this.#socketAPI.startRoute({
                fromChainId: this.quote.fromChainId,
                fromAssetAddress: this.quote.fromAsset.address,
                toChainId: this.quote.toChainId,
                toAssetAddress: this.quote.toAsset.address,
                route: this.quote.selectedRoute
            });
            return routeResult;
        }
        catch (error) {
            const { message } = (0, swapAndBridgeErrorHumanizer_1.getHumanReadableSwapAndBridgeError)(error);
            throw new EmittableError_1.default({ error, level: 'minor', message });
        }
    }
    async getNextRouteUserTx(activeRouteId) {
        try {
            const route = await this.#socketAPI.getNextRouteUserTx(activeRouteId);
            return route;
        }
        catch (error) {
            const { message } = (0, swapAndBridgeErrorHumanizer_1.getHumanReadableSwapAndBridgeError)(error);
            throw new EmittableError_1.default({ error, level: 'minor', message });
        }
    }
    async checkForNextUserTxForActiveRoutes() {
        await this.#initialLoadPromise;
        const fetchAndUpdateRoute = async (activeRoute) => {
            let status = null;
            const broadcastedButNotConfirmed = this.#activity.broadcastedButNotConfirmed.find((op) => op.calls.some((c) => c.fromUserRequestId === activeRoute.activeRouteId));
            // call getRouteStatus only after the transaction has processed
            if (broadcastedButNotConfirmed)
                return;
            if (activeRoute.routeStatus === 'completed')
                return;
            try {
                status = await this.#socketAPI.getRouteStatus({
                    activeRouteId: activeRoute.activeRouteId,
                    userTxIndex: activeRoute.userTxIndex,
                    txHash: activeRoute.userTxHash
                });
            }
            catch (e) {
                const { message } = (0, swapAndBridgeErrorHumanizer_1.getHumanReadableSwapAndBridgeError)(e);
                this.updateActiveRoute(activeRoute.activeRouteId, { error: message });
                return;
            }
            const route = this.activeRoutes.find((r) => r.activeRouteId === activeRoute.activeRouteId);
            if (route?.error) {
                this.updateActiveRoute(activeRoute.activeRouteId, {
                    error: undefined
                });
            }
            if (status === 'completed') {
                this.updateActiveRoute(activeRoute.activeRouteId, {
                    routeStatus: 'completed',
                    error: undefined
                }, true);
            }
            else if (status === 'ready') {
                this.updateActiveRoute(activeRoute.activeRouteId, {
                    routeStatus: 'ready',
                    error: undefined
                }, true);
            }
        };
        await Promise.all(this.activeRoutesInProgress.map(async (route) => {
            await fetchAndUpdateRoute(route);
        }));
    }
    selectRoute(route) {
        if (!this.quote || !this.quote.routes.length || !this.shouldEnableRoutesSelection)
            return;
        if (![
            SwapAndBridgeFormStatus.ReadyToSubmit,
            SwapAndBridgeFormStatus.InvalidRouteSelected
        ].includes(this.formStatus))
            return;
        this.quote.selectedRoute = route;
        this.quote.selectedRouteSteps = (0, swapAndBridge_1.getQuoteRouteSteps)(route.userTxs);
        this.#emitUpdateIfNeeded();
    }
    async addActiveRoute(activeRoute) {
        await this.#initialLoadPromise;
        try {
            const route = await this.#socketAPI.updateActiveRoute(activeRoute.activeRouteId);
            this.activeRoutes.push({
                ...activeRoute,
                routeStatus: 'ready',
                userTxHash: null,
                route
            });
            // Preserve key form states instead of resetting the whole form to enhance UX and reduce confusion.
            // After form submission, maintain the state for fromSelectedToken, fromChainId, and toChainId,
            // while resetting all other state related to the form.
            this.fromAmount = '';
            this.fromAmountInFiat = '';
            this.fromAmountFieldMode = 'token';
            this.toSelectedToken = null;
            this.quote = null;
            this.quoteRoutesStatuses = {};
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
        if (activeRouteIndex !== -1) {
            if (forceUpdateRoute) {
                // eslint-disable-next-line @typescript-eslint/no-floating-promises
                ;
                (async () => {
                    let route = currentActiveRoutes[activeRouteIndex].route;
                    route = await this.#socketAPI.updateActiveRoute(activeRouteId);
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
            this.activeRoutes = currentActiveRoutes;
            this.#emitUpdateIfNeeded();
        }
    }
    removeActiveRoute(activeRouteId) {
        this.activeRoutes = this.activeRoutes.filter((r) => r.activeRouteId !== activeRouteId);
        // Purposely not using `this.#emitUpdateIfNeeded()` here, as this should always emit to update banners
        this.emitUpdate();
    }
    // update active route if needed on SubmittedAccountOp update
    handleUpdateActiveRouteOnSubmittedAccountOpStatusUpdate(op) {
        op.calls.forEach((call) => {
            this.#handleActiveRouteBroadcastedTransaction(call.fromUserRequestId, op.status);
            this.#handleActiveRouteBroadcastedApproval(call.fromUserRequestId, op.status);
            this.#handleActiveRoutesWithReadyApproval(call.fromUserRequestId, op.status);
            this.#handleUpdateActiveRoutesUserTxId(call.fromUserRequestId, op.txnId);
            this.#handleActiveRoutesCompleted(call.fromUserRequestId, op.status);
        });
    }
    #handleActiveRouteBroadcastedTransaction(fromUserRequestId, opStatus) {
        if (opStatus !== accountOp_1.AccountOpStatus.BroadcastedButNotConfirmed)
            return;
        const activeRoute = this.activeRoutes.find((r) => r.activeRouteId === fromUserRequestId);
        if (!activeRoute)
            return;
        this.updateActiveRoute(activeRoute.activeRouteId, { routeStatus: 'in-progress' });
    }
    #handleActiveRouteBroadcastedApproval(fromUserRequestId, opStatus) {
        if (opStatus !== accountOp_1.AccountOpStatus.BroadcastedButNotConfirmed)
            return;
        const activeRoute = this.activeRoutes.find((r) => `${r.activeRouteId}-approval` === fromUserRequestId);
        if (!activeRoute)
            return;
        this.updateActiveRoute(activeRoute.activeRouteId, {
            routeStatus: 'waiting-approval-to-resolve'
        });
    }
    #handleActiveRoutesWithReadyApproval(fromUserRequestId, opStatus) {
        const activeRouteWaitingApproval = this.activeRoutes.find((r) => r.routeStatus === 'waiting-approval-to-resolve' &&
            `${r.activeRouteId}-approval` === fromUserRequestId);
        if (!activeRouteWaitingApproval)
            return;
        if (opStatus === accountOp_1.AccountOpStatus.Success) {
            this.updateActiveRoute(activeRouteWaitingApproval.activeRouteId, {
                routeStatus: 'ready'
            });
        }
        if (opStatus === accountOp_1.AccountOpStatus.Failure || opStatus === accountOp_1.AccountOpStatus.Rejected) {
            const errorMessage = opStatus === accountOp_1.AccountOpStatus.Rejected
                ? 'The approval was rejected but you can try to sign it again'
                : 'The approval failed but you can try to sign it again';
            this.updateActiveRoute(activeRouteWaitingApproval.activeRouteId, {
                routeStatus: 'ready',
                error: errorMessage
            });
        }
    }
    #handleUpdateActiveRoutesUserTxId(fromUserRequestId, opTxnId) {
        const activeRoute = this.activeRoutes.find((r) => r.activeRouteId === fromUserRequestId);
        if (!activeRoute)
            return;
        if (opTxnId && !activeRoute.userTxHash) {
            this.updateActiveRoute(activeRoute.activeRouteId, { userTxHash: opTxnId });
        }
    }
    #handleActiveRoutesCompleted(fromUserRequestId, opStatus) {
        const activeRoute = this.activeRoutes.find((r) => r.activeRouteId === fromUserRequestId);
        if (!activeRoute)
            return;
        let shouldUpdateActiveRouteStatus = false;
        if (activeRoute.route.fromChainId === activeRoute.route.toChainId)
            shouldUpdateActiveRouteStatus = true;
        if (activeRoute.route.currentUserTxIndex + 1 === activeRoute.route.totalUserTx) {
            const tx = activeRoute.route.userTxs[activeRoute.route.currentUserTxIndex];
            if (!tx)
                return;
            if (tx.userTxType === 'dex-swap')
                shouldUpdateActiveRouteStatus = true;
        }
        if (!shouldUpdateActiveRouteStatus)
            return;
        if (opStatus === accountOp_1.AccountOpStatus.Success) {
            this.updateActiveRoute(activeRoute.activeRouteId, { routeStatus: 'completed' });
        }
        // If the transaction fails, update the status to "ready" to allow the user to sign it again
        if (opStatus === accountOp_1.AccountOpStatus.Failure || opStatus === accountOp_1.AccountOpStatus.Rejected) {
            const errorMessage = opStatus === accountOp_1.AccountOpStatus.Rejected
                ? 'The transaction was rejected but you can try to sign it again'
                : 'The transaction failed but you can try to sign it again';
            this.updateActiveRoute(activeRoute.activeRouteId, {
                routeStatus: 'ready',
                error: errorMessage
            });
        }
    }
    onAccountChange() {
        this.portfolioTokenList = [];
        this.isTokenListLoading = true;
        this.#emitUpdateIfNeeded();
    }
    #getIsFormValidToFetchQuote() {
        return (this.fromChainId &&
            this.toChainId &&
            this.fromAmount &&
            this.fromSelectedToken &&
            this.toSelectedToken &&
            this.validateFromAmount.success);
    }
    get banners() {
        if (!this.#selectedAccount.account)
            return [];
        const activeRoutesForSelectedAccount = (0, swapAndBridge_1.getActiveRoutesForAccount)(this.#selectedAccount.account.addr, this.activeRoutes);
        const accountOpActions = this.#actions.visibleActionsQueue.filter(({ type }) => type === 'accountOp');
        // Swap banners aren't generated because swaps are completed instantly,
        // thus the activity banner on broadcast is sufficient
        return (0, banners_1.getBridgeBanners)(activeRoutesForSelectedAccount, accountOpActions, this.#networks.networks);
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
    toJSON() {
        return {
            ...this,
            ...super.toJSON(),
            toTokenList: this.toTokenList,
            maxFromAmount: this.maxFromAmount,
            maxFromAmountInFiat: this.maxFromAmountInFiat,
            validateFromAmount: this.validateFromAmount,
            isFormEmpty: this.isFormEmpty,
            formStatus: this.formStatus,
            activeRoutesInProgress: this.activeRoutesInProgress,
            activeRoutes: this.activeRoutes,
            isSwitchFromAndToTokensEnabled: this.isSwitchFromAndToTokensEnabled,
            banners: this.banners,
            isHealthy: this.isHealthy,
            shouldEnableRoutesSelection: this.shouldEnableRoutesSelection,
            supportedChainIds: this.supportedChainIds
        };
    }
}
exports.SwapAndBridgeController = SwapAndBridgeController;
//# sourceMappingURL=swapAndBridge.js.map