"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.estimate = exports.estimate4337 = void 0;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const Estimation_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/Estimation.json"));
const addresses_1 = require("../../consts/addresses");
const deploy_1 = require("../../consts/deploy");
const account_1 = require("../account/account");
const accountOp_1 = require("../accountOp/accountOp");
const calls_1 = require("../calls/calls");
const deployless_1 = require("../deployless/deployless");
const customErrors_1 = require("../errorDecoder/customErrors");
const errorHumanizer_1 = require("../errorHumanizer");
const gasPrice_1 = require("../gasPrice/gasPrice");
const networks_1 = require("../networks/networks");
const userOperation_1 = require("../userOperation/userOperation");
const errors_1 = require("./errors");
const estimateBundler_1 = require("./estimateBundler");
const estimateEOA_1 = require("./estimateEOA");
const estimateGas_1 = require("./estimateGas");
const estimateHelpers_1 = require("./estimateHelpers");
const estimateWithRetries_1 = require("./estimateWithRetries");
const refund_1 = require("./refund");
const abiCoder = new ethers_1.AbiCoder();
function getInnerCallFailure(estimationOp, calls, network, portfolioNativeValue) {
    if (estimationOp.success)
        return null;
    const error = (0, errorHumanizer_1.getHumanReadableEstimationError)(new customErrors_1.InnerCallFailureError(estimationOp.err, calls, network, portfolioNativeValue));
    return new Error(error.message, {
        cause: 'CALLS_FAILURE'
    });
}
// the outcomeNonce should always be equal to the nonce in accountOp + 1
// that's an indication of transaction success
function getNonceDiscrepancyFailure(op, outcomeNonce) {
    if (op.nonce !== null && op.nonce + 1n === BigInt(outcomeNonce))
        return null;
    return new Error("Nonce discrepancy, perhaps there's a pending transaction. Retrying...", {
        cause: 'NONCE_FAILURE'
    });
}
async function estimate4337(account, op, calls, accountStates, network, provider, feeTokens, blockTag, nativeToCheck, switcher, errorCallback) {
    const deploylessEstimator = (0, deployless_1.fromDescriptor)(provider, Estimation_json_1.default, !network.rpcNoStateOverride);
    // build the feePaymentOptions with the available current amounts. We will
    // change them after simulation passes
    let feePaymentOptions = feeTokens.map((token) => {
        return {
            paidBy: account.addr,
            availableAmount: token.amount,
            // @relyOnBundler
            // gasUsed goes to 0
            // we add a transfer call or a native call when sending the uOp to the
            // bundler and he estimates that. For different networks this gasUsed
            // goes to different places (callGasLimit or preVerificationGas) and
            // its calculated differently. So it's a wild bet to think we could
            // calculate this on our own for each network.
            gasUsed: 0n,
            // addedNative gets calculated by the bundler & added to uOp gasData
            addedNative: 0n,
            token
        };
    });
    const accountState = accountStates[op.accountAddr][op.networkId];
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
    // always add a feeCall if available as we're using the paymaster
    // on predefined chains and on custom networks it is better to
    // have a slightly bigger estimation (if we don't have a paymaster)
    const estimateGasOp = { ...op };
    const feeToken = (0, estimateHelpers_1.getFeeTokenForEstimate)(feeTokens, network);
    if (feeToken)
        estimateGasOp.feeCall = (0, calls_1.getFeeCall)(feeToken);
    const initializeRequests = () => [
        deploylessEstimator
            .call('estimate', checkInnerCallsArgs, {
            from: deploy_1.DEPLOYLESS_SIMULATION_FROM,
            blockTag
        })
            .catch(errorHumanizer_1.getHumanReadableEstimationError),
        (0, estimateBundler_1.bundlerEstimate)(account, accountStates, op, network, feeTokens, provider, switcher, errorCallback),
        (0, estimateGas_1.estimateGas)(account, estimateGasOp, provider, accountState, network).catch(() => 0n)
    ];
    const estimations = await (0, estimateWithRetries_1.estimateWithRetries)(initializeRequests, 'estimation-deployless', errorCallback, 12000);
    const ambireEstimation = estimations[0];
    const bundlerEstimationResult = estimations[1];
    if (ambireEstimation instanceof Error) {
        return (0, errors_1.estimationErrorFormatted)(
        // give priority to the bundler error if both estimations end up with an error
        bundlerEstimationResult.error ?? ambireEstimation, { feePaymentOptions });
    }
    // // if there's a bundler error only, remove the smart account payment options
    // if (bundlerEstimationResult instanceof Error) feePaymentOptions = []
    const [[deployment, accountOpToExecuteBefore, accountOp, outcomeNonce, feeTokenOutcomes, , nativeAssetBalances, , l1GasEstimation]] = estimations[0];
    const ambireEstimationError = getInnerCallFailure(accountOp, calls, network, feeTokens.find((token) => token.address === ethers_1.ZeroAddress && !token.flags.onGasTank)?.amount) || getNonceDiscrepancyFailure(op, outcomeNonce);
    // if Estimation.sol estimate is a success, it means the nonce has incremented
    // so we subtract 1 from it. If it's an error, we return the old one
    bundlerEstimationResult.currentAccountNonce = accountOp.success
        ? Number(outcomeNonce - 1n)
        : Number(outcomeNonce);
    if (ambireEstimationError) {
        // if there's an ambire estimation error, we do not allow the txn
        // to be executed as it means it will most certainly fail
        bundlerEstimationResult.error = ambireEstimationError;
    }
    else if (!ambireEstimationError && bundlerEstimationResult.error) {
        // if there's a bundler error only, it means it's a bundler specific
        // problem. If we can switch the bundler, re-estimate
        if (switcher.canSwitch(null)) {
            switcher.switch();
            return estimate4337(account, op, calls, accountStates, network, provider, feeTokens, blockTag, nativeToCheck, switcher, errorCallback);
        }
        // if there's a bundler error only, it means we cannot do ERC-4337
        // but we have to do broadcast by EOA
        feePaymentOptions = [];
        delete bundlerEstimationResult.erc4337GasLimits;
        bundlerEstimationResult.error = null;
    }
    // set the gasUsed to the biggest one found from all estimations
    const bigIntMax = (...args) => args.reduce((m, e) => (e > m ? e : m));
    const ambireGas = deployment.gasUsed + accountOpToExecuteBefore.gasUsed + accountOp.gasUsed;
    const estimateGasCall = estimations[2];
    bundlerEstimationResult.gasUsed = bigIntMax(bundlerEstimationResult.gasUsed, estimateGasCall, ambireGas);
    const isPaymasterUsable = !!bundlerEstimationResult.erc4337GasLimits?.paymaster.isUsable();
    bundlerEstimationResult.feePaymentOptions = feePaymentOptions
        .filter((option) => isPaymasterUsable || option.token.address === ethers_1.ZeroAddress)
        .map((option, index) => {
        // after simulation: add the left over amount as available
        const localOp = { ...option };
        if (!option.token.flags.onGasTank) {
            localOp.availableAmount = feeTokenOutcomes[index][1];
            localOp.token.amount = feeTokenOutcomes[index][1];
        }
        localOp.gasUsed = localOp.token.flags.onGasTank ? 5000n : feeTokenOutcomes[index][0];
        return localOp;
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
    bundlerEstimationResult.feePaymentOptions = [
        ...bundlerEstimationResult.feePaymentOptions,
        ...nativeTokenOptions
    ];
    return bundlerEstimationResult;
}
exports.estimate4337 = estimate4337;
async function estimate(provider, network, account, op, accountStates, nativeToCheck, feeTokens, errorCallback, bundlerSwitcher, opts, blockFrom = '0x0000000000000000000000000000000000000001', blockTag = 'pending') {
    // if EOA, delegate
    if (!(0, account_1.isSmartAccount)(account))
        return (0, estimateEOA_1.estimateEOA)(account, op, accountStates, network, provider, feeTokens, blockFrom, blockTag, errorCallback);
    if (!network.isSAEnabled)
        return (0, errors_1.estimationErrorFormatted)(new Error('Smart accounts are not available for this network. Please use a Basic Account'));
    if (!network.areContractsDeployed)
        return (0, errors_1.estimationErrorFormatted)(new Error('The Ambire smart contracts are not deployed on this network, yet. You can deploy them via a Basic Account throught the network settings'));
    // @EntryPoint activation
    // if the account is v2 without the entry point signer being a signer
    // and the network is 4337 but doesn't have a paymaster and the account
    // is deployed for some reason, we should include the activator
    const calls = [...op.calls.map(accountOp_1.toSingletonCall)];
    const accountState = accountStates[op.accountAddr][op.networkId];
    if ((0, userOperation_1.shouldIncludeActivatorCall)(network, account, accountState, false)) {
        calls.push((0, userOperation_1.getActivatorCall)(op.accountAddr));
    }
    // if 4337, delegate
    if (opts && opts.is4337Broadcast)
        return estimate4337(account, op, calls, accountStates, network, provider, feeTokens, blockTag, nativeToCheck, bundlerSwitcher, errorCallback);
    const deploylessEstimator = (0, deployless_1.fromDescriptor)(provider, Estimation_json_1.default, !network.rpcNoStateOverride);
    const optimisticOracle = network.isOptimistic ? deploy_1.OPTIMISTIC_ORACLE : ethers_1.ZeroAddress;
    // if the network doesn't have a relayer, we can't pay in fee tokens
    const filteredFeeTokens = (0, networks_1.hasRelayerSupport)(network) ? feeTokens : [];
    // @L2s
    // craft the probableTxn that's going to be saved on the L1
    // so we could do proper estimation
    const encodedCallData = abiCoder.encode([
        'bytes',
        'address',
        'address',
        'uint256',
        'uint256',
        'uint256',
        'uint256' // gasLimit
    ], [
        (0, gasPrice_1.getProbableCallData)(account, op, accountState, network),
        op.accountAddr,
        addresses_1.FEE_COLLECTOR,
        100000,
        2,
        op.nonce,
        100000
    ]);
    const args = [
        account.addr,
        ...(0, account_1.getAccountDeployParams)(account),
        // @TODO can pass 0 here for the addr
        [
            account.addr,
            op.accountOpToExecuteBefore?.nonce || 0,
            op.accountOpToExecuteBefore?.calls || [],
            op.accountOpToExecuteBefore?.signature || '0x'
        ],
        [account.addr, op.nonce || 1, calls, '0x'],
        encodedCallData,
        account.associatedKeys,
        filteredFeeTokens.map((token) => token.address),
        addresses_1.FEE_COLLECTOR,
        nativeToCheck,
        optimisticOracle
    ];
    const initializeRequests = () => [
        deploylessEstimator
            .call('estimate', args, {
            from: blockFrom,
            blockTag
        })
            .catch(errorHumanizer_1.getHumanReadableEstimationError),
        (0, estimateGas_1.estimateGas)(account, op, provider, accountState, network).catch(() => 0n)
    ];
    const estimations = await (0, estimateWithRetries_1.estimateWithRetries)(initializeRequests, 'estimation-deployless', errorCallback);
    if (estimations instanceof Error)
        return (0, errors_1.estimationErrorFormatted)(estimations);
    const [[deployment, accountOpToExecuteBefore, accountOp, nonce, feeTokenOutcomes, , nativeAssetBalances, , l1GasEstimation // [gasUsed, baseFee, totalFee, gasOracle]
    ]] = estimations[0];
    let gasUsed = deployment.gasUsed + accountOpToExecuteBefore.gasUsed + accountOp.gasUsed;
    // if estimateGas brings a bigger estimation than Estimation.sol, use it
    const customlyEstimatedGas = estimations[1];
    if (gasUsed < customlyEstimatedGas)
        gasUsed = customlyEstimatedGas;
    // WARNING: calculateRefund will 100% NOT work in all cases we have
    // So a warning not to assume this is working
    if (opts?.calculateRefund)
        gasUsed = await (0, refund_1.refund)(account, op, provider, gasUsed);
    const feeTokenOptions = filteredFeeTokens.map((token, key) => {
        // We are using 'availableAmount' here, because it's possible the 'amount' to contains pending top up amount as well
        const availableAmount = token.flags.onGasTank && 'availableAmount' in token
            ? token.availableAmount || token.amount
            : feeTokenOutcomes[key].amount;
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
            token: {
                ...token,
                amount: availableAmount
            }
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
        // if Estimation.sol estimate is a success, it means the nonce has incremented
        // so we subtract 1 from it. If it's an error, we return the old one
        currentAccountNonce: accountOp.success ? Number(nonce - 1n) : Number(nonce),
        feePaymentOptions: [...feeTokenOptions, ...nativeTokenOptions],
        error: getInnerCallFailure(accountOp, calls, network, feeTokens.find((token) => token.address === ethers_1.ZeroAddress && !token.flags.onGasTank)?.amount) || getNonceDiscrepancyFailure(op, nonce)
    };
}
exports.estimate = estimate;
//# sourceMappingURL=estimate.js.map