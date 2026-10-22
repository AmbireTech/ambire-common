"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchRelayerResource = void 0;
const with_timeout_1 = require("../../../utils/with-timeout");
const consts_1 = require("./consts");
const getRelayerPayload = (response, path) => {
    if (response?.success === false) {
        throw new Error(`Failed to fetch ERC-7730 relayer resource: ${path}`);
    }
    if (response?.data !== undefined)
        return response.data;
    if (response?.success === undefined)
        return response;
    const { success, status, errorState, message, ...payload } = response;
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        throw new Error(`Invalid ERC-7730 relayer resource response: ${path}`);
    }
    return payload;
};
/**
 * Fetch and validate the resource from the relayer.
 * We have this wrapper mainly because of the validate method
 */
const fetchRelayerResource = async (path, method, callRelayer, validate, body) => {
    const response = await (0, with_timeout_1.withTimeout)(() => callRelayer(path, method, body, undefined, consts_1.ERC7730_DESCRIPTOR_WAIT_MS), {
        timeoutMs: consts_1.ERC7730_DESCRIPTOR_WAIT_MS,
        message: `Timed out fetching ERC-7730 relayer resource: ${path}`
    });
    const payload = getRelayerPayload(response, path);
    if (!validate(payload, path)) {
        throw new Error(`Invalid ERC-7730 relayer resource response: ${path}`);
    }
    return payload;
};
exports.fetchRelayerResource = fetchRelayerResource;
//# sourceMappingURL=fetch.js.map