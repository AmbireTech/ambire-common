"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ethers_1 = require("ethers");
const _1Inch_1 = require("../../const/abis/1Inch");
const utils_1 = require("../../utils");
const OneInchModule = (accOp, calls) => {
    const iface = new ethers_1.Interface(_1Inch_1.OneInch);
    const matcher = {
        [iface.getFunction('cancelOrder(uint256 makerTraits, bytes32 orderHash)')?.selector]: (call) => {
            const { orderHash } = iface.parseTransaction(call).args;
            return [
                (0, utils_1.getAction)('Cancel order'),
                (0, utils_1.getLabel)(`with order hash ${orderHash.slice(0, 5)}...${orderHash.slice(63, 66)}`)
            ];
        },
        [iface.getFunction('unoswap2(uint256 token, uint256 amount, uint256 minReturn, uint256 dex, uint256 dex2)')?.selector]: (call) => {
            const { token: tokenArg, amount } = iface.parseTransaction(call).args;
            const token = (0, utils_1.uintToAddress)(tokenArg);
            return [(0, utils_1.getAction)('Swap'), (0, utils_1.getToken)((0, utils_1.eToNative)(token), amount)];
        },
        [iface.getFunction('swap(address executor,tuple(address srcToken,address dstToken,address srcReceiver,address dstReceiver,uint256 amount,uint256 minReturnAmount,uint256 flags) desc,bytes data)')?.selector]: (call) => {
            const { desc: { srcToken, dstToken, dstReceiver, amount, minReturnAmount } } = iface.parseTransaction(call).args;
            return [
                (0, utils_1.getAction)('Swap'),
                (0, utils_1.getToken)((0, utils_1.eToNative)(srcToken), amount),
                (0, utils_1.getLabel)('for'),
                (0, utils_1.getToken)((0, utils_1.eToNative)(dstToken), minReturnAmount),
                ...(0, utils_1.getRecipientText)(accOp.accountAddr, dstReceiver)
            ];
        },
        [iface.getFunction('ethUnoswap(uint256, uint256)')?.selector]: (call) => {
            return [(0, utils_1.getAction)('Swap'), (0, utils_1.getToken)(ethers_1.ZeroAddress, call.value)];
        },
        [iface.getFunction('unoswap(uint256 token,uint256 amount,uint256 minReturn,uint256 dex)')
            ?.selector]: (call) => {
            const { token: tokenArg, amount } = iface.parseTransaction(call).args;
            const token = (0, utils_1.uintToAddress)(tokenArg);
            return [(0, utils_1.getAction)('Swap'), (0, utils_1.getToken)((0, utils_1.eToNative)(token), amount)];
        },
        [iface.getFunction('unoswapTo(uint256 to,uint256 token,uint256 amount,uint256 minReturn,uint256 dex)')?.selector]: (call) => {
            const { token: tokenArg, amount } = iface.parseTransaction(call).args;
            const token = (0, utils_1.uintToAddress)(tokenArg);
            return [(0, utils_1.getAction)('Swap'), (0, utils_1.getToken)((0, utils_1.eToNative)(token), amount)];
        },
        [iface.getFunction('unoswap3(uint256 token,uint256 amount,uint256 minReturn,uint256 dex,uint256 dex2,uint256 dex3)')?.selector]: (call) => {
            const { token: tokenArg, amount } = iface.parseTransaction(call).args;
            const token = (0, utils_1.uintToAddress)(tokenArg);
            return [(0, utils_1.getAction)('Swap'), (0, utils_1.getToken)((0, utils_1.eToNative)(token), amount)];
        },
        [iface.getFunction('swap(address executor, tuple(address srcToken, address dstToken, address srcReceiver, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 flags) desc, bytes permit, bytes data) payable returns (uint256 returnAmount, uint256 spentAmount)')?.selector]: (call) => {
            const { executor, desc: { srcToken, dstToken, srcReceiver, dstReceiver, amount, minReturnAmount, flags }, permit, data } = iface.parseTransaction(call).args;
            return [
                (0, utils_1.getAction)('Swap'),
                (0, utils_1.getToken)(srcToken, amount),
                (0, utils_1.getLabel)('for'),
                (0, utils_1.getToken)(dstToken, minReturnAmount),
                ...(0, utils_1.getRecipientText)(accOp.accountAddr, dstReceiver)
            ];
        }
    };
    const newCalls = calls.map((call) => {
        if (call.fullVisualization || !matcher[call.data.slice(0, 10)])
            return call;
        return { ...call, fullVisualization: matcher[call.data.slice(0, 10)](call) };
    });
    return newCalls;
};
exports.default = OneInchModule;
//# sourceMappingURL=index.js.map