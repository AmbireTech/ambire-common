"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.legendsMessageModule = void 0;
const ethers_1 = require("ethers");
const utils_1 = require("../utils");
const legendsMessageModule = (message) => {
    if (message.content.kind !== 'message' || typeof message.content.message !== 'string')
        return { fullVisualization: [] };
    let messageAsText = message.content.message;
    if ((0, ethers_1.isHexString)(message.content.message) && message.content.message.length % 2 === 0) {
        messageAsText = (0, ethers_1.toUtf8String)((0, ethers_1.toUtf8Bytes)(message.content.message));
    }
    const messageRegex = /Assign 0x[a-fA-F0-9]{40} to Ambire Rewards 0x[a-fA-F0-9]{40}/;
    const addressRegex = /0x[a-fA-F0-9]{40}/g;
    const addresses = messageAsText.match(addressRegex);
    const firstAddr = addresses?.[0];
    const secondAddr = addresses?.[1];
    if (messageAsText.match(messageRegex) && firstAddr === message.accountAddr && secondAddr)
        return {
            fullVisualization: [
                (0, utils_1.getAction)('Link'),
                (0, utils_1.getAddressVisualization)(firstAddr),
                (0, utils_1.getLabel)('to'),
                (0, utils_1.getAddressVisualization)(secondAddr),
                (0, utils_1.getLabel)('for Ambire Rewards', true)
            ]
        };
    return { fullVisualization: [] };
};
exports.legendsMessageModule = legendsMessageModule;
//# sourceMappingURL=legendsModule.js.map