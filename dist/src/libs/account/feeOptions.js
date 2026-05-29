"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isTransferredTokenFeeOption = exports.canFeeOptionCoverAmount = void 0;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const IERC20_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/IERC20.json"));
const ERC20Interface = new ethers_1.Interface(IERC20_json_1.default.abi);
const isTransferredTokenFeeOption = (feeOption, op) => {
    if (!op.meta?.allowTransferFeeTokenSelfReserve)
        return false;
    if (feeOption.token.flags.onGasTank ||
        feeOption.paidBy.toLowerCase() !== op.accountAddr.toLowerCase())
        return false;
    if (feeOption.token.address === ethers_1.ZeroAddress) {
        return op.calls.some((call) => call.value > 0n && call.data === '0x');
    }
    return op.calls.some((call) => {
        if (!call.to || call.to.toLowerCase() !== feeOption.token.address.toLowerCase())
            return false;
        try {
            ERC20Interface.decodeFunctionData('transfer', call.data);
            return true;
        }
        catch {
            return false;
        }
    });
};
exports.isTransferredTokenFeeOption = isTransferredTokenFeeOption;
const canFeeOptionCoverAmount = (feeOption, op, amount) => {
    return feeOption.availableAmount >= amount || isTransferredTokenFeeOption(feeOption, op);
};
exports.canFeeOptionCoverAmount = canFeeOptionCoverAmount;
//# sourceMappingURL=feeOptions.js.map