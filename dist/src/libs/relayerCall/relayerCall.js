"use strict";
/* eslint-disable no-prototype-builtins */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.relayerCall = exports.relayerCallUncaught = void 0;
const node_fetch_1 = __importDefault(require("node-fetch"));
class RelayerError extends Error {
    constructor(message, input, output) {
        super(`relayer call error: ${message}`);
        this.input = input;
        this.output = output;
    }
}
async function relayerCallUncaught(url, method = 'GET', body = null, headers = null) {
    if (!['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'].includes(method))
        return { success: false, message: 'bad method' };
    if (!url)
        return { success: false, message: 'no url or path' };
    if (body && ['GET', 'DELETE', 'HEAD'].includes(method))
        return { success: false, message: 'should not have a body' };
    const res = await (0, node_fetch_1.default)(url, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...headers
        },
        body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    const isStatusOk = res.status < 300 && res.status >= 200;
    try {
        const json = JSON.parse(text);
        if (!json.hasOwnProperty('success')) {
            return { success: isStatusOk, ...json, status: res.status };
        }
        return { ...json, success: json.success && isStatusOk, status: res.status };
    }
    catch (e) {
        return { success: false, data: text, status: res.status, message: 'no json in res' };
    }
}
exports.relayerCallUncaught = relayerCallUncaught;
async function relayerCall(path, method = 'GET', body = null, headers = null) {
    const res = await relayerCallUncaught(this.url + path, method, body, headers);
    if (!res.success)
        throw new RelayerError(res.message, { url: this.url, path, method, body, headers }, { res });
    return res;
}
exports.relayerCall = relayerCall;
//# sourceMappingURL=relayerCall.js.map