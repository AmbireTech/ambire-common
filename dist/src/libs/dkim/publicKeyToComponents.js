"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = publicKeyToComponents;
const NodeRSA = require("node-rsa");
function publicKeyToComponents(publicKey) {
    const parsed = new NodeRSA(publicKey);
    const { e: exponent, n: modulus } = parsed.exportKey("components-public");
    return {
        exponent,
        modulus
    };
}
//# sourceMappingURL=publicKeyToComponents.js.map