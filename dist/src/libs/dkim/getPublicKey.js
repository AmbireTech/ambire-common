/*
  fetch domainkey record (nodejs)
*/
const { promisify } = require("util");
const getKey = promisify(require("dkim/lib/get-key"));
export default function getPublicKey({ domain, selector }) {
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
;
/**
 * A wrapper to help getPublicKey reverts when a pub key is not found.
 * We don't want that
 *
 * @param {domain: string, selector: string}
 * @returns base64encoded | null
 */
export async function getPublicKeyIfAny({ domain, selector }) {
    try {
        const dkimKey = await getPublicKey({ domain, selector: selector });
        return dkimKey;
    }
    catch (e) {
        return null;
    }
}
//# sourceMappingURL=getPublicKey.js.map