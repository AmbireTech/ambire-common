/* eslint-disable no-await-in-loop */
/* eslint-disable no-continue */
/* eslint-disable no-constant-condition */
import { Interface } from 'ethers';
import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json';
import { paymasterFactory } from '../../services/paymaster';
import { getSignableCallsForBundlerEstimate } from '../accountOp/accountOp';
import { getHumanReadableEstimationError } from '../errorHumanizer';
import { getSigForCalculations, getUserOperation } from '../userOperation/userOperation';
import { estimationErrorFormatted } from './errors';
import { estimateWithRetries } from './estimateWithRetries';
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
            estimation: getHumanReadableEstimationError(decodedError),
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
            return getHumanReadableEstimationError(decodedError);
        })
    ];
    const estimation = await estimateWithRetries(initializeRequests, 'estimation-bundler', errorCallback);
    return {
        gasPrice,
        estimation,
        nonFatalErrors
    };
}
export async function bundlerEstimate(account, accountStates, op, network, feeTokens, provider, switcher, errorCallback) {
    // we pass an empty array of feePaymentOptions as they are built
    // in an upper level using the balances from Estimation.sol.
    // balances from Estimation.sol reflect the balances after pending txn exec
    const feePaymentOptions = [];
    const localOp = { ...op };
    const accountState = accountStates[localOp.accountAddr][localOp.networkId];
    // if there's no entryPointAuthorization, we cannot do the estimation on deploy
    if (!accountState.isDeployed && (!op.meta || !op.meta.entryPointAuthorization))
        return estimationErrorFormatted(new Error('Entry point privileges not granted. Please contact support'), { feePaymentOptions });
    const initialBundler = switcher.getBundler();
    const userOp = getUserOperation(account, accountState, localOp, initialBundler.getName(), !accountState.isDeployed ? op.meta.entryPointAuthorization : undefined);
    // set the callData
    if (userOp.activatorCall)
        localOp.activatorCall = userOp.activatorCall;
    const ambireAccount = new Interface(AmbireAccount.abi);
    const isEdgeCase = !accountState.isErc4337Enabled && accountState.isDeployed;
    userOp.signature = getSigForCalculations();
    const paymaster = await paymasterFactory.create(op, userOp, network, provider);
    localOp.feeCall = paymaster.getFeeCallForEstimation(feeTokens);
    userOp.callData = ambireAccount.encodeFunctionData('executeBySender', [
        getSignableCallsForBundlerEstimate(localOp)
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
            return estimationErrorFormatted(estimations.estimation, {
                feePaymentOptions,
                nonFatalErrors: estimations.nonFatalErrors
            });
        }
        // try again
        switcher.switch();
    }
}
//# sourceMappingURL=estimateBundler.js.map