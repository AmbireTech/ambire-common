"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.zealyMessageModule = void 0;
const ethers_1 = require("ethers");
const utils_1 = require("../utils");
const zealyMessageModule = (message) => {
    if (message.content.kind !== 'message' || typeof message.content.message !== 'string')
        return { fullVisualization: [] };
    let messageAsText = message.content.message;
    if ((0, ethers_1.isHexString)(message.content.message) && message.content.message.length % 2 === 0) {
        messageAsText = (0, ethers_1.toUtf8String)(message.content.message);
    }
    if (messageAsText.startsWith('zealy.io wants you to sign in with your Ethereum account'))
        return { fullVisualization: [(0, utils_1.getAction)('Login'), (0, utils_1.getLabel)('in'), (0, utils_1.getLabel)('Zealy', true)] };
    return { fullVisualization: [] };
};
exports.zealyMessageModule = zealyMessageModule;
//# sourceMappingURL=zealyModule.js.map