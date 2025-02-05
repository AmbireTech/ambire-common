"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.asciiModule = void 0;
/* eslint-disable no-await-in-loop */
const ethers_1 = require("ethers");
const utils_1 = require("../../utils");
const asciiModule = (accountOp, currentIrCalls) => {
    const newCalls = currentIrCalls.map((call) => {
        if (call.data === '0x')
            return call;
        if (call.fullVisualization && !(0, utils_1.checkIfUnknownAction)(call?.fullVisualization))
            return call;
        let messageAsText;
        try {
            messageAsText = (0, ethers_1.toUtf8String)(call.data);
        }
        catch {
            return call;
        }
        const sendNativeHumanization = call.value
            ? [(0, utils_1.getLabel)('and'), (0, utils_1.getAction)('Send'), (0, utils_1.getToken)(ethers_1.ZeroAddress, call.value)]
            : [];
        return {
            ...call,
            fullVisualization: [
                (0, utils_1.getAction)('Send this message'),
                (0, utils_1.getLabel)('to'),
                (0, utils_1.getAddressVisualization)(call.to),
                (0, utils_1.getText)(messageAsText),
                ...sendNativeHumanization
            ]
        };
    });
    return newCalls;
};
exports.asciiModule = asciiModule;
//# sourceMappingURL=asciiModule.js.map