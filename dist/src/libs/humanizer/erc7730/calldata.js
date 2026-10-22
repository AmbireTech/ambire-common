"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAbiBytesCalldataWithPadding = exports.multiSendInterface = void 0;
const ethers_1 = require("ethers");
exports.multiSendInterface = new ethers_1.Interface(['function multiSend(bytes transactions)']);
const MULTI_SEND_SELECTOR = exports.multiSendInterface.getFunction('multiSend')?.selector || '0x8d80ff0a';
const getAbiBytesCalldataWithPadding = (data) => {
    const hex = data.slice(2);
    if (hex.slice(0, 8).toLowerCase() !== MULTI_SEND_SELECTOR.slice(2).toLowerCase())
        return data;
    try {
        const paramsOffset = Number(BigInt(`0x${hex.slice(8, 72)}`));
        const bytesLengthOffset = 8 + paramsOffset * 2;
        const bytesLength = Number(BigInt(`0x${hex.slice(bytesLengthOffset, bytesLengthOffset + 64)}`));
        const bytesStart = bytesLengthOffset + 64;
        const minimumHexLength = bytesStart + bytesLength * 2;
        const expectedHexLength = bytesStart + Math.ceil(bytesLength / 32) * 64;
        if (hex.length < minimumHexLength || hex.length >= expectedHexLength)
            return data;
        return `0x${hex.padEnd(expectedHexLength, '0')}`;
    }
    catch {
        return data;
    }
};
exports.getAbiBytesCalldataWithPadding = getAbiBytesCalldataWithPadding;
//# sourceMappingURL=calldata.js.map