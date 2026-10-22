"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.wrappingModule = void 0;
const viem_1 = require("viem");
const utils_1 = require("../../utils");
const depositAbi = (0, viem_1.parseAbi)(['function deposit() payable']);
const withdrawAbi = (0, viem_1.parseAbi)(['function withdraw(uint256 wad)']);
const depositSelector = (0, viem_1.toFunctionSelector)(depositAbi[0]);
const withdrawSelector = (0, viem_1.toFunctionSelector)(withdrawAbi[0]);
const wrappingModule = (_, call, humanizerMeta) => {
    if (!call.to || !(0, viem_1.isAddress)(call.to))
        return call;
    const knownAddressData = humanizerMeta?.knownAddresses[(0, viem_1.getAddress)(call.to)];
    if (knownAddressData?.name === 'Wrapped ETH' ||
        knownAddressData?.name === 'WETH' ||
        knownAddressData?.token?.symbol === 'WETH' ||
        knownAddressData?.name === 'WMATIC' ||
        knownAddressData?.token?.symbol === 'WMATIC' ||
        knownAddressData?.token?.symbol === 'WAVAX') {
        // 0xd0e30db0
        if ((0, utils_1.isHexCall)(call) && call.data.slice(0, 10) === depositSelector) {
            return {
                ...call,
                fullVisualization: (0, utils_1.getWrapping)(viem_1.zeroAddress, call.value)
            };
        }
        // 0x2e1a7d4d
        if ((0, utils_1.isHexCall)(call) && call.data.slice(0, 10) === withdrawSelector) {
            const { args } = (0, viem_1.decodeFunctionData)({ abi: withdrawAbi, data: call.data });
            const [amount] = args;
            return {
                ...call,
                fullVisualization: (0, utils_1.getUnwrapping)(viem_1.zeroAddress, amount)
            };
        }
    }
    return call;
};
exports.wrappingModule = wrappingModule;
//# sourceMappingURL=wrapping.js.map