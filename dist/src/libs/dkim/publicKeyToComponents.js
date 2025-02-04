const NodeRSA = require("node-rsa");
export default function publicKeyToComponents(publicKey) {
    const parsed = new NodeRSA(publicKey);
    const { e: exponent, n: modulus } = parsed.exportKey("components-public");
    return {
        exponent,
        modulus
    };
}
//# sourceMappingURL=publicKeyToComponents.js.map