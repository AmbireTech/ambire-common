"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAddressCaught = void 0;
const ethers_1 = require("ethers");
/**
 * Wraps getAddress because it throws an error if the address is invalid.
 * Instead, this function will return an empty string if the address is invalid.
 */
const getAddressCaught = (address) => {
    try {
        const addr = (0, ethers_1.getAddress)(address);
        return addr;
    }
    catch (error) {
        console.error(`Invalid address: ${address}. Error:`, error);
        return '';
    }
};
exports.getAddressCaught = getAddressCaught;
//# sourceMappingURL=getAddressCaught.js.map