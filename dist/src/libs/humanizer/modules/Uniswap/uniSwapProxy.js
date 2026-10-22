"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uniSwapProxy = void 0;
const viem_1 = require("viem");
const uniUniversalRouter_1 = require("./uniUniversalRouter");
// SwapProxy pulls `amount` of `token` from the caller, then forwards `commands`/`inputs`/`deadline`
// to the Uniswap Universal Router it was given, using the same command encoding as the router itself
// (https://etherscan.io/address/0x02E5be68D46DAc0B524905bfF209cf47EE6dB2a9#code)
const executeAbi = (0, viem_1.parseAbi)([
    'function execute(address router, address token, uint256 amount, bytes commands, bytes[] inputs, uint256 deadline) payable'
]);
exports.uniSwapProxy = {
    [(0, viem_1.toFunctionSelector)(executeAbi[0])]: (accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({ abi: executeAbi, data: call.data });
        const [, , , commands, inputs, deadline] = args;
        return (0, uniUniversalRouter_1.humanizeUniversalRouterCommands)(commands, inputs, deadline, accountOp, call);
    }
};
//# sourceMappingURL=uniSwapProxy.js.map