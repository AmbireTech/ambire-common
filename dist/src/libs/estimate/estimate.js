"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEstimation = getEstimation;
exports.getEstimationSummary = getEstimationSummary;
exports.getGasLimitWithOverheadForSelfEOA = getGasLimitWithOverheadForSelfEOA;
exports.getGasLimitWithOverhead = getGasLimitWithOverhead;
const ambireEstimation_1 = require("./ambireEstimation");
const estimateBundler_1 = require("./estimateBundler");
const providerEstimateGas_1 = require("./providerEstimateGas");
// get all possible estimation combinations and leave it to the implementation
// to decide which one is relevant depending on the case.
// there are 3 estimations:
// estimateGas(): the rpc method for retrieving gas
// estimateBundler(): ask the 4337 bundler for a gas price
// Estimation.sol: our own implementation
// each has an use case in diff scenarious:
// - EOA: if payment is native, use estimateGas(); otherwise estimateBundler()
// - SA: if ethereum, use Estimation.sol; otherwise estimateBundler()
async function getEstimation(baseAcc, accountState, op, network, provider, feeTokens, nativeToCheck, switcher, pendingUserOp) {
    const ambireEstimation = (0, ambireEstimation_1.ambireEstimateGas)(baseAcc, accountState, op, network, provider, feeTokens, nativeToCheck);
    let bundlerGasPrices;
    const bundlerEstimation = async () => {
        if (op.meta?.isSafeDeploy ||
            !baseAcc.supportsBundlerEstimation() ||
            !network.erc4337.hasBundlerSupport)
            return null;
        const gasPrice = await (0, estimateBundler_1.fetchBundlerGasPrice)(baseAcc, network, switcher);
        if (gasPrice instanceof Error)
            return gasPrice;
        const bundlerEstimateResponse = await (0, estimateBundler_1.bundlerEstimate)(baseAcc, accountState, op, network, feeTokens, provider, gasPrice, switcher, undefined, pendingUserOp);
        bundlerGasPrices =
            !bundlerEstimateResponse || bundlerEstimateResponse instanceof Error
                ? gasPrice
                : bundlerEstimateResponse.gasPrice;
        return bundlerEstimateResponse;
    };
    const providerEstimation = (0, providerEstimateGas_1.providerEstimateGas)(baseAcc.getAccount(), op, provider, accountState, network, feeTokens);
    const estimations = await Promise.all([ambireEstimation, bundlerEstimation(), providerEstimation]);
    const ambireGas = estimations[0];
    const bundlerGas = estimations[1];
    const providerGas = estimations[2];
    const fullEstimation = {
        provider: providerGas,
        ambire: ambireGas,
        bundler: bundlerGas,
        flags: {},
        bundlerGasPrices
    };
    const criticalError = baseAcc.getEstimationCriticalError(fullEstimation, op);
    if (criticalError)
        fullEstimation.criticalError = criticalError;
    let flags = {};
    if (!(ambireGas instanceof Error) && ambireGas)
        flags = { ...ambireGas.flags };
    if (!(bundlerGas instanceof Error) && bundlerGas)
        flags = { ...bundlerGas.flags };
    fullEstimation.flags = flags;
    return fullEstimation;
}
function getEstimationSummary(estimation) {
    return {
        providerEstimation: estimation.provider && !(estimation.provider instanceof Error)
            ? estimation.provider
            : undefined,
        ambireEstimation: estimation.ambire && !(estimation.ambire instanceof Error) ? estimation.ambire : undefined,
        bundlerEstimation: estimation.bundler && !(estimation.bundler instanceof Error) ? estimation.bundler : undefined,
        flags: estimation.flags,
        bundlerGasPrices: estimation.bundlerGasPrices,
        updatedAt: Date.now()
    };
}
/**
 * This extra gas limit is 12% as 10% might not be enough for swaps
 * but 20% makes most actions look too expensive
 */
function getOverhead(gasLimit) {
    return gasLimit + gasLimit / 8n;
}
/**
 * Push extra gas limit for EOA / EOA7702 accounts to avoid OOG.
 * Also, push this extra gas limit if the accountOp isn't a single call with ETH send
 * which is fixed to 21k and no extra gas limit is needed
 */
function getGasLimitWithOverheadForSelfEOA(gasLimit, calls) {
    if (calls && calls.length === 1) {
        const call = calls[0];
        if (call.data === '0x' && call.value > 0n)
            return gasLimit;
    }
    return getOverhead(gasLimit);
}
/**
 * Push extra gas limit for EOA broadcast when the account is smart.
 */
function getGasLimitWithOverhead(gasLimit) {
    return getOverhead(gasLimit);
}
//# sourceMappingURL=estimate.js.map