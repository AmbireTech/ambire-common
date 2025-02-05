"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.aaveWethGatewayV2 = void 0;
const ethers_1 = require("ethers");
const abis_1 = require("../../const/abis");
const utils_1 = require("../../utils");
const aaveWethGatewayV2 = () => {
    const iface = new ethers_1.Interface(abis_1.AaveWethGatewayV2);
    return {
        [iface.getFunction('depositETH')?.selector]: (accountOp, call) => {
            const [, onBehalfOf] = iface.parseTransaction(call)?.args || [];
            return [
                (0, utils_1.getAction)('Deposit'),
                (0, utils_1.getToken)(ethers_1.ZeroAddress, call.value),
                (0, utils_1.getLabel)('to'),
                (0, utils_1.getAddressVisualization)(call.to),
                ...(0, utils_1.getOnBehalfOf)(onBehalfOf, accountOp.accountAddr)
            ];
        },
        [iface.getFunction('withdrawETH')?.selector]: (accountOp, call) => {
            const [, /* lendingPool */ amount, to] = iface.parseTransaction(call)?.args || [];
            return [
                (0, utils_1.getAction)('Withdraw'),
                (0, utils_1.getToken)(ethers_1.ZeroAddress, amount),
                (0, utils_1.getLabel)('from'),
                (0, utils_1.getAddressVisualization)(call.to),
                ...(0, utils_1.getOnBehalfOf)(to, accountOp.accountAddr)
            ];
        },
        [iface.getFunction('repayETH')?.selector]: (accountOp, call) => {
            const [, , , /* lendingPool */ /* amount */ /* rateMode */ onBehalfOf] = iface.parseTransaction(call)?.args || [];
            return [
                (0, utils_1.getAction)('Repay'),
                (0, utils_1.getToken)(ethers_1.ZeroAddress, call.value),
                (0, utils_1.getLabel)('to'),
                (0, utils_1.getAddressVisualization)(call.to),
                (0, utils_1.getOnBehalfOf)(onBehalfOf, accountOp.accountAddr)
            ];
        },
        [iface.getFunction('borrowETH')?.selector]: (accountOp, call) => {
            const [, /* lendingPool */ amount] = iface.parseTransaction(call)?.args || [];
            return [
                (0, utils_1.getAction)('Borrow'),
                (0, utils_1.getToken)(ethers_1.ZeroAddress, amount),
                (0, utils_1.getLabel)('from'),
                (0, utils_1.getAddressVisualization)(call.to)
            ];
        }
    };
};
exports.aaveWethGatewayV2 = aaveWethGatewayV2;
//# sourceMappingURL=aaveWethGatewayV2.js.map