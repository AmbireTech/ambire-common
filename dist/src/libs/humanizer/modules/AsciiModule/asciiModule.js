"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.asciiModule = void 0;
const ethers_1 = require("ethers");
const utils_1 = require("../../utils");
function tryGetMEssageAsText(msg) {
    const bytes = (0, ethers_1.getBytes)(msg);
    const expectedPortionOfValidChars = 0.9;
    const numberOfValidCharacters = bytes.filter((x) => x >= 0x20 && x <= 0x7e).length;
    if (bytes.length * expectedPortionOfValidChars < numberOfValidCharacters) {
        try {
            return (0, ethers_1.toUtf8String)(msg);
        }
        catch (_) {
            return null;
        }
    }
    return null;
}
const asciiModule = (accountOp, currentIrCalls) => {
    const newCalls = currentIrCalls.map((call) => {
        if (!call.data || call.data === '0x')
            return call;
        if (call.fullVisualization)
            return call;
        // assuming that if there are only 4 bytes it is probably just contract method call
        // and further logic is irrelevant
        if (call.data.length === '0x12345678'.length)
            return call;
        let messageAsText = tryGetMEssageAsText(call.data);
        if (!messageAsText)
            return call;
        return {
            ...call,
            fullVisualization: call.to
                ? [
                    (0, utils_1.getAction)('Send this message'),
                    (0, utils_1.getLabel)('to'),
                    (0, utils_1.getAddressVisualization)(call.to),
                    (0, utils_1.getText)(messageAsText)
                ]
                : [(0, utils_1.getAction)('Send this message'), (0, utils_1.getText)(messageAsText)]
        };
    });
    return newCalls;
};
exports.asciiModule = asciiModule;
//# sourceMappingURL=asciiModule.js.map