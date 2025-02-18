"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const NodeRSA = require("node-rsa");
function publicKeyToComponents(publicKey) {
    const parsed = new NodeRSA(publicKey);
    const { e: exponent, n: modulus } = parsed.exportKey("components-public");
    return {
        exponent,
        modulus
    };
}
exports.default = publicKeyToComponents;
//# sourceMappingURL=publicKeyToComponents.js.map