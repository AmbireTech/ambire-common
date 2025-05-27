"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.get7702SigV = get7702SigV;
const ethers_1 = require("ethers");
function get7702SigV(signature) {
    return signature.yParity === '0x00' ? (0, ethers_1.toBeHex)(27) : (0, ethers_1.toBeHex)(28);
}
//# sourceMappingURL=utils.js.map