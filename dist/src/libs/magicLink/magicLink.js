"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestMagicLink = requestMagicLink;
const relayerCall_1 = require("../relayerCall/relayerCall");
async function requestMagicLink(email, relayerUrl, fetch, options) {
    const callRelayer = relayerCall_1.relayerCall.bind({ url: relayerUrl, fetch });
    const flow = options?.flow;
    const result = await callRelayer(`/email-vault/request-key/${email}${flow ? `?flow=${flow}` : ''}`);
    // This is only for testing purposes, which acts as email confirmation
    if (result?.data?.secret && options?.autoConfirm)
        setTimeout(() => {
            // We don't use `relayerCall` here because this request returns HTML without a `success` flag,
            // which would wrongly throw RELAYER_DOWN error in the tests.
            fetch(`${relayerUrl}/email-vault/confirm-key/${email}/${result.data.key}/${result.data.secret}`);
        }, 2000);
    return result.data;
}
//# sourceMappingURL=magicLink.js.map