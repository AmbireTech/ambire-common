"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.networks7702 = void 0;
const deploy_1 = require("./deploy");
exports.networks7702 = {
    // odyssey
    '911867': {
        implementation: deploy_1.EIP_7702_AMBIRE_ACCOUNT
    },
    // sepolia
    '11155111': {
        implementation: deploy_1.EIP_7702_AMBIRE_ACCOUNT
    },
    // gnosis
    '100': {
        implementation: deploy_1.EIP_7702_AMBIRE_ACCOUNT
    }
};
//# sourceMappingURL=7702.js.map