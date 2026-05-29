"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LifiModule = void 0;
const utils_1 = require("../../utils");
const LIFI_ROUTER = '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE';
// const iface = new Interface(Lifi)
const LifiModule = (accountOp, irCalls) => {
    const newCalls = irCalls.map((call) => {
        if (call.to && call.to.toLowerCase() === LIFI_ROUTER.toLowerCase()) {
            return {
                ...call,
                fullVisualization: [
                    (0, utils_1.getAction)('Swap/Bridge'),
                    (0, utils_1.getLabel)('with'),
                    (0, utils_1.getAddressVisualization)(call.to)
                ]
            };
        }
        return call;
    });
    return newCalls;
};
exports.LifiModule = LifiModule;
//# sourceMappingURL=lifiModule.js.map