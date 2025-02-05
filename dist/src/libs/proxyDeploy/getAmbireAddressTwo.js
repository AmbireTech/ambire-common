"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAmbireAccountAddress = void 0;
const ethers_1 = require("ethers");
function getAmbireAccountAddress(factoryAddress, bytecode) {
    return (0, ethers_1.getCreate2Address)(factoryAddress, (0, ethers_1.toBeHex)(0, 32), (0, ethers_1.keccak256)(bytecode));
}
exports.getAmbireAccountAddress = getAmbireAccountAddress;
//# sourceMappingURL=getAmbireAddressTwo.js.map