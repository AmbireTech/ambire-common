"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UniswapAPI = void 0;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const networks_1 = require("../../consts/networks");
const IERC20_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/IERC20.json"));
const SwapAndBridgeProviderApiError_1 = tslib_1.__importDefault(require("../../classes/SwapAndBridgeProviderApiError"));
const helper_1 = require("../../controllers/signAccountOp/helper");
const fee_1 = require("../../libs/swapAndBridge/fee");
const swapAndBridge_1 = require("../../libs/swapAndBridge/swapAndBridge");
const api_1 = require("../across/api");
const constants_1 = require("./constants");
const erc20Interface = new ethers_1.Interface(IERC20_json_1.default.abi);
const GATEWAY_TIMEOUT_STATUS = 504;
const isAcrossBridgeQuote = (quote) => quote.exclusiveRelayer !== undefined &&
    quote.exclusivityDeadline !== undefined &&
    quote.fillDeadline !== undefined;
const normalizeAddress = (address) => address.toLowerCase() === ethers_1.ZeroAddress.toLowerCase() ? ethers_1.ZeroAddress : (0, ethers_1.getAddress)(address);
const getUniswapProtocol = (routing) => ({
    name: routing === 'BRIDGE' ? 'Uniswap Bridge' : 'Uniswap',
    displayName: routing === 'BRIDGE' ? 'Uniswap Bridge' : 'Uniswap',
    icon: ''
});
const getMinAmountOut = (quote, userAddress) => {
    const userOutput = quote.aggregatedOutputs?.find((output) => output.recipient.toLowerCase() === userAddress.toLowerCase() &&
        normalizeAddress(output.token) === normalizeAddress(quote.output.token));
    return userOutput?.minAmount || quote.output.amount;
};
const getUserOutputAmount = (quote, userAddress) => {
    const userOutput = quote.aggregatedOutputs?.find((output) => output.recipient.toLowerCase() === userAddress.toLowerCase() &&
        normalizeAddress(output.token) === normalizeAddress(quote.output.token));
    return userOutput?.amount || quote.output.amount;
};
const getUsdPriceFromAsset = (asset) => {
    const priceUSD = Number(asset.priceUSD || 0);
    if (priceUSD > 0)
        return priceUSD;
    const priceInUsd = asset.priceIn?.find?.((price) => price.baseCurrency === 'usd')?.price;
    if (Number(priceInUsd) > 0)
        return Number(priceInUsd);
    return 0;
};
const getOutputValueInUsd = ({ inputValueInUsd, quote, toAsset, toAmount, userAddress }) => {
    const toTokenPriceUSD = getUsdPriceFromAsset(toAsset);
    if (toTokenPriceUSD) {
        return {
            outputValueInUsd: Number((0, ethers_1.formatUnits)(toAmount, toAsset.decimals)) * toTokenPriceUSD,
            toTokenPriceUSD
        };
    }
    if (!inputValueInUsd) {
        return {
            outputValueInUsd: 0,
            toTokenPriceUSD: 0
        };
    }
    const userOutputBps = quote.aggregatedOutputs?.find((output) => output.recipient.toLowerCase() === userAddress.toLowerCase() &&
        normalizeAddress(output.token) === normalizeAddress(quote.output.token))?.bps || 10000;
    const priceImpactMultiplier = Math.max(0, 1 - (quote.priceImpact || 0) / 100);
    return {
        outputValueInUsd: inputValueInUsd * (userOutputBps / 10000) * priceImpactMultiplier,
        toTokenPriceUSD: 0
    };
};
const normalizeUniswapRouteToSwapAndBridgeRoute = ({ response, fromAsset, originalFromAsset, toAsset, fromChainId, toChainId, userAddress, withConvenienceFee, feeExemptionReason }) => {
    const quote = response.quote;
    const fromAmount = quote.input.amount;
    const toAmount = getUserOutputAmount(quote, userAddress);
    const serviceTime = quote.estimatedFillTimeMs ? Math.ceil(quote.estimatedFillTimeMs / 1000) : 0;
    const protocol = getUniswapProtocol(response.routing);
    const minAmountOut = getMinAmountOut(quote, userAddress);
    const inputValueInUsd = originalFromAsset
        ? Number((0, helper_1.getTokenUsdAmount)(originalFromAsset, BigInt(fromAmount)) || 0)
        : 0;
    const { outputValueInUsd, toTokenPriceUSD } = getOutputValueInUsd({
        inputValueInUsd,
        quote,
        toAsset,
        toAmount,
        userAddress
    });
    const userTx = {
        userTxIndex: 0,
        fromAsset,
        toAsset,
        chainId: fromChainId,
        fromAmount,
        toAmount,
        swapSlippage: quote.slippage,
        serviceTime,
        protocol,
        minAmountOut
    };
    const step = {
        ...userTx,
        type: 'swap'
    };
    return {
        providerId: 'uniswap',
        routeId: quote.quoteId || response.requestId,
        fromChainId,
        toChainId,
        userAddress,
        isOnlySwapRoute: fromChainId === toChainId,
        fromAmount,
        toAmount,
        currentUserTxIndex: 0,
        ...(fromChainId === toChainId
            ? { usedDexName: 'Uniswap' }
            : { usedBridgeNames: [isAcrossBridgeQuote(quote) ? 'across' : 'uniswap'] }),
        userTxs: [userTx],
        steps: [step],
        inputValueInUsd,
        outputValueInUsd,
        outputValueAfterGasInUsd: quote.gasFeeUSD === undefined ? undefined : outputValueInUsd - Number(quote.gasFeeUSD),
        serviceTime,
        rawRoute: response,
        sender: userAddress,
        toToken: {
            address: toAsset.address,
            chainId: toAsset.chainId,
            decimals: toAsset.decimals,
            logoURI: toAsset.icon || '',
            name: toAsset.name,
            priceUSD: toTokenPriceUSD ? toTokenPriceUSD.toString() : undefined,
            symbol: toAsset.symbol
        },
        disabled: false,
        withConvenienceFee,
        feeExemptionReason
    };
};
const parseApprovalSpender = (approval, fallback) => {
    if (!approval?.data)
        return fallback;
    try {
        const decoded = erc20Interface.decodeFunctionData('approve', approval.data);
        return (0, ethers_1.getAddress)(decoded[0]);
    }
    catch {
        return fallback;
    }
};
class UniswapAPI {
    id = 'uniswap';
    name = 'Uniswap';
    #fetch;
    #acrossAPI;
    #headers;
    #requestTimeoutMs = 15000;
    isHealthy = null;
    supportedChains = null;
    constructor({ fetch, apiKey }) {
        this.#fetch = fetch;
        this.#acrossAPI = new api_1.AcrossAPI({ fetch });
        this.#headers = {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'x-permit2-disabled': 'true'
        };
    }
    async getHealth() {
        return true;
    }
    async updateHealth() {
        this.isHealthy = await this.getHealth();
    }
    resetHealth() {
        this.isHealthy = null;
    }
    #ensureApiKey() {
        if (this.#headers['x-api-key'])
            return;
        throw new SwapAndBridgeProviderApiError_1.default('Our service provider Uniswap is not configured yet. Error details: <missing UNISWAP_API_KEY>');
    }
    areChainsSupported({ fromChainId, toChainId }) {
        if (fromChainId === Number(networks_1.CITREA_CHAIN_ID) || toChainId === Number(networks_1.CITREA_CHAIN_ID))
            return false;
        // As of v2.111.3, Uniswap bridges (cross-chain routes) are temporarily disabled.
        // Same-chain swaps are unaffected. Remove this check to re-enable bridging.
        if (fromChainId !== toChainId)
            return false;
        return (constants_1.UNISWAP_SUPPORTED_CHAIN_IDS.includes(fromChainId) &&
            constants_1.UNISWAP_SUPPORTED_CHAIN_IDS.includes(toChainId));
    }
    async #withRequestTimeout(fetchPromise) {
        let timeoutPromise;
        try {
            return await Promise.race([
                fetchPromise,
                new Promise((_, reject) => {
                    timeoutPromise = setTimeout(() => {
                        reject(new SwapAndBridgeProviderApiError_1.default('Our service provider Uniswap is temporarily unavailable or your internet connection is too slow.'));
                    }, this.#requestTimeoutMs);
                })
            ]);
        }
        finally {
            if (timeoutPromise)
                clearTimeout(timeoutPromise);
        }
    }
    async #handleResponse({ fetchPromise, retryFetch, errorPrefix }) {
        this.#ensureApiKey();
        let response;
        try {
            response = await this.#withRequestTimeout(fetchPromise);
            if (response.status === GATEWAY_TIMEOUT_STATUS && retryFetch) {
                response = await this.#withRequestTimeout(retryFetch());
            }
        }
        catch (e) {
            if (e instanceof SwapAndBridgeProviderApiError_1.default)
                throw e;
            const message = e?.message || 'no message';
            const status = e?.status ? `, status: <${e.status}>` : '';
            const error = `${errorPrefix} Our service provider Uniswap could not be reached: <${message}>${status}`;
            throw new SwapAndBridgeProviderApiError_1.default(error);
        }
        if (response.status === 429) {
            throw new SwapAndBridgeProviderApiError_1.default(`Our service provider Uniswap received too many requests, temporarily preventing your request from being processed. ${errorPrefix}`);
        }
        let responseBody;
        try {
            responseBody = await response.json();
        }
        catch (e) {
            const message = e?.message || 'no message';
            const error = `${errorPrefix} Error details: <Unexpected non-JSON response from our service provider Uniswap>, message: <${message}>`;
            throw new SwapAndBridgeProviderApiError_1.default(error);
        }
        if (!response.ok) {
            const upstreamBody = responseBody;
            const upstreamMessage = upstreamBody?.detail ||
                upstreamBody?.message ||
                upstreamBody?.error ||
                upstreamBody?.errors?.[0]?.message ||
                JSON.stringify(upstreamBody).slice(0, 250);
            const error = `${errorPrefix} Our service provider Uniswap responded: <${upstreamMessage}>`;
            throw new SwapAndBridgeProviderApiError_1.default(error);
        }
        return responseBody;
    }
    async getSupportedChains() {
        const chains = constants_1.UNISWAP_SUPPORTED_CHAIN_IDS.filter((chainId) => chainId !== Number(networks_1.CITREA_CHAIN_ID)).map((chainId) => ({ chainId }));
        this.supportedChains = chains;
        return chains;
    }
    async getToTokenList({ fromChainId, toChainId }) {
        if (!this.areChainsSupported({ fromChainId, toChainId })) {
            throw new SwapAndBridgeProviderApiError_1.default('The requested network pair is not supported by our service provider Uniswap.');
        }
        const params = new URLSearchParams({
            chainId: toChainId.toString(),
            limit: '500',
            sort: 'tvl'
        });
        const url = `${constants_1.UNISWAP_API_BASE_URL}/tokens?${params.toString()}`;
        const fetchTokens = () => this.#fetch(url, { headers: this.#headers });
        const response = await this.#handleResponse({
            fetchPromise: fetchTokens(),
            // Uniswap keeps ranking the tokens after a 504, so a retry usually works
            retryFetch: fetchTokens,
            errorPrefix: 'Unable to retrieve the list of supported receive tokens. Please reload to try again.'
        });
        const tokens = (response.tokens || [])
            .filter((token) => token.chainId === toChainId && token.extensions?.safetyInfo?.safetyLevel !== 'blocked')
            .map((token) => ({
            address: normalizeAddress(token.address),
            chainId: token.chainId,
            decimals: token.decimals,
            icon: token.logoURI || '',
            name: token.name,
            symbol: token.symbol
        }));
        return (0, swapAndBridge_1.sortNativeTokenFirst)((0, swapAndBridge_1.addCustomTokensIfNeeded)({ chainId: toChainId, tokens }));
    }
    async getToken({ address, chainId }) {
        const normalizedAddress = normalizeAddress(address);
        const customToken = (0, swapAndBridge_1.addCustomTokensIfNeeded)({ chainId, tokens: [] }).find((token) => normalizeAddress(token.address) === normalizedAddress);
        return customToken || null;
    }
    async quote({ fromAsset, fromChainId, fromTokenAddress, toAsset, toChainId, toTokenAddress, fromAmount, userAddress, isWrapOrUnwrap, feePercent }) {
        this.#ensureApiKey();
        if (!this.areChainsSupported({ fromChainId, toChainId }))
            throw new SwapAndBridgeProviderApiError_1.default('Quote requested, but Uniswap does not support this chain pair.');
        if (!fromAsset)
            throw new SwapAndBridgeProviderApiError_1.default('Quote requested, but missing required params. Error details: <from token details are missing>');
        if (!toAsset)
            throw new SwapAndBridgeProviderApiError_1.default('Quote requested, but missing required params. Error details: <to token details are missing>');
        const feeExemptionReason = (0, fee_1.getFeeExemptionReason)({
            isWrapOrUnwrap,
            isFeeExemptToken: (0, swapAndBridge_1.isNoFeeToken)(fromChainId, fromTokenAddress)
        });
        const shouldIncludeConvenienceFee = feePercent > 0 && !feeExemptionReason;
        const body = {
            type: 'EXACT_INPUT',
            amount: fromAmount.toString(),
            tokenInChainId: fromChainId,
            tokenOutChainId: toChainId,
            tokenIn: normalizeAddress(fromTokenAddress),
            tokenOut: normalizeAddress(toTokenAddress),
            swapper: userAddress,
            recipient: userAddress,
            slippageTolerance: Number((0, swapAndBridge_1.getSlippage)(fromAsset, fromAmount, '0.5', 0.5)),
            routingPreference: 'BEST_PRICE',
            permitAmount: 'EXACT'
        };
        if (fromChainId === toChainId)
            body.protocols = ['V4', 'V3', 'V2'];
        if (shouldIncludeConvenienceFee) {
            body.integratorFees = [
                {
                    bips: feePercent * 100,
                    recipient: constants_1.AMBIRE_FEE_TAKER_ADDRESS
                }
            ];
        }
        const response = await this.#handleResponse({
            fetchPromise: this.#fetch(`${constants_1.UNISWAP_API_BASE_URL}/quote`, {
                method: 'POST',
                headers: this.#headers,
                body: JSON.stringify(body)
            }),
            errorPrefix: 'Unable to fetch the quote.'
        });
        if (!constants_1.SWAP_COMPATIBLE_ROUTINGS.includes(response.routing)) {
            throw new SwapAndBridgeProviderApiError_1.default(`Unable to fetch the quote. Uniswap returned an unsupported routing type: <${response.routing}>`);
        }
        const normalizedFromAsset = (0, swapAndBridge_1.convertPortfolioTokenToSwapAndBridgeToToken)(fromAsset, fromChainId);
        return {
            fromAsset: normalizedFromAsset,
            fromChainId,
            toAsset,
            toChainId,
            routes: [
                normalizeUniswapRouteToSwapAndBridgeRoute({
                    response,
                    fromAsset: normalizedFromAsset,
                    originalFromAsset: fromAsset,
                    fromChainId,
                    toAsset,
                    toChainId,
                    userAddress,
                    withConvenienceFee: shouldIncludeConvenienceFee,
                    feeExemptionReason
                })
            ],
            selectedRoute: undefined,
            selectedRouteSteps: []
        };
    }
    async #checkApproval(route) {
        const fromToken = route.steps[0]?.fromAsset.address;
        if (!fromToken || fromToken === ethers_1.ZeroAddress)
            return null;
        this.#ensureApiKey();
        const response = await this.#handleResponse({
            fetchPromise: this.#fetch(`${constants_1.UNISWAP_API_BASE_URL}/check_approval`, {
                method: 'POST',
                headers: this.#headers,
                body: JSON.stringify({
                    walletAddress: route.userAddress,
                    token: normalizeAddress(fromToken),
                    amount: route.fromAmount,
                    chainId: route.fromChainId,
                    tokenOut: normalizeAddress(route.steps[0].toAsset.address),
                    tokenOutChainId: route.toChainId
                })
            }),
            errorPrefix: 'Unable to check token approval.'
        });
        return response.approval;
    }
    async startRoute(route) {
        this.#ensureApiKey();
        const rawRoute = route.rawRoute;
        const approval = await this.#checkApproval(route);
        const response = await this.#handleResponse({
            fetchPromise: this.#fetch(`${constants_1.UNISWAP_API_BASE_URL}/swap`, {
                method: 'POST',
                headers: this.#headers,
                body: JSON.stringify({
                    quote: rawRoute.quote,
                    refreshGasPrice: true,
                    simulateTransaction: false,
                    safetyMode: 'SAFE'
                })
            }),
            errorPrefix: 'Unable to start the route.'
        });
        if (!response.swap ||
            typeof response.swap.data !== 'string' ||
            typeof response.swap.to !== 'string' ||
            typeof response.swap.value !== 'string') {
            throw new SwapAndBridgeProviderApiError_1.default('Unable to start the route. Error details: <missing transaction request data>');
        }
        const fromToken = route.steps[0]?.fromAsset.address;
        return {
            activeRouteId: route.routeId,
            approvalData: !approval || !fromToken || fromToken === ethers_1.ZeroAddress
                ? null
                : {
                    allowanceTarget: parseApprovalSpender(approval, response.swap.to),
                    approvalTokenAddress: fromToken,
                    minimumApprovalAmount: route.fromAmount,
                    owner: route.userAddress
                },
            chainId: route.fromChainId,
            txTarget: response.swap.to,
            userTxIndex: 0,
            value: response.swap.value,
            txData: response.swap.data
        };
    }
    async getRouteStatus({ txHash, fromChainId, toChainId, bridge }) {
        if (fromChainId === toChainId)
            return { status: 'completed', txnId: txHash };
        if (bridge === 'across')
            return this.#acrossAPI.getRouteStatus({ txHash });
        this.#ensureApiKey();
        const params = new URLSearchParams({
            txHashes: txHash,
            chainId: fromChainId.toString()
        });
        const response = await this.#handleResponse({
            fetchPromise: this.#fetch(`${constants_1.UNISWAP_API_BASE_URL}/swaps?${params.toString()}`, {
                headers: this.#headers
            }),
            errorPrefix: 'Unable to get the route status. Please check back later to proceed.'
        });
        const status = response.swaps[0]?.status;
        const txnId = response.swaps[0]?.txHash || null;
        if (status === 'SUCCESS')
            return { status: 'completed', txnId };
        if (status === 'FAILED' || status === 'EXPIRED')
            return { status: 'refunded', txnId };
        return { status: null };
    }
}
exports.UniswapAPI = UniswapAPI;
//# sourceMappingURL=api.js.map