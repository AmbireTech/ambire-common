"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.wrappingModule = void 0;
const ethers_1 = require("ethers");
const abis_1 = require("../../const/abis");
const utils_1 = require("../../utils");
const wrappingModule = (_, irCalls, humanizerMeta) => {
    const iface = new ethers_1.Interface(abis_1.WETH);
    const newCalls = irCalls.map((call) => {
        const knownAddressData = humanizerMeta?.knownAddresses[call.to.toLowerCase()];
        if (knownAddressData?.name === 'Wrapped ETH' ||
            knownAddressData?.name === 'WETH' ||
            knownAddressData?.token?.symbol === 'WETH' ||
            knownAddressData?.name === 'WMATIC' ||
            knownAddressData?.token?.symbol === 'WMATIC' ||
            knownAddressData?.token?.symbol === 'WAVAX') {
            // 0xd0e30db0
            if (call.data.slice(0, 10) === iface.getFunction('deposit')?.selector) {
                return {
                    ...call,
                    fullVisualization: (0, utils_1.getWrapping)(ethers_1.ZeroAddress, call.value)
                };
            }
            // 0x2e1a7d4d
            if (call.data.slice(0, 10) === iface.getFunction('withdraw')?.selector) {
                const [amount] = iface.parseTransaction(call)?.args || [];
                return {
                    ...call,
                    fullVisualization: (0, utils_1.getUnwrapping)(ethers_1.ZeroAddress, amount)
                };
            }
            if (!call?.fullVisualization)
                return {
                    ...call,
                    fullVisualization: (0, utils_1.getUnknownVisualization)('wrapped', call)
                };
        }
        return call;
    });
    return newCalls;
};
exports.wrappingModule = wrappingModule;
//# sourceMappingURL=wrapping.js.map