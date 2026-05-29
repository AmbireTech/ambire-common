"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEstimation = getEstimation;
exports.getEstimationSummary = getEstimationSummary;
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
        if (!baseAcc.supportsBundlerEstimation() || !network.erc4337.hasBundlerSupport)
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
//# sourceMappingURL=estimate.js.map