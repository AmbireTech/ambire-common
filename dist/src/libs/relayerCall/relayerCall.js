"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.relayerCall = exports.relayerCallUncaught = exports.RELAYER_DOWN_MESSAGE = exports.RelayerError = void 0;
const richJson_1 = require("../richJson/richJson");
class RelayerError extends Error {
    input;
    output;
    constructor(message, input, output) {
        super(message);
        this.input = input;
        this.output = output;
    }
}
exports.RelayerError = RelayerError;
exports.RELAYER_DOWN_MESSAGE = 'Currently, the Ambire relayer seems to be temporarily down. Please try again a few moments later';
async function relayerCallUncaught(url, fetch, method = 'GET', body = null, headers = null) {
    if (!['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'].includes(method))
        return { success: false, message: 'bad method' };
    if (!url)
        return { success: false, message: 'no url or path' };
    if (body && ['GET', 'DELETE', 'HEAD'].includes(method))
        return { success: false, message: 'should not have a body' };
    const res = await fetch(url, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...headers
        },
        body: body ? (0, richJson_1.stringify)(body) : undefined
    });
    const text = await res.text();
    const isStatusOk = res.status < 300 && res.status >= 200;
    try {
        const json = (0, richJson_1.parse)(text);
        if (!json.hasOwnProperty('success')) {
            return { success: isStatusOk, ...json, status: res.status };
        }
        return { ...json, success: json.success && isStatusOk, status: res.status };
    }
    catch (e) {
        return {
            success: false,
            data: text,
            status: res.status,
            message: exports.RELAYER_DOWN_MESSAGE
        };
    }
}
exports.relayerCallUncaught = relayerCallUncaught;
async function relayerCall(path, method = 'GET', body = null, headers = null) {
    const res = await relayerCallUncaught(this.url + path, this.fetch, method, body, headers);
    if (!res.success) {
        const firstError = res.errorState && res.errorState.length ? res.errorState[0].message : res.message;
        throw new RelayerError(firstError, { url: this.url, path, method, body, headers }, { res });
    }
    return res;
}
exports.relayerCall = relayerCall;
//# sourceMappingURL=relayerCall.js.map