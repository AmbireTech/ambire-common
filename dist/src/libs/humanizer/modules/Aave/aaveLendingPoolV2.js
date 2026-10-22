"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.aaveLendingPoolV2 = void 0;
const viem_1 = require("viem");
const utils_1 = require("../../utils");
const depositAbi = (0, viem_1.parseAbi)([
    'function deposit(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)'
]);
const withdrawAbi = (0, viem_1.parseAbi)([
    'function withdraw(address asset, uint256 amount, address to) returns (uint256)'
]);
const repayAbi = (0, viem_1.parseAbi)([
    'function repay(address asset, uint256 amount, uint256 rateMode, address onBehalfOf) returns (uint256)'
]);
const borrowAbi = (0, viem_1.parseAbi)([
    'function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)'
]);
const depositSelector = (0, viem_1.toFunctionSelector)(depositAbi[0]);
const withdrawSelector = (0, viem_1.toFunctionSelector)(withdrawAbi[0]);
const repaySelector = (0, viem_1.toFunctionSelector)(repayAbi[0]);
const borrowSelector = (0, viem_1.toFunctionSelector)(borrowAbi[0]);
const aaveLendingPoolV2 = () => {
    const matcher = {
        [depositSelector]: (accountOp, call) => {
            if (!call.to)
                throw Error('Humanizer: should not be in aave module when !call.to');
            const { args } = (0, viem_1.decodeFunctionData)({ abi: depositAbi, data: call.data });
            const [asset, amount, onBehalf] = args;
            return [
                (0, utils_1.getAction)('Deposit'),
                (0, utils_1.getToken)(asset, amount),
                (0, utils_1.getLabel)('to'),
                (0, utils_1.getAddressVisualization)(call.to),
                ...(0, utils_1.getOnBehalfOf)(onBehalf, accountOp.accountAddr)
            ];
        },
        [withdrawSelector]: (accountOp, call) => {
            if (!call.to)
                throw Error('Humanizer: should not be in aave module when !call.to');
            const { args } = (0, viem_1.decodeFunctionData)({ abi: withdrawAbi, data: call.data });
            const [asset, amount, onBehalf] = args;
            return [
                (0, utils_1.getAction)('Withdraw'),
                (0, utils_1.getToken)(asset, amount),
                (0, utils_1.getLabel)('from'),
                (0, utils_1.getAddressVisualization)(call.to),
                ...(0, utils_1.getOnBehalfOf)(onBehalf, accountOp.accountAddr)
            ];
        },
        [repaySelector]: (accountOp, call) => {
            if (!call.to)
                throw Error('Humanizer: should not be in aave module when !call.to');
            const { args } = (0, viem_1.decodeFunctionData)({ abi: repayAbi, data: call.data });
            const [asset, amount /* rateMode */, , onBehalf] = args;
            return [
                (0, utils_1.getAction)('Repay'),
                (0, utils_1.getToken)(asset, amount),
                (0, utils_1.getLabel)('to'),
                (0, utils_1.getAddressVisualization)(call.to),
                ...(0, utils_1.getOnBehalfOf)(onBehalf, accountOp.accountAddr)
            ];
        },
        [borrowSelector]: (accountOp, call) => {
            if (!call.to)
                throw Error('Humanizer: should not be in aave module when !call.to');
            const { args } = (0, viem_1.decodeFunctionData)({ abi: borrowAbi, data: call.data });
            const [asset, amount] = args;
            return [
                (0, utils_1.getAction)('Borrow'),
                (0, utils_1.getToken)(asset, amount),
                (0, utils_1.getLabel)('from'),
                (0, utils_1.getAddressVisualization)(call.to)
            ];
        }
    };
    return matcher;
};
exports.aaveLendingPoolV2 = aaveLendingPoolV2;
//# sourceMappingURL=aaveLendingPoolV2.js.map