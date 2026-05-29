"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LiFiAPI = void 0;
const tslib_1 = require("tslib");
const constants_1 = require("@/services/squid/constants");
const SwapAndBridgeProviderApiError_1 = tslib_1.__importDefault(require("../../classes/SwapAndBridgeProviderApiError"));
const swapAndBridge_1 = require("../../libs/swapAndBridge/swapAndBridge");
const constants_2 = require("../socket/constants");
const helpers_1 = require("./helpers");
const normalizeLiFiTokenToSwapAndBridgeToToken = (token, toChainId) => {
    const { name, address, decimals, symbol, logoURI: icon } = token;
    return {
        name,
        address: (0, swapAndBridge_1.lifiMapNativeToAddr)(toChainId, address),
        decimals,
        symbol,
        icon,
        chainId: toChainId
    };
};
const normalizeLiFiStepToSwapAndBridgeStep = (parentStep) => {
    const includedSteps = parentStep.includedSteps;
    const swapOrBridgeSteps = ['swap', 'cross'];
    const isSwapOrBridge = includedSteps.some((s) => swapOrBridgeSteps.includes(s.type));
    return (includedSteps
        // Picks only steps that need to be visualized / displayed
        .filter(({ type }) => {
        // If it's swap or bridge we don't want to show protocol steps
        // as they are not relevant for the user
        if (isSwapOrBridge) {
            return swapOrBridgeSteps.includes(type);
        }
        // If it's not swap or bridge we want to show protocol steps
        // (Wrap / Unwrap)
        return type === 'protocol';
    })
        .map((step, index) => ({
        chainId: step.action.fromChainId,
        fromAmount: parentStep.action.fromAmount,
        fromAsset: normalizeLiFiTokenToSwapAndBridgeToToken(step.action.fromToken, step.action.fromChainId),
        serviceTime: parentStep.estimate.executionDuration,
        minAmountOut: step.estimate.toAmountMin,
        protocol: {
            name: step.toolDetails.name,
            displayName: step.toolDetails.name,
            icon: step.toolDetails.logoURI
        },
        swapSlippage: step.action.slippage,
        toAmount: step.estimate.toAmount,
        toAsset: normalizeLiFiTokenToSwapAndBridgeToToken(step.action.toToken, step.action.toChainId),
        type: step.type === 'swap' ? 'swap' : 'middleware',
        userTxIndex: index
    })));
};
const normalizeLiFiStepToSwapAndBridgeUserTx = (parentStep) => parentStep.includedSteps
    // Picks only steps that need to be visualized / displayed
    .filter(({ type }) => ['swap', 'cross'].includes(type))
    .map((step, index) => ({
    userTxIndex: index,
    fromAsset: normalizeLiFiTokenToSwapAndBridgeToToken(step.action.fromToken, step.action.fromChainId),
    toAsset: normalizeLiFiTokenToSwapAndBridgeToToken(step.action.toToken, step.action.toChainId),
    chainId: step.action.fromChainId,
    fromAmount: step.estimate.fromAmount,
    toAmount: step.estimate.toAmount,
    swapSlippage: step.action.slippage,
    serviceTime: parentStep.estimate.executionDuration,
    protocol: {
        displayName: step.toolDetails.name,
        icon: step.toolDetails.logoURI,
        name: step.toolDetails.name
    },
    minAmountOut: step.estimate.toAmountMin
}));
const normalizeLiFiRouteToSwapAndBridgeRoute = (route, userAddress, accountNativeBalance, nativeSymbol, withConvenienceFee) => {
    // search for a feeCost that is not included in the quote
    // if there is one, check if the user has enough to pay for it
    // if he doesn't, mark the route as disabled
    // let serviceFee = parentStep?.estimate?.feeCosts?.filter((cost: { included: boolean }) => !cost.included) ?? []
    let serviceFee;
    route.steps.forEach((step) => {
        const stepFeeCosts = step.estimate.feeCosts?.filter((cost) => !cost.included) ?? [];
        if (stepFeeCosts.length)
            serviceFee = stepFeeCosts[0];
    });
    const disabled = serviceFee === undefined ? false : accountNativeBalance < BigInt(serviceFee.amount);
    const swapOrBridgeText = route.fromChainId === route.toChainId ? 'swap' : 'bridge';
    const disabledReason = disabled
        ? `Insufficient ${nativeSymbol}. This ${swapOrBridgeText} imposes a fee that must be paid in ${nativeSymbol}.`
        : undefined;
    return {
        providerId: 'lifi',
        routeId: route.id,
        fromChainId: route.fromChainId,
        toChainId: route.toChainId,
        userAddress,
        isOnlySwapRoute: !route.containsSwitchChain,
        fromAmount: route.fromAmount,
        toAmount: route.toAmount,
        currentUserTxIndex: 0,
        ...(route.steps[0]?.includedSteps.some((s) => s.type === 'cross')
            ? { usedBridgeNames: [route.steps[0].toolDetails.key] }
            : { usedDexName: route.steps[0]?.toolDetails.name }),
        userTxs: route.steps.flatMap(normalizeLiFiStepToSwapAndBridgeUserTx),
        steps: route.steps.flatMap(normalizeLiFiStepToSwapAndBridgeStep),
        inputValueInUsd: +route.fromAmountUSD,
        outputValueInUsd: +route.toAmountUSD,
        serviceTime: route.steps[0]?.estimate.executionDuration || 0,
        rawRoute: route,
        sender: route.fromAddress,
        toToken: route.toToken,
        disabled,
        disabledReason,
        serviceFee,
        withConvenienceFee
    };
};
const normalizeLiFiStepToSwapAndBridgeSendTxRequest = (parentStep, routeId) => {
    if (!parentStep.transactionRequest ||
        typeof parentStep.transactionRequest.data !== 'string' ||
        typeof parentStep.transactionRequest.to !== 'string' ||
        typeof parentStep.transactionRequest.value !== 'string') {
        throw new SwapAndBridgeProviderApiError_1.default('Unable to start the route. Error details: <missing transaction request data>');
    }
    return {
        activeRouteId: routeId,
        approvalData: parentStep.action.fromToken.address === constants_2.ZERO_ADDRESS
            ? null // No approval needed fo native tokens
            : {
                allowanceTarget: parentStep.estimate.approvalAddress,
                approvalTokenAddress: parentStep.action.fromToken.address,
                minimumApprovalAmount: parentStep.estimate.fromAmount,
                owner: ''
            },
        chainId: parentStep.action.fromChainId,
        txTarget: parentStep.transactionRequest.to,
        userTxIndex: 0,
        value: parentStep.transactionRequest.value,
        txData: parentStep.transactionRequest.data
    };
};
class LiFiAPI {
    id = 'lifi';
    name = 'LiFi';
    #fetch;
    #baseUrl = 'https://li.quest/v1';
    #headers;
    #requestTimeoutMs = 15000;
    isHealthy = null;
    #apiKey;
    supportedChains = null;
    /**
     * We don't use the apiKey as a default option for sending LiFi API
     * requests, we let a custom rate limit be set per user.
     * If the user hits that rate limit, we add the key for a set amount
     * of time so he could continue using lifi. The key is exposed on
     * the FE and anyone can use it and therefore break it (hit the rate
     * limit), so we only use it as a backup
     */
    #apiKeyActivatedTimestamp;
    constructor({ fetch, apiKey }) {
        this.#fetch = fetch;
        this.#headers = {
            Accept: 'application/json',
            'Content-Type': 'application/json'
        };
        this.#apiKey = apiKey;
    }
    activateApiKey() {
        this.#headers['x-lifi-api-key'] = this.#apiKey;
        this.#apiKeyActivatedTimestamp = Date.now();
    }
    deactivateApiKeyIfStale() {
        if (!this.#apiKeyActivatedTimestamp)
            return;
        const twoHoursPassed = Date.now() - this.#apiKeyActivatedTimestamp >= 120 * 60 * 1000;
        if (!twoHoursPassed)
            return;
        delete this.#headers['x-lifi-api-key'];
        this.#apiKeyActivatedTimestamp = undefined;
    }
    async getHealth() {
        // Li.Fi's v1 API doesn't have a dedicated health endpoint
        return true;
    }
    async updateHealth() {
        this.isHealthy = await this.getHealth();
    }
    async updateHealthIfNeeded() {
        // Update health status only if previously unhealthy
        if (this.isHealthy)
            return;
        await this.updateHealth();
    }
    resetHealth() {
        this.isHealthy = null;
    }
    /** disable explicitly citrea for lifi */
    areChainsSupported({ fromChainId, toChainId }) {
        return fromChainId !== constants_1.CITREA_CHAIN_ID && toChainId !== constants_1.CITREA_CHAIN_ID;
    }
    /**
     * Processes LiFi API responses and throws custom errors for various failures
     */
    async #handleResponse({ fetchPromise, errorPrefix }) {
        // start by removing the API key if a set time has passed
        // we use the api key only when we hit the rate limit
        this.deactivateApiKeyIfStale();
        let response;
        try {
            let timeoutPromise;
            response = await Promise.race([
                fetchPromise,
                new Promise((_, reject) => {
                    timeoutPromise = setTimeout(() => {
                        reject(new SwapAndBridgeProviderApiError_1.default('Our service provider LiFi is temporarily unavailable or your internet connection is too slow.'));
                    }, this.#requestTimeoutMs);
                })
            ]);
            if (timeoutPromise)
                clearTimeout(timeoutPromise);
        }
        catch (e) {
            // Rethrow the same error if it's already humanized
            if (e instanceof SwapAndBridgeProviderApiError_1.default)
                throw e;
            const message = e?.message || 'no message';
            const status = e?.status ? `, status: <${e.status}>` : '';
            const error = `${errorPrefix} Our service provider LiFi could not be reached: <${message}>${status}`;
            throw new SwapAndBridgeProviderApiError_1.default(error);
        }
        if (response.status === 429) {
            this.activateApiKey();
            const error = 'Our service provider LiFi received too many requests, temporarily preventing your request from being processed.';
            throw new SwapAndBridgeProviderApiError_1.default(error, 'Rate limit reached, try again later.');
        }
        let responseBody;
        try {
            responseBody = await response.json();
        }
        catch (e) {
            const error = 'Our service provider LiFi is temporarily unavailable.';
            throw new SwapAndBridgeProviderApiError_1.default(error);
        }
        if (!response.ok) {
            const humanizedMessage = (0, helpers_1.getHumanReadableErrorMessage)(errorPrefix, responseBody);
            if (humanizedMessage) {
                throw new SwapAndBridgeProviderApiError_1.default(humanizedMessage);
            }
            const upstreamMessage = responseBody?.message;
            const upstreamCode = responseBody?.code;
            const fallbackMessage = 
            // Upstream error coming from LiFi, that must be the most accurate
            upstreamMessage && upstreamCode
                ? `${upstreamMessage} Reference: ${upstreamCode}`
                : upstreamMessage || JSON.stringify(responseBody).slice(0, 250); // up to about 5 lines of toast
            const error = `${errorPrefix} Our service provider LiFi responded: <${fallbackMessage}>`;
            throw new SwapAndBridgeProviderApiError_1.default(error);
        }
        return responseBody;
    }
    async getSupportedChains() {
        const url = `${this.#baseUrl}/chains?chainTypes=EVM`;
        const response = await this.#handleResponse({
            fetchPromise: this.#fetch(url, { headers: this.#headers }),
            errorPrefix: 'Unable to retrieve the list of supported Swap & Bridge chains from our service provider.'
        });
        const chains = response.chains.map((c) => ({ chainId: c.id }));
        this.supportedChains = chains;
        return chains;
    }
    async getToTokenList({ toChainId }) {
        const params = new URLSearchParams({
            chains: toChainId.toString(),
            chainTypes: 'EVM'
        });
        const url = `${this.#baseUrl}/tokens?${params.toString()}`;
        const response = await this.#handleResponse({
            fetchPromise: this.#fetch(url, { headers: this.#headers }),
            errorPrefix: 'Unable to retrieve the list of supported receive tokens. Please reload to try again.'
        });
        const tokens = (response.tokens[toChainId] || []).map((t) => normalizeLiFiTokenToSwapAndBridgeToToken(t, toChainId));
        const sortedTokens = await (0, swapAndBridge_1.attemptToSortTokensByMarketCap)({
            fetch: this.#fetch,
            chainId: toChainId,
            tokens
        });
        const withCustomTokens = (0, swapAndBridge_1.addCustomTokensIfNeeded)({ chainId: toChainId, tokens: sortedTokens });
        return (0, swapAndBridge_1.sortNativeTokenFirst)(withCustomTokens);
    }
    async getToken({ address: token, chainId }) {
        const params = new URLSearchParams({
            token: token.toString(),
            chain: chainId.toString()
        });
        const url = `${this.#baseUrl}/token?${params.toString()}`;
        const response = await this.#handleResponse({
            fetchPromise: this.#fetch(url, { headers: this.#headers }),
            errorPrefix: 'Unable to retrieve token information by address.'
        });
        if (!response)
            return null;
        return normalizeLiFiTokenToSwapAndBridgeToToken(response, chainId);
    }
    async quote({ fromAsset, fromChainId, fromTokenAddress, toAsset, toChainId, toTokenAddress, fromAmount, userAddress, sort, isWrapOrUnwrap, accountNativeBalance, nativeSymbol }) {
        if (!fromAsset)
            throw new SwapAndBridgeProviderApiError_1.default('Quote requested, but missing required params. Error details: <from token details are missing>');
        if (!toAsset)
            throw new SwapAndBridgeProviderApiError_1.default('Quote requested, but missing required params. Error details: <to token details are missing>');
        const body = {
            fromChainId: fromChainId.toString(),
            fromAmount: fromAmount.toString(),
            fromTokenAddress: (0, swapAndBridge_1.lifiMapNativeToAddr)(fromChainId, fromTokenAddress),
            toChainId: toChainId.toString(),
            toTokenAddress: (0, swapAndBridge_1.lifiMapNativeToAddr)(toChainId, toTokenAddress),
            fromAddress: userAddress,
            toAddress: userAddress,
            options: {
                slippage: (0, swapAndBridge_1.getSlippage)(fromAsset, fromAmount, '0.01', 0.005),
                maxPriceImpact: '0.50',
                order: sort === 'time' ? 'FASTEST' : 'CHEAPEST',
                integrator: 'ambire-extension-prod',
                // These two flags ensure we have NO transaction on the destination chain
                allowDestinationCall: 'false',
                allowSwitchChain: 'false',
                // LiFi fee is from 0 to 1, so normalize it by dividing by 100
                fee: (constants_2.FEE_PERCENT / 100).toString(),
                // How this works:
                // When this strategy is applied, we give all tool 900ms (minWaitTimeMs) to return a result.
                // If we received 5 or more (startingExpectedResults) results during this time we return those and don’t wait for other tools.
                // If less than 5 results are present we wait another 300ms and check if now at least (5-1=4) results are present.
                timing: {
                    // Applied in swaps
                    swapStepTimingStrategies: [
                        {
                            strategy: 'minWaitTime',
                            minWaitTimeMs: 900,
                            startingExpectedResults: 5,
                            reduceEveryMs: 300
                        }
                    ],
                    // Applied in bridges
                    routeTimingStrategies: [
                        {
                            strategy: 'minWaitTime',
                            minWaitTimeMs: 1500,
                            startingExpectedResults: 5,
                            reduceEveryMs: 300
                        }
                    ]
                }
            }
        };
        const shouldRemoveConvenienceFee = isWrapOrUnwrap || (0, swapAndBridge_1.isNoFeeToken)(fromChainId, fromTokenAddress);
        if (shouldRemoveConvenienceFee)
            delete body.options.fee;
        const url = `${this.#baseUrl}/advanced/routes`;
        const response = await this.#handleResponse({
            fetchPromise: this.#fetch(url, {
                headers: this.#headers,
                method: 'POST',
                body: JSON.stringify(body)
            }),
            errorPrefix: 'Unable to fetch the quote.'
        });
        return {
            fromAsset: (0, swapAndBridge_1.convertPortfolioTokenToSwapAndBridgeToToken)(fromAsset, fromChainId),
            fromChainId,
            toAsset,
            toChainId,
            routes: response.routes.map((r) => normalizeLiFiRouteToSwapAndBridgeRoute(r, userAddress, accountNativeBalance, nativeSymbol, !shouldRemoveConvenienceFee)),
            // selecting a route is a controller's responsiilibty, not the API's
            selectedRoute: undefined,
            selectedRouteSteps: []
        };
    }
    async startRoute(route) {
        const body = JSON.stringify(route.rawRoute.steps[0]);
        const response = await this.#handleResponse({
            // skipSimulation reduces the time it takes for the request to complete.
            // By default LiFi does additional calculations/calls to make the gasLimit more accurate
            // This is fine for use, because we don't use it anyway
            fetchPromise: this.#fetch(`${this.#baseUrl}/advanced/stepTransaction?skipSimulation=true`, {
                method: 'POST',
                headers: this.#headers,
                body
            }),
            errorPrefix: 'Unable to start the route.'
        });
        return normalizeLiFiStepToSwapAndBridgeSendTxRequest(response, route.routeId);
    }
    async getRouteStatus({ txHash, fromChainId, toChainId, bridge }) {
        if (!bridge)
            return { status: 'completed', txnId: txHash };
        const params = new URLSearchParams({
            txHash,
            bridge,
            fromChain: fromChainId.toString(),
            toChain: toChainId.toString()
        });
        const url = `${this.#baseUrl}/status?${params.toString()}`;
        // no error handling on getRouteStatus. Swallow the error and always return
        // a pending route result and try again. This is the best decision after
        // discussing it with Li.Fi. as in our one-swap, one-bridge design the
        // only errors that should be returned are once that will disappear after time
        const response = await this.#handleResponse({
            fetchPromise: this.#fetch(url, { headers: this.#headers }),
            errorPrefix: 'Unable to get the route status. Please check back later to proceed.'
        }).catch((e) => e);
        const statuses = {
            DONE: 'completed',
            FAILED: null,
            INVALID: null,
            NOT_FOUND: null,
            PENDING: null,
            // when the bridge has failed and the user has received back his tokens
            REFUNDED: 'refunded'
        };
        if (response instanceof SwapAndBridgeProviderApiError_1.default) {
            return { status: statuses.PENDING };
        }
        const receivingTxnId = 'receiving' in response && 'txHash' in response.receiving ? response.receiving.txHash : null;
        if (response.substatus && response.substatus === 'REFUNDED') {
            return { status: statuses.REFUNDED, txnId: receivingTxnId };
        }
        return {
            status: statuses[response.status],
            txnId: receivingTxnId
        };
    }
}
exports.LiFiAPI = LiFiAPI;
//# sourceMappingURL=api.js.map