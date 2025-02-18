"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPublicKeyIfAny = void 0;
/*
  fetch domainkey record (nodejs)
*/
const { promisify } = require("util");
const getKey = promisify(require("dkim/lib/get-key"));
function getPublicKey({ domain, selector }) {
    return getKey(domain, selector).then((key) => {
        const publicKey = "-----BEGIN PUBLIC KEY-----\n" +
            key.key.toString("base64") +
            "\n-----END PUBLIC KEY-----";
        return {
            domain,
            selector,
            publicKey
        };
    });
}
exports.default = getPublicKey;
;
/**
 * A wrapper to help getPublicKey reverts when a pub key is not found.
 * We don't want that
 *
 * @param {domain: string, selector: string}
 * @returns base64encoded | null
 */
async function getPublicKeyIfAny({ domain, selector }) {
    try {
        const dkimKey = await getPublicKey({ domain, selector: selector });
        return dkimKey;
    }
    catch (e) {
        return null;
    }
}
exports.getPublicKeyIfAny = getPublicKeyIfAny;
//# sourceMappingURL=getPublicKey.js.map