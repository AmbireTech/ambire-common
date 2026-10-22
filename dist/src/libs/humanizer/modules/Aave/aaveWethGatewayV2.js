"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.aaveWethGatewayV2 = void 0;
const viem_1 = require("viem");
const utils_1 = require("../../utils");
const depositETHAbi = (0, viem_1.parseAbi)([
    'function depositETH(address lendingPool, address onBehalfOf, uint16 referralCode) payable'
]);
const withdrawETHAbi = (0, viem_1.parseAbi)([
    'function withdrawETH(address lendingPool, uint256 amount, address to)'
]);
const repayETHAbi = (0, viem_1.parseAbi)([
    'function repayETH(address lendingPool, uint256 amount, uint256 rateMode, address onBehalfOf) payable'
]);
const borrowETHAbi = (0, viem_1.parseAbi)([
    'function borrowETH(address lendingPool, uint256 amount, uint256 interesRateMode, uint16 referralCode)'
]);
const depositETHSelector = (0, viem_1.toFunctionSelector)(depositETHAbi[0]);
const withdrawETHSelector = (0, viem_1.toFunctionSelector)(withdrawETHAbi[0]);
const repayETHSelector = (0, viem_1.toFunctionSelector)(repayETHAbi[0]);
const borrowETHSelector = (0, viem_1.toFunctionSelector)(borrowETHAbi[0]);
const aaveWethGatewayV2 = () => {
    return {
        [depositETHSelector]: (accountOp, call) => {
            if (!call.to)
                throw Error('Humanizer: should not be in aave module when !call.to');
            const { args } = (0, viem_1.decodeFunctionData)({ abi: depositETHAbi, data: call.data });
            const [, onBehalfOf] = args;
            return [
                (0, utils_1.getAction)('Deposit'),
                (0, utils_1.getToken)(viem_1.zeroAddress, call.value),
                (0, utils_1.getLabel)('to'),
                (0, utils_1.getAddressVisualization)(call.to),
                ...(0, utils_1.getOnBehalfOf)(onBehalfOf, accountOp.accountAddr)
            ];
        },
        [withdrawETHSelector]: (accountOp, call) => {
            if (!call.to)
                throw Error('Humanizer: should not be in aave module when !call.to');
            const { args } = (0, viem_1.decodeFunctionData)({ abi: withdrawETHAbi, data: call.data });
            const [, /* lendingPool */ amount, to] = args;
            return [
                (0, utils_1.getAction)('Withdraw'),
                (0, utils_1.getToken)(viem_1.zeroAddress, amount),
                (0, utils_1.getLabel)('from'),
                (0, utils_1.getAddressVisualization)(call.to),
                ...(0, utils_1.getOnBehalfOf)(to, accountOp.accountAddr)
            ];
        },
        [repayETHSelector]: (accountOp, call) => {
            if (!call.to)
                throw Error('Humanizer: should not be in aave module when !call.to');
            const { args } = (0, viem_1.decodeFunctionData)({ abi: repayETHAbi, data: call.data });
            const [, , , /* lendingPool */ /* amount */ /* rateMode */ onBehalfOf] = args;
            return [
                (0, utils_1.getAction)('Repay'),
                (0, utils_1.getToken)(viem_1.zeroAddress, call.value),
                (0, utils_1.getLabel)('to'),
                (0, utils_1.getAddressVisualization)(call.to),
                ...(0, utils_1.getOnBehalfOf)(onBehalfOf, accountOp.accountAddr)
            ];
        },
        [borrowETHSelector]: (accountOp, call) => {
            if (!call.to)
                throw Error('Humanizer: should not be in aave module when !call.to');
            const { args } = (0, viem_1.decodeFunctionData)({ abi: borrowETHAbi, data: call.data });
            const [, /* lendingPool */ amount] = args;
            return [
                (0, utils_1.getAction)('Borrow'),
                (0, utils_1.getToken)(viem_1.zeroAddress, amount),
                (0, utils_1.getLabel)('from'),
                (0, utils_1.getAddressVisualization)(call.to)
            ];
        }
    };
};
exports.aaveWethGatewayV2 = aaveWethGatewayV2;
//# sourceMappingURL=aaveWethGatewayV2.js.map