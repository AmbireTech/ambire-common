"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.aaveLendingPoolV2 = void 0;
const ethers_1 = require("ethers");
const abis_1 = require("../../const/abis");
const utils_1 = require("../../utils");
const aaveLendingPoolV2 = () => {
    const iface = new ethers_1.Interface(abis_1.AaveLendingPoolV2);
    const matcher = {
        [iface.getFunction('deposit')?.selector]: (accountOp, call) => {
            const [asset, amount, onBehalf] = iface.parseTransaction(call)?.args || [];
            return [
                (0, utils_1.getAction)('Deposit'),
                (0, utils_1.getToken)(asset, amount),
                (0, utils_1.getLabel)('to'),
                (0, utils_1.getAddressVisualization)(call.to),
                ...(0, utils_1.getOnBehalfOf)(onBehalf, accountOp.accountAddr)
            ];
        },
        [iface.getFunction('withdraw')?.selector]: (accountOp, call) => {
            const [asset, amount, onBehalf] = iface.parseTransaction(call)?.args || [];
            return [
                (0, utils_1.getAction)('Withdraw'),
                (0, utils_1.getToken)(asset, amount),
                (0, utils_1.getLabel)('from'),
                (0, utils_1.getAddressVisualization)(call.to),
                ...(0, utils_1.getOnBehalfOf)(onBehalf, accountOp.accountAddr)
            ];
        },
        [iface.getFunction('repay')?.selector]: (accountOp, call) => {
            const [asset, amount /* rateMode */, , onBehalf] = iface.parseTransaction(call)?.args || [];
            return [
                (0, utils_1.getAction)('Repay'),
                (0, utils_1.getToken)(asset, amount),
                (0, utils_1.getLabel)('to'),
                (0, utils_1.getAddressVisualization)(call.to),
                ...(0, utils_1.getOnBehalfOf)(onBehalf, accountOp.accountAddr)
            ];
        },
        [iface.getFunction('borrow')?.selector]: (accountOp, call) => {
            const [asset, amount] = iface.parseTransaction(call)?.args || [];
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