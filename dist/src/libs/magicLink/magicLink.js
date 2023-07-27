"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestMagicLink = void 0;
async function requestMagicLink(email, relayerUrl, fetch) {
    const resp = await fetch(`${relayerUrl}/email-vault/requestKey/${email}`);
    const result = await resp.json();
    if (result?.data?.secret)
        await fetch(`${relayerUrl}/email-vault/confirmationKey/${email}/${result.data.key}/${result.data.secret}`);
    if (!result.success)
        throw new Error(`magicLink: error getting magic link: ${result.message}`);
    return result.data;
}
exports.requestMagicLink = requestMagicLink;
//# sourceMappingURL=magicLink.js.map