"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensMessageModule = void 0;
const utils_1 = require("../utils");
const ensMessageModule = (message) => {
    if (message.content.kind !== 'typedMessage')
        return { fullVisualization: [] };
    if (message.content.domain.name === 'Ethereum Name Service') {
        if (message.content.message.upload === 'avatar' &&
            message.content.message.name &&
            message.content.message.expiry)
            return {
                fullVisualization: [
                    (0, utils_1.getAction)('Update'),
                    (0, utils_1.getLabel)('ENS profile pic of'),
                    (0, utils_1.getLabel)(message.content.message.name),
                    (0, utils_1.getDeadline)(BigInt(message.content.message.expiry) / 1000n)
                ]
            };
    }
    return { fullVisualization: [] };
};
exports.ensMessageModule = ensMessageModule;
//# sourceMappingURL=ensModule.js.map