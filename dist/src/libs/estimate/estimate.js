"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEstimation = getEstimation;
exports.getEstimationSummary = getEstimationSummary;
const ambireEstimation_1 = require("./ambireEstimation");
const estimateBundler_1 = require("./estimateBundler");
const estimateWithRetries_1 = require("./estimateWithRetries");
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
async function getEstimation(baseAcc, accountState, op, network, provider, feeTokens, nativeToCheck, switcher, errorCallback) {
    const ambireEstimation = (0, ambireEstimation_1.ambireEstimateGas)(baseAcc, accountState, op, network, provider, feeTokens, nativeToCheck);
    const bundlerEstimation = (0, estimateBundler_1.bundlerEstimate)(baseAcc, accountState, op, network, feeTokens, provider, switcher, errorCallback);
    const providerEstimation = (0, providerEstimateGas_1.providerEstimateGas)(baseAcc.getAccount(), op, provider, accountState, network, feeTokens);
    const estimations = await (0, estimateWithRetries_1.estimateWithRetries)(() => [ambireEstimation, bundlerEstimation, providerEstimation], 'estimation-deployless', errorCallback, 12000);
    // this is only if we hit a timeout 5 consecutive times
    if (estimations instanceof Error)
        return estimations;
    const ambireGas = estimations[0];
    const bundlerGas = estimations[1];
    const providerGas = estimations[2];
    const fullEstimation = {
        provider: providerGas,
        ambire: ambireGas,
        bundler: bundlerGas,
        flags: {}
    };
    const criticalError = baseAcc.getEstimationCriticalError(fullEstimation, op);
    if (criticalError)
        return criticalError;
    // TODO: if the bundler is the preferred method of estimation, re-estimate
    // we can switch it if there's no ambire gas error
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
        flags: estimation.flags
    };
}
//# sourceMappingURL=estimate.js.map