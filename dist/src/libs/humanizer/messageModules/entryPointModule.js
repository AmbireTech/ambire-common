"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.entryPointModule = void 0;
const userOperation_1 = require("../../userOperation/userOperation");
const utils_1 = require("../utils");
const entryPointModule = (message) => {
    if (message.content.kind !== 'typedMessage')
        return { fullVisualization: [] };
    if (message.fromActionId === userOperation_1.ENTRY_POINT_AUTHORIZATION_REQUEST_ID)
        return {
            fullVisualization: [
                (0, utils_1.getAction)('Authorize entry point'),
                (0, utils_1.getLabel)('for'),
                (0, utils_1.getAddressVisualization)(message.accountAddr)
            ]
        };
    return { fullVisualization: [] };
};
exports.entryPointModule = entryPointModule;
//# sourceMappingURL=entryPointModule.js.map