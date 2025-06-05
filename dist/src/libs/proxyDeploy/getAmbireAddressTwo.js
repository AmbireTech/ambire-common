"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAmbireAccountAddress = getAmbireAccountAddress;
const ethers_1 = require("ethers");
function getAmbireAccountAddress(factoryAddress, bytecode) {
    return (0, ethers_1.getCreate2Address)(factoryAddress, (0, ethers_1.toBeHex)(0, 32), (0, ethers_1.keccak256)(bytecode));
}
//# sourceMappingURL=getAmbireAddressTwo.js.map