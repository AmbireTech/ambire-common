"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SquidAPI = void 0;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const SwapAndBridgeProviderApiError_1 = tslib_1.__importDefault(require("../../classes/SwapAndBridgeProviderApiError"));
const swapAndBridge_1 = require("../../libs/swapAndBridge/swapAndBridge");
const constants_1 = require("./constants");
const normalizeOutgoingSquidTokenAddress = (address) => address === ethers_1.ZeroAddress ? constants_1.SQUID_NATIVE_TOKEN_ADDRESS : address;
const isTransientSquidStatusNotFound = (response) => response.statusCode === 404 || response.type === 'NotFoundError';
const getTxnIdFromTransactionUrl = (transactionUrl) => transactionUrl?.match(/0x[a-fA-F0-9]{64}/)?.[0] || null;
const normalizeIncomingSquidTokenAddress = (address) => address.toLowerCase() === constants_1.SQUID_NATIVE_TOKEN_ADDRESS.toLowerCase()
    ? ethers_1.ZeroAddress
    : (0, ethers_1.getAddress)(address);
const normalizeSquidTokenToSwapAndBridgeToToken = (token) => ({
    name: token.name,
    address: normalizeIncomingSquidTokenAddress(token.address),
    decimals: token.decimals,
    symbol: token.symbol,
    icon: token.logoURI,
    chainId: Number(token.chainId)
});
const getSquidProtocol = (route) => {
    const routeSteps = [
        ...(route.estimate.route?.fromChain || []),
        ...(route.estimate.route?.toChain || [])
    ];
    const firstNamedStep = routeSteps.find((step) => step.dex);
    return {
        name: firstNamedStep?.dex || 'Squid',
        displayName: firstNamedStep?.dex || 'Squid',
        icon: firstNamedStep?.logoURI || ''
    };
};
const normalizeSquidRouteToSwapAndBridgeRoute = ({ route, fromAsset, fromChainId, toAsset, toChainId, userAddress, accountNativeBalance, nativeSymbol, withConvenienceFee }) => {
    const fromAmount = route.estimate.fromAmount || route.params?.fromAmount || '0';
    const toAmount = route.estimate.toAmount;
    const serviceTime = route.estimate.estimatedRouteDuration || 0;
    const protocol = getSquidProtocol(route);
    const minAmountOut = route.estimate.toAmountMin || toAmount;
    const serviceFeeCost = route.estimate.feeCosts?.find((fee) => fee.included === false);
    const serviceFee = serviceFeeCost
        ? {
            amount: serviceFeeCost.amount,
            amountUSD: serviceFeeCost.amountUSD || '0'
        }
        : undefined;
    const disabled = serviceFee === undefined ? false : accountNativeBalance < BigInt(serviceFee.amount);
    const disabledReason = disabled
        ? `Insufficient ${nativeSymbol}. This bridge imposes a fee that must be paid in ${nativeSymbol}.`
        : undefined;
    const userTx = {
        userTxIndex: 0,
        fromAsset,
        toAsset,
        chainId: fromChainId,
        fromAmount,
        toAmount,
        swapSlippage: route.estimate.aggregatePriceImpact
            ? Number(route.estimate.aggregatePriceImpact)
            : undefined,
        serviceTime,
        protocol,
        minAmountOut
    };
    const step = {
        ...userTx,
        type: 'swap'
    };
    return {
        providerId: 'squid',
        routeId: route.quoteId,
        fromChainId,
        toChainId,
        userAddress,
        isOnlySwapRoute: false,
        fromAmount,
        toAmount,
        currentUserTxIndex: 0,
        usedBridgeNames: ['squid'],
        userTxs: [userTx],
        steps: [step],
        inputValueInUsd: Number(route.estimate.fromAmountUSD || 0),
        outputValueInUsd: Number(route.estimate.toAmountUSD || 0),
        serviceTime,
        rawRoute: route,
        sender: userAddress,
        toToken: {
            address: toAsset.address,
            chainId: toAsset.chainId,
            decimals: toAsset.decimals,
            logoURI: toAsset.icon || '',
            name: toAsset.name,
            symbol: toAsset.symbol
        },
        disabled,
        disabledReason,
        serviceFee,
        withConvenienceFee
    };
};
class SquidAPI {
    id = 'squid';
    name = 'Squid';
    #fetch;
    #headers;
    #requestTimeoutMs = 15000;
    isHealthy = null;
    supportedChains = null;
    constructor({ fetch, integratorId }) {
        this.#fetch = fetch;
        this.#headers = {
            Accept: 'application/json',
            'Content-Type': 'application/json'
        };
        if (integratorId)
            this.#headers['x-integrator-id'] = integratorId;
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
    areChainsSupported({ fromChainId, toChainId }) {
        return fromChainId === constants_1.CITREA_CHAIN_ID || toChainId === constants_1.CITREA_CHAIN_ID;
    }
    #ensureIntegratorId() {
        if (this.#headers['x-integrator-id'])
            return;
        throw new SwapAndBridgeProviderApiError_1.default('Our service provider Squid is not configured yet. Error details: <missing SQUID_INTEGRATOR_ID>');
    }
    async #handleResponse({ fetchPromise, errorPrefix, shouldReturnErrorResponse }) {
        let response;
        try {
            let timeoutPromise;
            response = await Promise.race([
                fetchPromise,
                new Promise((_, reject) => {
                    timeoutPromise = setTimeout(() => {
                        reject(new SwapAndBridgeProviderApiError_1.default('Our service provider Squid is temporarily unavailable or your internet connection is too slow.'));
                    }, this.#requestTimeoutMs);
                })
            ]);
            if (timeoutPromise)
                clearTimeout(timeoutPromise);
        }
        catch (e) {
            if (e instanceof SwapAndBridgeProviderApiError_1.default)
                throw e;
            const status = e?.status ? `, status: <${e.status}>` : '';
            const error = `${errorPrefix} Our service provider Squid could not be reached: ${status}`;
            throw new SwapAndBridgeProviderApiError_1.default(error);
        }
        let responseBody;
        try {
            responseBody = await response.json();
        }
        catch (e) {
            const message = e?.message || 'no message';
            const error = `${errorPrefix} Error details: <Unexpected non-JSON response from our service provider Squid>, message: <${message}>`;
            throw new SwapAndBridgeProviderApiError_1.default(error);
        }
        if (!response.ok) {
            if (shouldReturnErrorResponse && shouldReturnErrorResponse(responseBody, response)) {
                return responseBody;
            }
            const upstreamBody = responseBody;
            const upstreamMessage = upstreamBody?.message ||
                upstreamBody?.error ||
                upstreamBody?.errors?.[0]?.message ||
                JSON.stringify(upstreamBody).slice(0, 250);
            const error = `${errorPrefix} Our service provider Squid responded: <${upstreamMessage}>`;
            throw new SwapAndBridgeProviderApiError_1.default(error);
        }
        return responseBody;
    }
    async getSupportedChains() {
        const chains = [{ chainId: constants_1.CITREA_CHAIN_ID }];
        this.supportedChains = chains;
        return chains;
    }
    async getToTokenList({ toChainId }) {
        this.#ensureIntegratorId();
        const params = new URLSearchParams({
            chainId: toChainId.toString()
        });
        const response = await this.#handleResponse({
            fetchPromise: this.#fetch(`${constants_1.SQUID_API_BASE_URL}/tokens?${params.toString()}`, {
                headers: this.#headers
            }),
            errorPrefix: 'Unable to retrieve the list of supported receive tokens. Please reload to try again.'
        });
        const tokens = (Array.isArray(response) ? response : response.tokens || [])
            .filter((token) => Number(token.chainId) === toChainId)
            .map(normalizeSquidTokenToSwapAndBridgeToToken);
        const withCustomTokens = (0, swapAndBridge_1.addCustomTokensIfNeeded)({ chainId: toChainId, tokens });
        return (0, swapAndBridge_1.sortNativeTokenFirst)(withCustomTokens);
    }
    async getToken({ address, chainId }) {
        const tokens = await this.getToTokenList({ toChainId: chainId });
        const normalizedAddress = normalizeIncomingSquidTokenAddress(normalizeOutgoingSquidTokenAddress(address));
        return tokens.find((token) => token.address === normalizedAddress) || null;
    }
    async quote({ fromAsset, fromChainId, fromTokenAddress, toAsset, toChainId, toTokenAddress, fromAmount, userAddress, isWrapOrUnwrap, accountNativeBalance, nativeSymbol }) {
        this.#ensureIntegratorId();
        if (!this.areChainsSupported({ fromChainId, toChainId }))
            throw new SwapAndBridgeProviderApiError_1.default('Quote requested, but Squid only supports swaps on Citrea and bridges to or from Citrea.');
        if (!fromAsset)
            throw new SwapAndBridgeProviderApiError_1.default('Quote requested, but missing required params. Error details: <from token details are missing>');
        if (!toAsset)
            throw new SwapAndBridgeProviderApiError_1.default('Quote requested, but missing required params. Error details: <to token details are missing>');
        const feeTakerAddress = constants_1.AMBIRE_FEE_TAKER_ADDRESS;
        const shouldIncludeConvenienceFee = !!feeTakerAddress && !isWrapOrUnwrap && !(0, swapAndBridge_1.isNoFeeToken)(fromChainId, fromTokenAddress);
        const body = {
            fromAddress: userAddress,
            fromChain: fromChainId.toString(),
            fromToken: normalizeOutgoingSquidTokenAddress(fromTokenAddress),
            fromAmount: fromAmount.toString(),
            toChain: toChainId.toString(),
            toToken: normalizeOutgoingSquidTokenAddress(toTokenAddress),
            toAddress: userAddress,
            slippage: Number((0, swapAndBridge_1.getSlippage)(fromAsset, fromAmount, '1', 0.5)),
            quoteOnly: false
        };
        const response = await this.#handleResponse({
            fetchPromise: this.#fetch(`${constants_1.SQUID_API_BASE_URL}/route`, {
                method: 'POST',
                headers: this.#headers,
                body: JSON.stringify(body)
            }),
            errorPrefix: 'Unable to fetch the quote.'
        });
        const requestId = response.route.requestId || response.route.quoteId;
        const route = {
            ...response.route,
            requestId
        };
        const normalizedFromAsset = (0, swapAndBridge_1.convertPortfolioTokenToSwapAndBridgeToToken)(fromAsset, fromChainId);
        return {
            fromAsset: normalizedFromAsset,
            fromChainId,
            toAsset,
            toChainId,
            routes: [
                normalizeSquidRouteToSwapAndBridgeRoute({
                    route,
                    fromAsset: normalizedFromAsset,
                    fromChainId,
                    toAsset,
                    toChainId,
                    userAddress,
                    accountNativeBalance,
                    nativeSymbol,
                    withConvenienceFee: shouldIncludeConvenienceFee
                })
            ],
            selectedRoute: undefined,
            selectedRouteSteps: []
        };
    }
    async startRoute(route) {
        const rawRoute = route.rawRoute;
        const transactionRequest = rawRoute.transactionRequest;
        const txTarget = transactionRequest?.target || transactionRequest?.to;
        const txData = transactionRequest?.data;
        if (!txTarget || !txData || typeof transactionRequest?.value !== 'string') {
            throw new SwapAndBridgeProviderApiError_1.default('Unable to start the route. Error details: <missing transaction request data>');
        }
        return {
            activeRouteId: route.routeId,
            approvalData: route.steps[0]?.fromAsset.address === ethers_1.ZeroAddress
                ? null
                : {
                    allowanceTarget: rawRoute.estimate.approvalAddress || txTarget,
                    approvalTokenAddress: route.steps[0].fromAsset.address,
                    minimumApprovalAmount: route.fromAmount,
                    owner: route.userAddress
                },
            chainId: route.fromChainId,
            txTarget,
            userTxIndex: 0,
            value: transactionRequest.value,
            txData
        };
    }
    async getRouteStatus({ txHash, fromChainId, toChainId, requestId, routeId }) {
        this.#ensureIntegratorId();
        const params = new URLSearchParams({
            transactionId: txHash,
            fromChainId: fromChainId.toString(),
            toChainId: toChainId.toString()
        });
        if (requestId)
            params.append('requestId', requestId);
        if (routeId)
            params.append('quoteId', routeId);
        const response = await this.#handleResponse({
            fetchPromise: this.#fetch(`${constants_1.SQUID_API_BASE_URL}/status?${params.toString()}`, {
                headers: this.#headers
            }),
            errorPrefix: 'Unable to get the route status. Please check back later to proceed.',
            shouldReturnErrorResponse: (responseBody) => isTransientSquidStatusNotFound(responseBody)
        });
        if (isTransientSquidStatusNotFound(response)) {
            return { status: null };
        }
        const statusResponse = response;
        const status = (statusResponse.squidTransactionStatus ||
            statusResponse.status ||
            '').toLowerCase();
        let routeStatus = null;
        if (status === 'success' || status === 'partial_success')
            routeStatus = 'completed';
        if (status === 'refund')
            routeStatus = 'refunded';
        return {
            status: routeStatus,
            txnId: getTxnIdFromTransactionUrl(statusResponse.toChain?.transactionUrl)
        };
    }
}
exports.SquidAPI = SquidAPI;
//# sourceMappingURL=api.js.map