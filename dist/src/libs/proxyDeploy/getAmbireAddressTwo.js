"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAmbireAccountAddress = void 0;
const ethers_1 = require("ethers");
function getAmbireAccountAddress(factoryAddress, bytecode) {
    return ethers_1.ethers.getCreate2Address(factoryAddress, ethers_1.ethers.toBeHex(0, 32), ethers_1.ethers.keccak256(bytecode));
}
exports.getAmbireAccountAddress = getAmbireAccountAddress;
//# sourceMappingURL=getAmbireAddressTwo.js.map