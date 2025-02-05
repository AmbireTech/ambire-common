"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ethers_1 = require("ethers");
const generateSpoofSig = (signer) => {
    const SPOOF_SIGTYPE = '03';
    const abiCoder = new ethers_1.AbiCoder();
    const signature = abiCoder.encode(['address'], [signer]) + SPOOF_SIGTYPE;
    return signature;
};
exports.default = generateSpoofSig;
//# sourceMappingURL=generateSpoofSig.js.map