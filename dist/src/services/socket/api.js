import { getAddress } from 'ethers';
import SwapAndBridgeProviderApiError from '../../classes/SwapAndBridgeProviderApiError';
import { AMBIRE_FEE_TAKER_ADDRESSES, AMBIRE_WALLET_TOKEN_ON_BASE, AMBIRE_WALLET_TOKEN_ON_ETHEREUM, ETH_ON_OPTIMISM_LEGACY_ADDRESS, FEE_PERCENT, NULL_ADDRESS, ZERO_ADDRESS } from './constants';
const convertZeroAddressToNullAddressIfNeeded = (addr) => addr === ZERO_ADDRESS ? NULL_ADDRESS : addr;
const convertNullAddressToZeroAddressIfNeeded = (addr) => addr === NULL_ADDRESS ? ZERO_ADDRESS : addr;
const normalizeIncomingSocketTokenAddress = (address) => 
// incoming token addresses from Socket are all lowercased
getAddress(
// native token addresses come as null address instead of the zero address
convertNullAddressToZeroAddressIfNeeded(address));
export const normalizeIncomingSocketToken = (token) => ({
    ...token,
    address: normalizeIncomingSocketTokenAddress(token.address)
});
const normalizeOutgoingSocketTokenAddress = (address) => 
// Socket expects to receive null address instead of the zero address for native tokens.
convertZeroAddressToNullAddressIfNeeded(
// Socket works only with all lowercased token addresses, otherwise, bad request
address.toLocaleLowerCase());
const normalizeOutgoingSocketToken = (token) => ({
    ...token,
    address: normalizeOutgoingSocketTokenAddress(token.address)
});
export class SocketAPI {
    #fetch;
    #baseUrl = 'https://api.socket.tech/v2';
    #headers;
    isHealthy = null;
    constructor({ fetch, apiKey }) {
        this.#fetch = fetch;
        this.#headers = {
            'API-KEY': apiKey,
            Accept: 'application/json',
            'Content-Type': 'application/json'
        };
    }
    async getHealth() {
        try {
            const response = await this.#fetch(`${this.#baseUrl}/health`, { headers: this.#headers });
            if (!response.ok)
                return false;
            const body = await response.json();
            return !!body.ok;
        }
        catch {
            return false;
        }
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
    /**
     * Processes Socket API responses and throws custom errors for various
     * failures, including handling the API's unique response structure.
     */
    async #handleResponse({ fetchPromise, errorPrefix }) {
        let response;
        try {
            response = await fetchPromise;
        }
        catch (e) {
            const message = e?.message || 'no message';
            const status = e?.status ? `, status: <${e.status}>` : '';
            const error = `${errorPrefix} Upstream error: <${message}>${status}`;
            throw new SwapAndBridgeProviderApiError(error);
        }
        let responseBody;
        try {
            responseBody = await response.json();
        }
        catch (e) {
            const message = e?.message || 'no message';
            const error = `${errorPrefix} Error details: Unexpected non-JSON response from our service provider, message: <${message}>`;
            throw new SwapAndBridgeProviderApiError(error);
        }
        // Socket API returns 500 status code with a message in the body, even
        // in case of a bad request. Not necessarily an internal server error.
        if (!response.ok || !responseBody?.success) {
            // API returns 2 types of errors, a generic one, on the top level:
            const genericErrorMessage = responseBody?.message?.error || 'no message';
            // ... and a detailed one, nested in the `details` object:
            const specificError = responseBody?.message?.details?.error?.message;
            const specificErrorMessage = specificError ? `, details: <${specificError}>` : '';
            const specificErrorCode = responseBody?.message?.details?.error?.code;
            const specificErrorCodeMessage = specificErrorCode ? `, code: <${specificErrorCode}>` : '';
            const error = `${errorPrefix} Our service provider upstream error: <${genericErrorMessage}>${specificErrorMessage}${specificErrorCodeMessage}`;
            throw new SwapAndBridgeProviderApiError(error);
        }
        // Always attempt to update health status (if needed) when a response was
        // successful, in case the API was previously unhealthy (to recover).
        // Do not wait on purpose, to not block or delay the response
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.updateHealthIfNeeded();
        return responseBody.result;
    }
    async getSupportedChains() {
        const url = `${this.#baseUrl}/supported/chains`;
        const response = await this.#handleResponse({
            fetchPromise: this.#fetch(url, { headers: this.#headers }),
            errorPrefix: 'Unable to retrieve the list of supported Swap & Bridge chains from our service provider.'
        });
        return response;
    }
    async getToTokenList({ fromChainId, toChainId }) {
        const params = new URLSearchParams({
            fromChainId: fromChainId.toString(),
            toChainId: toChainId.toString(),
            // The long list for some networks is HUGE (e.g. Ethereum has 10,000+ tokens),
            // which makes serialization and deserialization of this controller computationally expensive.
            isShortList: 'true'
        });
        const url = `${this.#baseUrl}/token-lists/to-token-list?${params.toString()}`;
        let response = await this.#handleResponse({
            fetchPromise: this.#fetch(url, { headers: this.#headers }),
            errorPrefix: 'Unable to retrieve the list of supported receive tokens. Please reload to try again.'
        });
        // Exception for Optimism, strip out the legacy ETH address
        // TODO: Remove when Socket removes the legacy ETH address from their response
        if (toChainId === 10)
            response = response.filter((token) => token.address !== ETH_ON_OPTIMISM_LEGACY_ADDRESS);
        // Exception for Ethereum, duplicate ETH tokens are incoming from the API.
        // One is with the `ZERO_ADDRESS` and one with `NULL_ADDRESS`, both for ETH.
        // Strip out the one with the `ZERO_ADDRESS` to be consistent with the rest.
        if (toChainId === 1)
            response = response.filter((token) => token.address !== ZERO_ADDRESS);
        // Since v4.41.0 we request the shortlist from Socket, which does not include
        // the Ambire $WALLET token. So adding it manually on the supported chains.
        if (toChainId === 1)
            response.unshift(AMBIRE_WALLET_TOKEN_ON_ETHEREUM);
        if (toChainId === 8453)
            response.unshift(AMBIRE_WALLET_TOKEN_ON_BASE);
        return response.map(normalizeIncomingSocketToken);
    }
    async getToken({ address, chainId }) {
        const params = new URLSearchParams({
            address: address.toString(),
            chainId: chainId.toString()
        });
        const url = `${this.#baseUrl}/supported/token-support?${params.toString()}`;
        const response = await this.#handleResponse({
            fetchPromise: this.#fetch(url, { headers: this.#headers }),
            errorPrefix: 'Unable to retrieve token information by address.'
        });
        if (!response.isSupported || !response.token)
            return null;
        return normalizeIncomingSocketToken(response.token);
    }
    async quote({ fromChainId, fromTokenAddress, toChainId, toTokenAddress, fromAmount, userAddress, isSmartAccount, sort, isOG }) {
        const params = new URLSearchParams({
            fromChainId: fromChainId.toString(),
            fromTokenAddress: normalizeOutgoingSocketTokenAddress(fromTokenAddress),
            toChainId: toChainId.toString(),
            toTokenAddress: normalizeOutgoingSocketTokenAddress(toTokenAddress),
            fromAmount: fromAmount.toString(),
            userAddress,
            isContractCall: isSmartAccount.toString(),
            sort,
            singleTxOnly: 'false',
            defaultSwapSlippage: '1',
            uniqueRoutesPerBridge: 'true'
        });
        const feeTakerAddress = AMBIRE_FEE_TAKER_ADDRESSES[fromChainId];
        const shouldIncludeConvenienceFee = !!feeTakerAddress && !isOG;
        if (shouldIncludeConvenienceFee) {
            params.append('feeTakerAddress', feeTakerAddress);
            params.append('feePercent', FEE_PERCENT.toString());
        }
        // TODO: Temporarily exclude Mayan bridge when fetching quotes for SA, as
        // batching is currently not not supported by Mayan (and funds get lost).
        if (isSmartAccount)
            params.append('excludeBridges', ['mayan'].join(','));
        const url = `${this.#baseUrl}/quote?${params.toString()}`;
        const response = await this.#handleResponse({
            fetchPromise: this.#fetch(url, { headers: this.#headers }),
            errorPrefix: 'Unable to fetch the quote.'
        });
        return {
            ...response,
            fromAsset: normalizeIncomingSocketToken(response.fromAsset),
            toAsset: normalizeIncomingSocketToken(response.toAsset),
            routes: response.routes.map((route) => ({
                ...route,
                userTxs: route.userTxs.map((userTx) => ({
                    ...userTx,
                    ...('fromAsset' in userTx && {
                        fromAsset: normalizeIncomingSocketToken(userTx.fromAsset)
                    }),
                    toAsset: normalizeIncomingSocketToken(userTx.toAsset),
                    ...('steps' in userTx && {
                        steps: userTx.steps.map((step) => ({
                            ...step,
                            fromAsset: normalizeIncomingSocketToken(step.fromAsset),
                            toAsset: normalizeIncomingSocketToken(step.toAsset)
                        }))
                    })
                }))
            }))
        };
    }
    async startRoute({ fromChainId, toChainId, fromAssetAddress, toAssetAddress, route }) {
        const params = {
            fromChainId,
            toChainId,
            fromAssetAddress: normalizeOutgoingSocketTokenAddress(fromAssetAddress),
            toAssetAddress: normalizeOutgoingSocketTokenAddress(toAssetAddress),
            includeFirstTxDetails: true,
            route: {
                ...route,
                userTxs: route.userTxs.map((userTx) => ({
                    ...userTx,
                    // @ts-ignore fromAsset exists on one of the two userTx sub-types
                    fromAsset: userTx?.fromAsset ? normalizeOutgoingSocketToken(userTx.fromAsset) : undefined,
                    toAsset: {
                        ...userTx.toAsset,
                        address: normalizeOutgoingSocketTokenAddress(userTx.toAsset.address)
                    },
                    // @ts-ignore fromAsset exists on one of the two userTx sub-types
                    steps: userTx.steps
                        ? // @ts-ignore fromAsset exists on one of the two userTx sub-types
                            userTx.steps.map((step) => ({
                                ...step,
                                fromAsset: normalizeOutgoingSocketToken(step.fromAsset),
                                toAsset: normalizeOutgoingSocketToken(step.toAsset)
                            }))
                        : undefined
                }))
            }
        };
        const response = await this.#handleResponse({
            fetchPromise: this.#fetch(`${this.#baseUrl}/route/start`, {
                method: 'POST',
                headers: this.#headers,
                body: JSON.stringify(params)
            }),
            errorPrefix: 'Unable to start the route.'
        });
        return response;
    }
    async getRouteStatus({ activeRouteId, userTxIndex, txHash }) {
        const params = new URLSearchParams({
            activeRouteId: activeRouteId.toString(),
            userTxIndex: userTxIndex.toString(),
            txHash
        });
        const url = `${this.#baseUrl}/route/prepare?${params.toString()}`;
        const response = await this.#handleResponse({
            fetchPromise: this.#fetch(url, { headers: this.#headers }),
            errorPrefix: 'Unable to get the route status. Please check back later to proceed.'
        });
        return response;
    }
    async updateActiveRoute(activeRouteId) {
        const params = new URLSearchParams({ activeRouteId: activeRouteId.toString() });
        const url = `${this.#baseUrl}/route/active-routes?${params.toString()}`;
        const response = await this.#handleResponse({
            fetchPromise: this.#fetch(url, { headers: this.#headers }),
            errorPrefix: 'Unable to update the active route.'
        });
        return {
            ...response,
            fromAsset: normalizeIncomingSocketToken(response.fromAsset),
            fromAssetAddress: normalizeIncomingSocketTokenAddress(response.fromAssetAddress),
            toAsset: normalizeIncomingSocketToken(response.toAsset),
            toAssetAddress: normalizeIncomingSocketTokenAddress(response.toAssetAddress),
            userTxs: response.userTxs.map((userTx) => ({
                ...userTx,
                ...('fromAsset' in userTx && { fromAsset: normalizeIncomingSocketToken(userTx.fromAsset) }),
                toAsset: normalizeIncomingSocketToken(userTx.toAsset),
                ...('steps' in userTx && {
                    steps: userTx.steps.map((step) => ({
                        ...step,
                        fromAsset: normalizeIncomingSocketToken(step.fromAsset),
                        toAsset: normalizeIncomingSocketToken(step.toAsset)
                    }))
                })
            }))
        };
    }
    async getNextRouteUserTx(activeRouteId) {
        const params = new URLSearchParams({ activeRouteId: activeRouteId.toString() });
        const url = `${this.#baseUrl}/route/build-next-tx?${params.toString()}`;
        const response = await this.#handleResponse({
            fetchPromise: this.#fetch(url, { headers: this.#headers }),
            errorPrefix: 'Unable to start the next step.'
        });
        return response;
    }
}
//# sourceMappingURL=api.js.map