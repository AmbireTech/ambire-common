"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getInnerCallFailure = getInnerCallFailure;
exports.getNonceDiscrepancyFailure = getNonceDiscrepancyFailure;
exports.ambireEstimateGas = ambireEstimateGas;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const Estimation_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/Estimation.json"));
const addresses_1 = require("../../consts/addresses");
const deploy_1 = require("../../consts/deploy");
const deployless_1 = require("../../consts/deployless");
const simulationStateOverride_1 = require("../../utils/simulationStateOverride");
const account_1 = require("../account/account");
const accountOp_1 = require("../accountOp/accountOp");
const deployless_2 = require("../deployless/deployless");
const customErrors_1 = require("../errorDecoder/customErrors");
const errorHumanizer_1 = require("../errorHumanizer");
const gasPrice_1 = require("../gasPrice/gasPrice");
const userOperation_1 = require("../userOperation/userOperation");
function getInnerCallFailure(estimationOp, calls, network, portfolioNativeValue) {
    if (estimationOp.success)
        return null;
    return (0, errorHumanizer_1.getHumanReadableEstimationError)(new customErrors_1.InnerCallFailureError(estimationOp.err, calls, network, portfolioNativeValue));
}
// the outcomeNonce should always be equal to the nonce in accountOp + 1
// that's an indication of transaction success
function getNonceDiscrepancyFailure(estimationNonce, outcomeNonce) {
    if (estimationNonce + 1n === BigInt(outcomeNonce))
        return null;
    return new Error("Nonce discrepancy, perhaps there's a pending transaction. Retrying...", {
        cause: 'NONCE_FAILURE'
    });
}
async function ambireEstimateGas(baseAcc, accountState, op, network, provider, feeTokens, nativeToCheck) {
    const account = baseAcc.getAccount();
    const deploylessEstimator = (0, deployless_2.fromDescriptor)(provider, Estimation_json_1.default, !network.rpcNoStateOverride);
    // only the activator call is added here as there are cases where it's needed
    const calls = [...op.calls.map(accountOp_1.toSingletonCall)];
    if ((0, userOperation_1.shouldIncludeActivatorCall)(network, account, accountState, true)) {
        calls.push((0, userOperation_1.getActivatorCall)(op.accountAddr));
    }
    const isStillPureEoa = accountState.isEOA && !accountState.isSmarterEoa;
    const checkInnerCallsArgs = [
        account.addr,
        ...(0, account_1.getAccountDeployParams)(account),
        [
            account.addr,
            op.accountOpToExecuteBefore?.nonce || 0,
            op.accountOpToExecuteBefore?.calls || [],
            op.accountOpToExecuteBefore?.signature || '0x'
        ],
        [account.addr, op.nonce || 1, calls, '0x'],
        (0, gasPrice_1.getProbableCallData)(account, op, accountState, network),
        account.associatedKeys,
        feeTokens.map((feeToken) => feeToken.address),
        addresses_1.FEE_COLLECTOR,
        nativeToCheck,
        network.isOptimistic ? deploy_1.OPTIMISTIC_ORACLE : ethers_1.ZeroAddress
    ];
    const ambireEstimation = await deploylessEstimator
        .call('estimate', checkInnerCallsArgs, {
        from: deploy_1.DEPLOYLESS_SIMULATION_FROM,
        blockTag: 'pending', // there's no reason to do latest
        mode: isStillPureEoa ? deployless_2.DeploylessMode.StateOverride : deployless_2.DeploylessMode.Detect,
        stateToOverride: isStillPureEoa ? (0, simulationStateOverride_1.getEoaSimulationStateOverride)(account.addr) : null
    })
        .catch(errorHumanizer_1.getHumanReadableEstimationError);
    if (ambireEstimation instanceof Error)
        return ambireEstimation;
    const [[deployment, accountOpToExecuteBefore, accountOp, outcomeNonce, feeTokenOutcomes, , nativeAssetBalances, , l1GasEstimation]] = ambireEstimation;
    const ambireEstimationError = getInnerCallFailure(accountOp, calls, network, feeTokens.find((token) => token.address === ethers_1.ZeroAddress && !token.flags.onGasTank)?.amount);
    if (ambireEstimationError)
        return ambireEstimationError;
    // if there's a nonce discrepancy, it means the portfolio simulation
    // will fail so we need to update the account state and the portfolio
    const opNonce = isStillPureEoa ? BigInt(deployless_1.EOA_SIMULATION_NONCE) : op.nonce;
    const nonceError = getNonceDiscrepancyFailure(opNonce, outcomeNonce);
    const flags = {};
    if (nonceError) {
        flags.hasNonceDiscrepancy = true;
    }
    const gasUsed = deployment.gasUsed + accountOpToExecuteBefore.gasUsed + accountOp.gasUsed;
    const feeTokenOptions = feeTokens.map((token, key) => {
        // We are using 'availableAmount' here, because it's possible the 'amount' to contains pending top up amount as well
        let availableAmount = token.flags.onGasTank && 'availableAmount' in token
            ? token.availableAmount || token.amount
            : feeTokenOutcomes[key].amount;
        // if the token is native and the account type cannot pay for the
        // transaction with the receiving amount from the estimation,
        // override the amount to the original, in-account amount.
        //
        // This isn't true when the amount is decreasing, though
        // We should subtract the amount if it's less the one he
        // currently owns as send all of native and paying in native
        // is impossible
        if (!token.flags.onGasTank &&
            token.address === ethers_1.ZeroAddress &&
            !baseAcc.canUseReceivingNativeForFee(token.amount) &&
            feeTokenOutcomes[key].amount > token.amount)
            availableAmount = token.amount;
        return {
            paidBy: account.addr,
            availableAmount,
            // gasUsed for the gas tank tokens is smaller because of the commitment:
            // ['gasTank', amount, symbol]
            // and this commitment costs onchain:
            // - 1535, if the broadcasting addr is the relayer
            // - 4035, if the broadcasting addr is different
            // currently, there are more than 1 relayer addresses and we cannot
            // be sure which is the one that will broadcast this txn; also, ERC-4337
            // broadcasts will always consume at least 4035.
            // setting it to 5000n just be sure
            gasUsed: token.flags.onGasTank ? 5000n : feeTokenOutcomes[key].gasUsed,
            addedNative: token.address === ethers_1.ZeroAddress
                ? l1GasEstimation.feeWithNativePayment
                : l1GasEstimation.feeWithTransferPayment,
            token
        };
    });
    // this is for EOAs paying for SA in native
    const nativeToken = feeTokens.find((token) => token.address === ethers_1.ZeroAddress && !token.flags.onGasTank);
    const nativeTokenOptions = nativeAssetBalances.map((balance, key) => ({
        paidBy: nativeToCheck[key],
        availableAmount: balance,
        addedNative: l1GasEstimation.fee,
        token: {
            ...nativeToken,
            amount: balance
        }
    }));
    return {
        gasUsed,
        deploymentGas: deployment.gasUsed,
        feePaymentOptions: [...feeTokenOptions, ...nativeTokenOptions],
        ambireAccountNonce: accountOp.success ? Number(outcomeNonce - 1n) : Number(outcomeNonce),
        flags
    };
}
//# sourceMappingURL=ambireEstimation.js.map