"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.snapshotModule = void 0;
const utils_1 = require("../utils");
const snapshotModule = (message) => {
    if (message.content.kind !== 'typedMessage')
        return { fullVisualization: [] };
    if (message.content.domain.name === 'snapshot' &&
        message.content.message.choice &&
        message.content.message.space) {
        return {
            fullVisualization: [
                (0, utils_1.getAction)('Vote'),
                (0, utils_1.getLabel)('in'),
                (0, utils_1.getLabel)('Snapshot:', true),
                (0, utils_1.getLabel)(message.content.message.space, true)
            ]
        };
    }
    return { fullVisualization: [] };
};
exports.snapshotModule = snapshotModule;
//# sourceMappingURL=snapshotModule.js.map