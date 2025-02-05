"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFeeCall = void 0;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const IERC20_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/IERC20.json"));
const addresses_1 = require("../../consts/addresses");
const deploy_1 = require("../../consts/deploy");
function getFeeCall(feeToken) {
    // set a bigger number for gas tank / approvals so on
    // L2s it could calculate the preVerificationGas better
    const gasTankOrApproveAmount = 500000000n * BigInt(feeToken.decimals);
    if (feeToken.flags.onGasTank) {
        const abiCoder = new ethers_1.AbiCoder();
        return {
            to: addresses_1.FEE_COLLECTOR,
            value: 0n,
            data: abiCoder.encode(['string', 'uint256', 'string'], ['gasTank', gasTankOrApproveAmount, feeToken.symbol])
        };
    }
    if (feeToken.address === ethers_1.ZeroAddress) {
        // native payment
        return {
            to: addresses_1.FEE_COLLECTOR,
            value: 1n,
            data: '0x'
        };
    }
    // token payment
    const ERC20Interface = new ethers_1.Interface(IERC20_json_1.default.abi);
    return {
        to: feeToken.address,
        value: 0n,
        data: ERC20Interface.encodeFunctionData('approve', [
            deploy_1.DEPLOYLESS_SIMULATION_FROM,
            gasTankOrApproveAmount
        ])
    };
}
exports.getFeeCall = getFeeCall;
//# sourceMappingURL=calls.js.map