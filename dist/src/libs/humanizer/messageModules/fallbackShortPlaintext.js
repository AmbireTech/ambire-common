"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fallbackShortPlaintext = void 0;
const ethers_1 = require("ethers");
const utils_1 = require("../utils");
const fallbackShortPlaintext = (message) => {
    if (message.content.kind !== 'message' ||
        typeof message.content.message !== 'string' ||
        message.content.message.length >= 200)
        return { fullVisualization: [] };
    // the message should be hex always. If it is not, the issue is not in this module and
    // should be resolved upstream
    const readableText = (0, ethers_1.toUtf8String)(message.content.message);
    if (readableText.includes('\n'))
        return { fullVisualization: [] };
    return {
        fullVisualization: [
            (0, utils_1.getAction)('Message: '),
            ...readableText
                .split(' ')
                .map((w) => ((0, ethers_1.isAddress)(w) ? (0, utils_1.getAddressVisualization)(w) : (0, utils_1.getLabel)(w)))
        ],
        canHideDropdownArrow: true
    };
};
exports.fallbackShortPlaintext = fallbackShortPlaintext;
//# sourceMappingURL=fallbackShortPlaintext.js.map