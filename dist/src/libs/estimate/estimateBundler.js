"use strict";
/* eslint-disable no-await-in-loop */
/* eslint-disable no-continue */
/* eslint-disable no-constant-condition */
Object.defineProperty(exports, "__esModule", { value: true });
exports.bundlerEstimate = void 0;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const AmbireAccount_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/AmbireAccount.json"));
const paymaster_1 = require("../../services/paymaster");
const accountOp_1 = require("../accountOp/accountOp");
const errorHumanizer_1 = require("../errorHumanizer");
const userOperation_1 = require("../userOperation/userOperation");
const errors_1 = require("./errors");
const estimateWithRetries_1 = require("./estimateWithRetries");
async function estimate(bundler, network, userOp, isEdgeCase, errorCallback) {
    const gasPrice = await bundler.fetchGasPrices(network, errorCallback).catch(() => {
        return new Error('Could not fetch gas prices, retrying...');
    });
    // if the gasPrice fetch fails, we will switch the bundler and try again
    if (gasPrice instanceof Error) {
        const decodedError = bundler.decodeBundlerError(new Error('internal error'));
        return {
            gasPrice,
            // if gas prices couldn't be fetched, it means there's an internal error
            estimation: (0, errorHumanizer_1.getHumanReadableEstimationError)(decodedError),
            nonFatalErrors: []
        };
    }
    // add the maxFeePerGas and maxPriorityFeePerGas only if the network
    // is optimistic as the bundler uses these values to determine the
    // preVerificationGas.
    const localUserOp = { ...userOp };
    if (network.isOptimistic) {
        // use medium for the gas limit estimation
        localUserOp.maxPriorityFeePerGas = gasPrice.medium.maxPriorityFeePerGas;
        localUserOp.maxFeePerGas = gasPrice.medium.maxFeePerGas;
    }
    const nonFatalErrors = [];
    const initializeRequests = () => [
        bundler.estimate(userOp, network, isEdgeCase).catch((e) => {
            const decodedError = bundler.decodeBundlerError(e);
            // if the bundler estimation fails, add a nonFatalError so we can react to
            // it on the FE. The BE at a later stage decides if this error is actually
            // fatal (at estimate.ts -> estimate4337)
            nonFatalErrors.push(new Error('Bundler estimation failed', { cause: '4337_ESTIMATION' }));
            if (decodedError.reason && decodedError.reason.indexOf('invalid account nonce') !== -1) {
                nonFatalErrors.push(new Error('4337 invalid account nonce', { cause: '4337_INVALID_NONCE' }));
            }
            return (0, errorHumanizer_1.getHumanReadableEstimationError)(decodedError);
        })
    ];
    const estimation = await (0, estimateWithRetries_1.estimateWithRetries)(initializeRequests, 'estimation-bundler', errorCallback);
    return {
        gasPrice,
        estimation,
        nonFatalErrors
    };
}
async function bundlerEstimate(account, accountStates, op, network, feeTokens, provider, switcher, errorCallback) {
    // we pass an empty array of feePaymentOptions as they are built
    // in an upper level using the balances from Estimation.sol.
    // balances from Estimation.sol reflect the balances after pending txn exec
    const feePaymentOptions = [];
    const localOp = { ...op };
    const accountState = accountStates[localOp.accountAddr][localOp.networkId];
    // if there's no entryPointAuthorization, we cannot do the estimation on deploy
    if (!accountState.isDeployed && (!op.meta || !op.meta.entryPointAuthorization))
        return (0, errors_1.estimationErrorFormatted)(new Error('Entry point privileges not granted. Please contact support'), { feePaymentOptions });
    const initialBundler = switcher.getBundler();
    const userOp = (0, userOperation_1.getUserOperation)(account, accountState, localOp, initialBundler.getName(), !accountState.isDeployed ? op.meta.entryPointAuthorization : undefined);
    // set the callData
    if (userOp.activatorCall)
        localOp.activatorCall = userOp.activatorCall;
    const ambireAccount = new ethers_1.Interface(AmbireAccount_json_1.default.abi);
    const isEdgeCase = !accountState.isErc4337Enabled && accountState.isDeployed;
    userOp.signature = (0, userOperation_1.getSigForCalculations)();
    const paymaster = await paymaster_1.paymasterFactory.create(op, userOp, network, provider);
    localOp.feeCall = paymaster.getFeeCallForEstimation(feeTokens);
    userOp.callData = ambireAccount.encodeFunctionData('executeBySender', [
        (0, accountOp_1.getSignableCallsForBundlerEstimate)(localOp)
    ]);
    if (paymaster.isUsable()) {
        const paymasterEstimationData = paymaster.getEstimationData();
        userOp.paymaster = paymasterEstimationData.paymaster;
        userOp.paymasterData = paymasterEstimationData.paymasterData;
        if (paymasterEstimationData.paymasterPostOpGasLimit)
            userOp.paymasterPostOpGasLimit = paymasterEstimationData.paymasterPostOpGasLimit;
        if (paymasterEstimationData.paymasterVerificationGasLimit)
            userOp.paymasterVerificationGasLimit = paymasterEstimationData.paymasterVerificationGasLimit;
    }
    while (true) {
        // estimate
        const bundler = switcher.getBundler();
        const estimations = await estimate(bundler, network, userOp, isEdgeCase, errorCallback);
        // if no errors, return the results and get on with life
        if (!(estimations.estimation instanceof Error)) {
            const gasData = estimations.estimation[0];
            return {
                gasUsed: BigInt(gasData.callGasLimit),
                currentAccountNonce: Number(op.nonce),
                feePaymentOptions,
                erc4337GasLimits: {
                    preVerificationGas: gasData.preVerificationGas,
                    verificationGasLimit: gasData.verificationGasLimit,
                    callGasLimit: gasData.callGasLimit,
                    paymasterVerificationGasLimit: gasData.paymasterVerificationGasLimit,
                    paymasterPostOpGasLimit: gasData.paymasterPostOpGasLimit,
                    gasPrice: estimations.gasPrice,
                    paymaster
                },
                error: null
            };
        }
        // if there's an error but we can't switch, return the error
        if (!switcher.canSwitch(estimations.estimation)) {
            return (0, errors_1.estimationErrorFormatted)(estimations.estimation, {
                feePaymentOptions,
                nonFatalErrors: estimations.nonFatalErrors
            });
        }
        // try again
        switcher.switch();
    }
}
exports.bundlerEstimate = bundlerEstimate;
//# sourceMappingURL=estimateBundler.js.map