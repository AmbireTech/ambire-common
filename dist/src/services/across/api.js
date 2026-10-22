"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AcrossAPI = void 0;
const tslib_1 = require("tslib");
const SwapAndBridgeProviderApiError_1 = tslib_1.__importDefault(require("../../classes/SwapAndBridgeProviderApiError"));
const constants_1 = require("./constants");
const isAcrossDepositNotFound = (response) => 'error' in response && response.error === 'DepositNotFoundException';
class AcrossAPI {
    #fetch;
    #requestTimeoutMs = 15000;
    constructor({ fetch }) {
        this.#fetch = fetch;
    }
    async getRouteStatus({ txHash }) {
        const params = new URLSearchParams({
            depositTxnRef: txHash
        });
        let response;
        let timeoutPromise;
        try {
            response = await Promise.race([
                this.#fetch(`${constants_1.ACROSS_API_BASE_URL}/deposit/status?${params.toString()}`),
                new Promise((_, reject) => {
                    timeoutPromise = setTimeout(() => {
                        reject(new SwapAndBridgeProviderApiError_1.default('Our service provider Across is temporarily unavailable or your internet connection is too slow.'));
                    }, this.#requestTimeoutMs);
                })
            ]);
        }
        catch (e) {
            if (e instanceof SwapAndBridgeProviderApiError_1.default)
                throw e;
            const message = e?.message || 'no message';
            const status = e?.status ? `, status: <${e.status}>` : '';
            throw new SwapAndBridgeProviderApiError_1.default(`Unable to get the route status. Please check back later to proceed. Our service provider Across could not be reached: <${message}>${status}`);
        }
        finally {
            if (timeoutPromise)
                clearTimeout(timeoutPromise);
        }
        let responseBody;
        try {
            responseBody = await response.json();
        }
        catch (e) {
            const message = e?.message || 'no message';
            throw new SwapAndBridgeProviderApiError_1.default(`Unable to get the route status. Please check back later to proceed. Error details: <Unexpected non-JSON response from our service provider Across>, message: <${message}>`);
        }
        if (!response.ok && !isAcrossDepositNotFound(responseBody)) {
            const upstreamMessage = 'message' in responseBody
                ? responseBody.message
                : JSON.stringify(responseBody).slice(0, 250);
            throw new SwapAndBridgeProviderApiError_1.default(`Unable to get the route status. Please check back later to proceed. Our service provider Across responded: <${upstreamMessage}>`);
        }
        if (isAcrossDepositNotFound(responseBody))
            return { status: null };
        if (responseBody.status === 'filled' && responseBody.fillTxnRef) {
            return { status: 'completed', txnId: responseBody.fillTxnRef };
        }
        if (responseBody.status === 'refunded' && responseBody.depositRefundTxnRef) {
            return { status: 'refunded', txnId: responseBody.depositRefundTxnRef };
        }
        return { status: null };
    }
}
exports.AcrossAPI = AcrossAPI;
//# sourceMappingURL=api.js.map