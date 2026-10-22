"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.weiToGwei = weiToGwei;
exports.isExtremeMainnetGasPrice = isExtremeMainnetGasPrice;
exports.isExtremeGasFeeUsd = isExtremeGasFeeUsd;
exports.getPerOperationFeeUsd = getPerOperationFeeUsd;
exports.getExtremeGasFeeWarningState = getExtremeGasFeeWarningState;
const networks_1 = require("../../consts/networks");
const extremeGasFee_1 = require("../../consts/safeguards/extremeGasFee");
const helper_1 = require("../../controllers/signAccountOp/helper");
const signAccountOp_1 = require("../../interfaces/signAccountOp");
const WEI_PER_GWEI = 10n ** 9n;
function weiToGwei(weiValue) {
    return Number(weiValue) / Number(WEI_PER_GWEI);
}
function isExtremeMainnetGasPrice(gasPriceWei) {
    if (gasPriceWei <= 0n)
        return false;
    return weiToGwei(gasPriceWei) > extremeGasFee_1.EXTREME_GAS_FEE_THRESHOLD_MAINNET_GWEI;
}
function isExtremeGasFeeUsd(feeUsd) {
    if (!Number.isFinite(feeUsd) || feeUsd <= 0)
        return false;
    return feeUsd > extremeGasFee_1.EXTREME_GAS_FEE_THRESHOLD_DEFAULT_USD;
}
// Ambire batches multiple calls into a single AccountOp, so the total fee
// scales with the number of operations. Comparing the per-operation cost (not
// the total) to the threshold avoids false positives on legitimately large
// batches while still flagging a single operation that is unusually expensive.
function getPerOperationFeeUsd(feeUsd, callsCount) {
    const operationsCount = Math.max(1, callsCount);
    return feeUsd / operationsCount;
}
function getExtremeGasFeeWarningState(signAccountOpState, networkChainId) {
    if (!signAccountOpState?.selectedOption || !networkChainId)
        return null;
    const identifier = (0, helper_1.getFeeSpeedIdentifier)(signAccountOpState.selectedOption, signAccountOpState.accountOp.accountAddr);
    const selectedFeeSpeed = signAccountOpState.feeSpeeds[identifier]?.find((speed) => speed.type === signAccountOpState.selectedFeeSpeed) || signAccountOpState.feeSpeeds[identifier]?.find((speed) => speed.type === signAccountOp_1.FeeSpeed.Fast);
    if (!selectedFeeSpeed)
        return null;
    if (networkChainId === networks_1.ETHEREUM_CHAIN_ID) {
        if (!isExtremeMainnetGasPrice(selectedFeeSpeed.gasPrice))
            return null;
        return {
            type: 'gwei',
            gasPriceGwei: weiToGwei(selectedFeeSpeed.gasPrice),
            thresholdGwei: extremeGasFee_1.EXTREME_GAS_FEE_THRESHOLD_MAINNET_GWEI
        };
    }
    if (!selectedFeeSpeed.amountUsd)
        return null;
    const feeUsd = Number(selectedFeeSpeed.amountUsd);
    const callsCount = signAccountOpState.accountOp.calls?.length ?? 0;
    const perOperationFeeUsd = getPerOperationFeeUsd(feeUsd, callsCount);
    if (!isExtremeGasFeeUsd(perOperationFeeUsd))
        return null;
    return {
        type: 'usd',
        feeUsd,
        thresholdUsd: extremeGasFee_1.EXTREME_GAS_FEE_THRESHOLD_DEFAULT_USD
    };
}
//# sourceMappingURL=extremeGasFee.js.map