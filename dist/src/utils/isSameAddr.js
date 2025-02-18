"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ethers_1 = require("ethers");
const isSameAddr = (one, two) => {
    return (0, ethers_1.getAddress)(one) === (0, ethers_1.getAddress)(two);
};
exports.default = isSameAddr;
//# sourceMappingURL=isSameAddr.js.map