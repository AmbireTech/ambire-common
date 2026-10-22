"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CowSwapAPI = void 0;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const helper_1 = require("./helper");
const SwapAndBridgeProviderApiError_1 = tslib_1.__importDefault(require("../../classes/SwapAndBridgeProviderApiError"));
const helper_2 = require("../../controllers/signAccountOp/helper");
const fee_1 = require("../../libs/swapAndBridge/fee");
const swapAndBridge_1 = require("../../libs/swapAndBridge/swapAndBridge");
const constants_1 = require("./constants");
class CowSwapAPI {
    id = 'cowswap';
    name = 'CoW Swap';
    #fetch;
    #headers = {
        Accept: 'application/json',
        'Content-Type': 'application/json'
    };
    #apiHeaders;
    #requestTimeoutMs = 15000;
    isHealthy = null;
    supportedChains = null;
    constructor({ fetch, apiKey }) {
        this.#fetch = fetch;
        this.#apiHeaders = { ...this.#headers, 'X-API-Key': apiKey };
    }
    async updateHealth() {
        this.isHealthy = true;
    }
    resetHealth() {
        this.isHealthy = null;
    }
    areChainsSupported({ fromChainId, toChainId }) {
        // CoW Swap orders settle on a single network, so a different destination chain would
        // silently turn into a swap for the destination token address on the source chain
        return fromChainId === toChainId && !!(0, helper_1.getApiNetwork)(fromChainId);
    }
    #getApiUrl(chainId, path, version = 'v1') {
        const apiNetwork = (0, helper_1.getApiNetwork)(chainId);
        if (!apiNetwork) {
            throw new SwapAndBridgeProviderApiError_1.default('The requested network is not supported by our service provider CoW Swap.');
        }
        return `${constants_1.COWSWAP_API_BASE_URL}/${apiNetwork}/api/${version}${path}`;
    }
    async #fetchWithTimeout(url, init) {
        let timeout;
        try {
            return await Promise.race([
                this.#fetch(url, init),
                new Promise((_, reject) => {
                    timeout = setTimeout(() => {
                        reject(new SwapAndBridgeProviderApiError_1.default('Our service provider CoW Swap is temporarily unavailable or your internet connection is too slow.'));
                    }, this.#requestTimeoutMs);
                })
            ]);
        }
        catch (error) {
            if (error instanceof SwapAndBridgeProviderApiError_1.default)
                throw error;
            const message = error?.message || 'no message';
            throw new SwapAndBridgeProviderApiError_1.default(`Our service provider CoW Swap could not be reached. Error details: <${message}>`);
        }
        finally {
            if (timeout)
                clearTimeout(timeout);
        }
    }
    async #parseResponse(response, errorPrefix) {
        if (response.status === 429) {
            throw new SwapAndBridgeProviderApiError_1.default(`${errorPrefix} CoW Swap received too many requests. Please try again shortly.`);
        }
        let body;
        try {
            body = await response.json();
        }
        catch (error) {
            const message = error?.message || 'no message';
            throw new SwapAndBridgeProviderApiError_1.default(`${errorPrefix} CoW Swap returned an unexpected response. Error details: <${message}>`);
        }
        if (!response.ok) {
            const errorBody = body;
            const message = errorBody.description || errorBody.message || errorBody.errorType || 'Unknown error';
            throw new SwapAndBridgeProviderApiError_1.default(`${errorPrefix} CoW Swap responded: <${message}>`);
        }
        return body;
    }
    async getSupportedChains() {
        const chains = constants_1.COWSWAP_SUPPORTED_CHAINS.map(({ chainId }) => ({ chainId }));
        this.supportedChains = chains;
        return chains;
    }
    async #getTokenList() {
        const response = await this.#parseResponse(await this.#fetchWithTimeout(constants_1.COWSWAP_TOKEN_LIST_URL, { headers: this.#headers }), 'Unable to retrieve the list of supported receive tokens. Please reload to try again.');
        if (!Array.isArray(response.tokens)) {
            throw new SwapAndBridgeProviderApiError_1.default('Unable to retrieve the list of supported receive tokens. CoW Swap returned an unexpected token list.');
        }
        return response.tokens.filter(helper_1.isCowSwapTokenListEntry);
    }
    async getToTokenList({ 
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    fromChainId, toChainId }) {
        const tokens = (await this.#getTokenList())
            .filter((token) => token.chainId === toChainId)
            .map(helper_1.normalizeCowSwapToken);
        return (0, swapAndBridge_1.addCustomTokensIfNeeded)({ chainId: toChainId, tokens });
    }
    async getToken({ address, chainId }) {
        if (!(0, helper_1.getApiNetwork)(chainId) || !(0, ethers_1.isAddress)(address))
            return null;
        const normalizedAddress = (0, ethers_1.getAddress)(address);
        const listedToken = (await this.#getTokenList()).find((token) => token.chainId === chainId && token.address.toLowerCase() === normalizedAddress.toLowerCase());
        if (listedToken)
            return (0, helper_1.normalizeCowSwapToken)(listedToken);
        const nativePriceResponse = await this.#fetchWithTimeout(this.#getApiUrl(chainId, `/token/${normalizedAddress}/native_price`), { headers: this.#apiHeaders });
        if (nativePriceResponse.status === 404)
            return null;
        await this.#parseResponse(nativePriceResponse, 'Unable to check whether the token is supported.');
        const platformResponse = await this.#fetchWithTimeout(`${constants_1.CENA_API_BASE_URL}/api/v3/platform/${chainId}`, { headers: this.#headers });
        if (platformResponse.status === 404)
            return null;
        const { platformId } = await this.#parseResponse(platformResponse, 'Unable to retrieve token information by address.');
        if (typeof platformId !== 'string' || !platformId)
            return null;
        const tokenResponse = await this.#fetchWithTimeout(`${constants_1.CENA_API_BASE_URL}/api/v3/coins/${encodeURIComponent(platformId)}/contract/${normalizedAddress}`, { headers: this.#headers });
        if (tokenResponse.status === 404)
            return null;
        const token = await this.#parseResponse(tokenResponse, 'Unable to retrieve token information by address.');
        const platformAddress = token.platforms?.[platformId];
        const decimals = token.decimals?.[platformId];
        if (token.blacklist ||
            token.removed ||
            !platformAddress ||
            !(0, ethers_1.isAddress)(platformAddress) ||
            platformAddress.toLowerCase() !== normalizedAddress.toLowerCase() ||
            !Number.isInteger(decimals) ||
            decimals === undefined ||
            decimals < 0 ||
            decimals > 255 ||
            typeof token.name !== 'string' ||
            !token.name ||
            typeof token.symbol !== 'string' ||
            !token.symbol)
            return null;
        return {
            address: normalizedAddress,
            chainId,
            decimals,
            icon: token.image?.large || token.image?.small || token.image?.thumb || '',
            name: token.name,
            symbol: token.symbol
        };
    }
    async quote({ fromAsset, fromChainId, fromTokenAddress, toAsset, toChainId, toTokenAddress, fromAmount, userAddress, isWrapOrUnwrap, feePercent }) {
        if (!this.areChainsSupported({ fromChainId, toChainId })) {
            throw new SwapAndBridgeProviderApiError_1.default('Quote requested, but CoW Swap supports only same-network swaps on this network.');
        }
        if (!fromAsset || !toAsset) {
            throw new SwapAndBridgeProviderApiError_1.default('Quote requested, but token details are missing. Please select the tokens again.');
        }
        const isEthFlow = fromTokenAddress.toLowerCase() === ethers_1.ZeroAddress.toLowerCase();
        const wrappedNativeTokenAddress = (0, helper_1.getWrappedNativeTokenAddress)(fromChainId);
        if (isEthFlow && !wrappedNativeTokenAddress) {
            throw new SwapAndBridgeProviderApiError_1.default('CoW Swap cannot sell the network native token on this network.');
        }
        const sellToken = (0, ethers_1.getAddress)(isEthFlow ? wrappedNativeTokenAddress : fromTokenAddress);
        const buyToken = (0, helper_1.normalizeBuyTokenAddress)(toTokenAddress);
        const owner = (0, ethers_1.getAddress)(userAddress);
        const slippageBps = Math.round(Number((0, swapAndBridge_1.getSlippage)(fromAsset, fromAmount, '0.5', 0.5)) * 100);
        const feeExemptionReason = (0, fee_1.getFeeExemptionReason)({
            isWrapOrUnwrap,
            isFeeExemptToken: (0, swapAndBridge_1.isNoFeeToken)(fromChainId, sellToken)
        });
        const shouldIncludeConvenienceFee = feePercent > 0 && !feeExemptionReason;
        const feeBps = shouldIncludeConvenienceFee ? Math.round(feePercent * 100) : undefined;
        const { fullAppData, appDataHash } = (0, helper_1.buildAppData)({ slippageBps, feeBps });
        const quoteRequest = {
            sellToken,
            buyToken,
            receiver: owner,
            from: owner,
            sellAmountBeforeFee: fromAmount.toString(),
            kind: 'sell',
            validFor: constants_1.COWSWAP_ORDER_VALIDITY_SECONDS,
            appData: fullAppData,
            appDataHash,
            priceQuality: 'optimal',
            signingScheme: isEthFlow ? 'eip1271' : 'presign',
            ...(isEthFlow
                ? {
                    onchainOrder: true,
                    verificationGasLimit: 0
                }
                : {})
        };
        const response = await this.#fetchWithTimeout(this.#getApiUrl(fromChainId, '/quote'), {
            method: 'POST',
            headers: this.#apiHeaders,
            body: JSON.stringify(quoteRequest)
        });
        const quoteResponse = await this.#parseResponse(response, 'Unable to fetch the quote.');
        const quotedOrder = quoteResponse.quote;
        if (!quotedOrder ||
            typeof quotedOrder.sellToken !== 'string' ||
            typeof quotedOrder.buyToken !== 'string' ||
            typeof quotedOrder.receiver !== 'string' ||
            typeof quotedOrder.sellAmount !== 'string' ||
            typeof quotedOrder.buyAmount !== 'string' ||
            typeof quotedOrder.feeAmount !== 'string' ||
            typeof quotedOrder.appData !== 'string') {
            throw new SwapAndBridgeProviderApiError_1.default('Unable to fetch the quote. CoW Swap returned incomplete order details.');
        }
        const returnedAppDataHash = quotedOrder.appDataHash ||
            (quotedOrder.appData.startsWith('0x') && quotedOrder.appData.length === 66
                ? quotedOrder.appData
                : null);
        if (quotedOrder.sellToken.toLowerCase() !== sellToken.toLowerCase() ||
            quotedOrder.buyToken.toLowerCase() !== buyToken.toLowerCase() ||
            quotedOrder.receiver.toLowerCase() !== owner.toLowerCase() ||
            quotedOrder.kind !== 'sell' ||
            quotedOrder.partiallyFillable !== false ||
            quotedOrder.signingScheme !== (isEthFlow ? 'eip1271' : 'presign') ||
            returnedAppDataHash?.toLowerCase() !== appDataHash.toLowerCase() ||
            !Number.isInteger(quotedOrder.validTo) ||
            quotedOrder.validTo <= Math.floor(Date.now() / 1000) ||
            !Number.isSafeInteger(quoteResponse.id) ||
            Number(quoteResponse.id) < 0) {
            throw new SwapAndBridgeProviderApiError_1.default('Unable to fetch the quote. CoW Swap returned order details that do not match your request.');
        }
        let quotedSellAmount;
        let quotedBuyAmount;
        let networkFee;
        try {
            quotedSellAmount = BigInt(quotedOrder.sellAmount);
            quotedBuyAmount = BigInt(quotedOrder.buyAmount);
            networkFee = BigInt(quotedOrder.feeAmount);
        }
        catch {
            throw new SwapAndBridgeProviderApiError_1.default('Unable to fetch the quote. CoW Swap returned invalid token amounts.');
        }
        const sellAmount = quotedSellAmount + networkFee;
        if (sellAmount !== fromAmount || quotedSellAmount <= 0n) {
            throw new SwapAndBridgeProviderApiError_1.default('Unable to fetch the quote. CoW Swap returned an unexpected spend amount.');
        }
        const protocolFeeBps = Number(quoteResponse.protocolFeeBps || 0);
        if (!Number.isFinite(protocolFeeBps) || protocolFeeBps < 0) {
            throw new SwapAndBridgeProviderApiError_1.default('Unable to fetch the quote. CoW Swap returned an invalid fee.');
        }
        const networkFeeInBuyToken = (quotedBuyAmount * networkFee) / quotedSellAmount;
        const protocolFee = (0, helper_1.getProtocolFeeAmount)(quotedBuyAmount, protocolFeeBps);
        const buyAmountBeforeFees = quotedBuyAmount + networkFeeInBuyToken + protocolFee;
        const partnerFee = feeBps ? (buyAmountBeforeFees * BigInt(feeBps)) / 10000n : 0n;
        // What the user actually receives: CoW Swap deducts the settlement network cost
        // from the output instead of charging gas separately
        const toAmountAfterNetworkCost = quotedBuyAmount - partnerFee;
        // Other providers quote their output before gas and charge gas separately, so the
        // displayed toAmount adds the network cost back to compare all quotes the same way
        const toAmount = toAmountAfterNetworkCost + networkFeeInBuyToken;
        // Must be derived from the amount after the network cost, otherwise the order asks
        // for more than solvers can deliver and it would never be filled
        const minAmountOut = toAmountAfterNetworkCost - (toAmountAfterNetworkCost * BigInt(slippageBps)) / 10000n;
        if (toAmountAfterNetworkCost <= 0n || minAmountOut <= 0n) {
            throw new SwapAndBridgeProviderApiError_1.default('Unable to fetch the quote. The expected receive amount is too low.');
        }
        const order = {
            sellToken,
            buyToken,
            receiver: owner,
            sellAmount: sellAmount.toString(),
            buyAmount: minAmountOut.toString(),
            validTo: quotedOrder.validTo,
            appData: fullAppData,
            appDataHash,
            feeAmount: '0',
            kind: 'sell',
            partiallyFillable: false,
            sellTokenBalance: 'erc20',
            buyTokenBalance: 'erc20',
            signingScheme: isEthFlow ? 'eip1271' : 'presign',
            signature: '0x',
            from: owner,
            quoteId: quoteResponse.id ?? null
        };
        const orderUid = (0, helper_1.computeOrderUid)({ chainId: fromChainId, order, owner, isEthFlow });
        const normalizedFromAsset = (0, swapAndBridge_1.convertPortfolioTokenToSwapAndBridgeToToken)(fromAsset, fromChainId);
        const protocol = { name: 'CoW Swap', displayName: 'CoW Swap', icon: '' };
        const serviceTime = 10;
        const inputValueInUsd = Number((0, helper_2.getTokenUsdAmount)(fromAsset, sellAmount) || 0);
        const outputValueInUsd = (0, helper_1.getOutputValueInUsd)({
            inputValueInUsd,
            toAsset,
            toAmount: toAmount.toString(),
            buyAmountBeforeFees
        });
        const outputValueAfterNetworkCostInUsd = (0, helper_1.getOutputValueInUsd)({
            inputValueInUsd,
            toAsset,
            toAmount: toAmountAfterNetworkCost.toString(),
            buyAmountBeforeFees
        });
        const userTx = {
            userTxIndex: 0,
            fromAsset: normalizedFromAsset,
            toAsset,
            chainId: fromChainId,
            fromAmount: sellAmount.toString(),
            toAmount: toAmount.toString(),
            swapSlippage: slippageBps / 100,
            serviceTime,
            protocol,
            minAmountOut: minAmountOut.toString()
        };
        const step = { ...userTx, type: 'swap' };
        const rawRoute = { quoteResponse, order, isEthFlow };
        const route = {
            providerId: this.id,
            routeId: orderUid,
            currentUserTxIndex: 0,
            fromChainId,
            toChainId,
            userAddress: owner,
            isOnlySwapRoute: true,
            fromAmount: sellAmount.toString(),
            toAmount: toAmount.toString(),
            usedDexName: 'CoW Swap',
            userTxs: [userTx],
            sender: owner,
            steps: [step],
            inputValueInUsd,
            outputValueInUsd,
            // The settlement network cost is what CoW Swap charges instead of gas, so the route
            // sorting compares the amount after it against other providers' after-gas values.
            // The gas of the user's own setPreSignature / ETH-flow createOrder tx is not included
            outputValueAfterGasInUsd: outputValueAfterNetworkCostInUsd,
            networkFeeInToToken: networkFeeInBuyToken.toString(),
            serviceTime,
            rawRoute,
            toToken: {
                address: toAsset.address,
                chainId: toAsset.chainId,
                decimals: toAsset.decimals,
                logoURI: toAsset.icon || '',
                name: toAsset.name,
                priceUSD: toAsset.priceUSD,
                symbol: toAsset.symbol
            },
            disabled: false,
            withConvenienceFee: shouldIncludeConvenienceFee,
            feeExemptionReason,
            isIntent: true
        };
        return {
            fromAsset: normalizedFromAsset,
            fromChainId,
            toAsset,
            toChainId,
            selectedRoute: undefined,
            selectedRouteSteps: [],
            routes: [route]
        };
    }
    async startRoute(route) {
        if (!this.areChainsSupported({ fromChainId: route.fromChainId, toChainId: route.toChainId }) ||
            !('order' in route.rawRoute) ||
            typeof route.rawRoute.order.from !== 'string' ||
            route.rawRoute.order.from.toLowerCase() !== route.userAddress.toLowerCase()) {
            throw new SwapAndBridgeProviderApiError_1.default('Unable to start the CoW Swap route because the order details do not match your account.');
        }
        const rawRoute = route.rawRoute;
        let orderUid;
        try {
            orderUid = (0, helper_1.computeOrderUid)({
                chainId: route.fromChainId,
                order: rawRoute.order,
                owner: route.userAddress,
                isEthFlow: rawRoute.isEthFlow
            });
        }
        catch {
            throw new SwapAndBridgeProviderApiError_1.default('Unable to start the CoW Swap route because the order details are invalid.');
        }
        if (orderUid !== route.routeId) {
            throw new SwapAndBridgeProviderApiError_1.default('Unable to start the CoW Swap route because the order details changed.');
        }
        if (rawRoute.isEthFlow) {
            const wrappedNativeTokenAddress = (0, helper_1.getWrappedNativeTokenAddress)(route.fromChainId);
            const quoteId = rawRoute.order.quoteId;
            const quotedOrder = rawRoute.quoteResponse.quote;
            if (!wrappedNativeTokenAddress ||
                rawRoute.order.signingScheme !== 'eip1271' ||
                quotedOrder.signingScheme !== 'eip1271' ||
                rawRoute.order.sellToken.toLowerCase() !== wrappedNativeTokenAddress.toLowerCase() ||
                rawRoute.order.receiver.toLowerCase() === ethers_1.ZeroAddress.toLowerCase() ||
                rawRoute.order.validTo !== quotedOrder.validTo ||
                quoteId !== rawRoute.quoteResponse.id ||
                !Number.isSafeInteger(quoteId) ||
                Number(quoteId) < 0 ||
                (0, ethers_1.keccak256)((0, ethers_1.toUtf8Bytes)(rawRoute.order.appData)).toLowerCase() !==
                    rawRoute.order.appDataHash.toLowerCase()) {
                throw new SwapAndBridgeProviderApiError_1.default('Unable to start the CoW Swap route because the ETH order details changed.');
            }
            await this.#uploadAppData(route.fromChainId, rawRoute.order.appDataHash, rawRoute.order.appData);
            let value;
            try {
                value = (BigInt(rawRoute.order.sellAmount) + BigInt(rawRoute.order.feeAmount)).toString();
            }
            catch {
                throw new SwapAndBridgeProviderApiError_1.default('Unable to start the CoW Swap route because the ETH amount is invalid.');
            }
            return {
                activeRouteId: route.routeId,
                approvalData: null,
                chainId: route.fromChainId,
                txTarget: constants_1.COWSWAP_ETH_FLOW_ADDRESS,
                userTxIndex: 0,
                value,
                txData: helper_1.ethFlowInterface.encodeFunctionData('createOrder', [
                    {
                        buyToken: rawRoute.order.buyToken,
                        receiver: rawRoute.order.receiver,
                        sellAmount: rawRoute.order.sellAmount,
                        buyAmount: rawRoute.order.buyAmount,
                        appData: rawRoute.order.appDataHash,
                        feeAmount: rawRoute.order.feeAmount,
                        validTo: rawRoute.order.validTo,
                        partiallyFillable: rawRoute.order.partiallyFillable,
                        quoteId
                    }
                ])
            };
        }
        if (rawRoute.order.signingScheme !== 'presign') {
            throw new SwapAndBridgeProviderApiError_1.default('Unable to start the CoW Swap route because the order signing method changed.');
        }
        return {
            activeRouteId: route.routeId,
            approvalData: {
                allowanceTarget: constants_1.COWSWAP_VAULT_RELAYER_ADDRESS,
                approvalTokenAddress: rawRoute.order.sellToken,
                minimumApprovalAmount: rawRoute.order.sellAmount,
                owner: route.userAddress
            },
            chainId: route.fromChainId,
            txTarget: constants_1.COWSWAP_SETTLEMENT_ADDRESS,
            userTxIndex: 0,
            value: '0',
            txData: helper_1.settlementInterface.encodeFunctionData('setPreSignature', [route.routeId, true]),
            cowSwapOrder: (0, helper_1.getCowSwapOrderStruct)(rawRoute.order)
        };
    }
    async #getOrder(chainId, orderUid) {
        const response = await this.#fetchWithTimeout(this.#getApiUrl(chainId, `/orders/${orderUid}`), {
            headers: this.#apiHeaders
        });
        if (response.status === 404)
            return null;
        return this.#parseResponse(response, 'Unable to check the CoW Swap order.');
    }
    async #uploadAppData(chainId, appDataHash, fullAppData) {
        const response = await this.#fetchWithTimeout(this.#getApiUrl(chainId, `/app_data/${appDataHash}`), {
            method: 'PUT',
            headers: this.#apiHeaders,
            body: JSON.stringify({ fullAppData })
        });
        await this.#parseResponse(response, 'Unable to prepare the CoW Swap order.');
    }
    async #submitOrder(chainId, rawRoute, orderUid) {
        let computedOrderUid;
        try {
            computedOrderUid = (0, helper_1.computeOrderUid)({
                chainId,
                order: rawRoute.order,
                owner: rawRoute.order.from,
                isEthFlow: false
            });
        }
        catch {
            throw new SwapAndBridgeProviderApiError_1.default('Unable to submit the CoW Swap order because its details are invalid.');
        }
        if (computedOrderUid !== orderUid) {
            throw new SwapAndBridgeProviderApiError_1.default('Unable to submit the CoW Swap order because its details changed.');
        }
        const response = await this.#fetchWithTimeout(this.#getApiUrl(chainId, '/orders'), {
            method: 'POST',
            headers: this.#apiHeaders,
            body: JSON.stringify(rawRoute.order)
        });
        let body;
        try {
            body = await response.json();
        }
        catch (error) {
            const message = error?.message || 'no message';
            throw new SwapAndBridgeProviderApiError_1.default(`Unable to submit the CoW Swap order. CoW Swap returned an unexpected response. Error details: <${message}>`);
        }
        if (response.ok) {
            if (body !== orderUid) {
                throw new SwapAndBridgeProviderApiError_1.default('Unable to submit the CoW Swap order because its identifier did not match the approved order.');
            }
            return true;
        }
        const errorBody = body;
        if (errorBody.errorType === 'DuplicatedOrder')
            return true;
        if (errorBody.errorType === 'InsufficientAllowance') {
            // The approval and PreSign calls are in the same Ambire operation. CoW's order service can
            // briefly lag behind the mined approval, so status polling retries submission on the next pass.
            return false;
        }
        const message = errorBody.description || errorBody.message || errorBody.errorType || 'Unknown error';
        throw new SwapAndBridgeProviderApiError_1.default(`Unable to submit the CoW Swap order. CoW Swap responded: <${message}>`);
    }
    async #getSettlementTransaction(chainId, orderUid) {
        const params = new URLSearchParams({ orderUid, limit: '10' });
        const response = await this.#fetchWithTimeout(this.#getApiUrl(chainId, `/trades?${params.toString()}`, 'v2'), { headers: this.#apiHeaders });
        const trades = await this.#parseResponse(response, 'Unable to retrieve the completed CoW Swap transaction.');
        return trades.find((trade) => trade.txHash)?.txHash || null;
    }
    async getRouteStatus({ fromChainId, routeId, rawRoute }) {
        if (!routeId || !rawRoute || !('order' in rawRoute)) {
            throw new SwapAndBridgeProviderApiError_1.default('Unable to check the CoW Swap order because its details are missing.');
        }
        let order = await this.#getOrder(fromChainId, routeId);
        if (!order) {
            if (rawRoute.isEthFlow)
                return { status: null };
            const wasSubmitted = await this.#submitOrder(fromChainId, rawRoute, routeId);
            if (!wasSubmitted)
                return { status: null };
            order = await this.#getOrder(fromChainId, routeId);
        }
        if (!order || order.status === 'presignaturePending' || order.status === 'open') {
            return { status: null };
        }
        if (order.status === 'fulfilled') {
            return {
                status: 'completed',
                txnId: await this.#getSettlementTransaction(fromChainId, routeId)
            };
        }
        return { status: 'failed' };
    }
}
exports.CowSwapAPI = CowSwapAPI;
//# sourceMappingURL=api.js.map