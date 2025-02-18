"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ethers_1 = require("ethers");
const abis_1 = require("../../const/abis");
const utils_1 = require("../../utils");
// @TODO limit order manager
// @TODO those use AVAX in the function method
// https://snowtrace.io/address/0x60aE616a2155Ee3d9A68541Ba4544862310933d4
// https://arbiscan.io/address/0xbeE5c10Cf6E4F68f831E11C1D9E59B43560B3642
// https://arbiscan.io/address/0x7BFd7192E76D950832c77BB412aaE841049D8D9B
const traderJoeModule = (accOp, calls) => {
    const iface = new ethers_1.Interface(abis_1.JoeRouter);
    const matcher = {
        [iface.getFunction('swapExactNATIVEForTokens(uint256 amountOutMin,(uint256[],uint8[],address[]) path,address to,uint256 deadline)')?.selector]: (call) => {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            const { amountOutMin, path, to, deadline } = iface.parseTransaction(call).args;
            const tokenOut = path[2][path[2].length - 1];
            return [
                (0, utils_1.getAction)('Swap'),
                (0, utils_1.getToken)(ethers_1.ZeroAddress, call.value),
                (0, utils_1.getLabel)('for at least'),
                (0, utils_1.getToken)(tokenOut, amountOutMin),
                ...(0, utils_1.getRecipientText)(accOp.accountAddr, to),
                (0, utils_1.getDeadline)(deadline)
            ];
        },
        [iface.getFunction('swapNATIVEForExactTokens(uint256 amountOut,tuple(uint256[],uint8[],address[]) path,address to,uint256 deadline)')?.selector]: (call) => {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            const { amountOut, path, to, deadline } = iface.parseTransaction(call).args;
            const tokenOut = path[2][path[2].length - 1];
            return [
                (0, utils_1.getAction)('Swap up to'),
                (0, utils_1.getToken)(ethers_1.ZeroAddress, call.value),
                (0, utils_1.getLabel)('for'),
                (0, utils_1.getToken)(tokenOut, amountOut),
                ...(0, utils_1.getRecipientText)(accOp.accountAddr, to),
                (0, utils_1.getDeadline)(deadline)
            ];
        },
        [iface.getFunction('swapExactTokensForNATIVE(uint256 amountIn,uint256 amountOutMinNATIVE,tuple(uint256[],uint8[],address[]) path,address to,uint256 deadline)')?.selector]: (call) => {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            const { amountIn, amountOutMinNATIVE, path, to, deadline } = iface.parseTransaction(call).args;
            return [
                (0, utils_1.getAction)('Swap'),
                (0, utils_1.getToken)(path[2][0], amountIn),
                (0, utils_1.getLabel)('for at least'),
                (0, utils_1.getToken)(ethers_1.ZeroAddress, amountOutMinNATIVE),
                ...(0, utils_1.getRecipientText)(accOp.accountAddr, to),
                (0, utils_1.getDeadline)(deadline)
            ];
        },
        [iface.getFunction('swapTokensForExactNATIVE(uint256 amountNATIVEOut,uint256 amountInMax,tuple(uint256[],uint8[],address[]) path,address to,uint256 deadline)')?.selector]: (call) => {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            const { amountNATIVEOut, amountInMax, path, to, deadline } = iface.parseTransaction(call).args;
            return [
                (0, utils_1.getAction)('Swap up to'),
                (0, utils_1.getToken)(path[2][0], amountInMax),
                (0, utils_1.getLabel)('for'),
                (0, utils_1.getToken)(ethers_1.ZeroAddress, amountNATIVEOut),
                ...(0, utils_1.getRecipientText)(accOp.accountAddr, to),
                (0, utils_1.getDeadline)(deadline)
            ];
        },
        [iface.getFunction('swapExactTokensForTokens(uint256 amountIn,uint256 amountOutMin,tuple(uint256[],uint8[],address[]) path,address to,uint256 deadline)')?.selector]: (call) => {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            const { amountIn, amountOutMin, path, to, deadline } = iface.parseTransaction(call).args;
            return [
                (0, utils_1.getAction)('Swap'),
                (0, utils_1.getToken)(path[2][0], amountIn),
                (0, utils_1.getLabel)('for at least'),
                (0, utils_1.getToken)(path[2][path[2].length - 1], amountOutMin),
                ...(0, utils_1.getRecipientText)(accOp.accountAddr, to),
                (0, utils_1.getDeadline)(deadline)
            ];
        },
        [iface.getFunction('swapTokensForExactTokens(uint256 amountOut,uint256 amountInMax,tuple(uint256[],uint8[],address[]) path,address to,uint256 deadline)')?.selector]: (call) => {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            const { amountOut, amountInMax, path, to, deadline } = iface.parseTransaction(call).args;
            return [
                (0, utils_1.getAction)('Swap up to'),
                (0, utils_1.getToken)(path[2][0], amountInMax),
                (0, utils_1.getLabel)('for'),
                (0, utils_1.getToken)(path[2][path[2].length - 1], amountOut),
                ...(0, utils_1.getRecipientText)(accOp.accountAddr, to),
                (0, utils_1.getDeadline)(deadline)
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
exports.default = traderJoeModule;
//# sourceMappingURL=index.js.map