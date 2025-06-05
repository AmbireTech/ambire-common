"use strict";
/* eslint-disable no-await-in-loop */
/* eslint-disable no-continue */
/* eslint-disable no-constant-condition */
Object.defineProperty(exports, "__esModule", { value: true });
exports.bundlerEstimate = bundlerEstimate;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const AmbireAccount_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/AmbireAccount.json"));
const EntryPoint_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/EntryPoint.json"));
const deploy_1 = require("../../consts/deploy");
const paymaster_1 = require("../../services/paymaster");
const accountOp_1 = require("../accountOp/accountOp");
const errorHumanizer_1 = require("../errorHumanizer");
const userOperation_1 = require("../userOperation/userOperation");
const estimateWithRetries_1 = require("./estimateWithRetries");
async function estimate(baseAcc, bundler, network, userOp, errorCallback) {
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
    const estimateErrorCallback = (e) => {
        const decodedError = bundler.decodeBundlerError(e);
        // if the bundler estimation fails, add a nonFatalError so we can react to
        // it on the FE. The BE at a later stage decides if this error is actually
        // fatal (at estimate.ts -> estimate4337)
        nonFatalErrors.push(new Error('Bundler estimation failed', { cause: '4337_ESTIMATION' }));
        if (decodedError.reason && decodedError.reason.indexOf('invalid account nonce') !== -1) {
            nonFatalErrors.push(new Error('4337 invalid account nonce', { cause: '4337_INVALID_NONCE' }));
        }
        return (0, errorHumanizer_1.getHumanReadableEstimationError)(decodedError);
    };
    const stateOverride = baseAcc.getBundlerStateOverride(localUserOp);
    const initializeRequests = () => [
        bundler.estimate(userOp, network, stateOverride).catch(estimateErrorCallback)
    ];
    const estimation = await (0, estimateWithRetries_1.estimateWithRetries)(initializeRequests, 'estimation-bundler', errorCallback);
    const foundError = Array.isArray(estimation)
        ? estimation.find((res) => res instanceof Error)
        : null;
    return {
        gasPrice,
        estimation: foundError ?? estimation,
        nonFatalErrors
    };
}
async function bundlerEstimate(baseAcc, accountState, op, network, feeTokens, provider, switcher, errorCallback, eip7702Auth) {
    if (!baseAcc.supportsBundlerEstimation())
        return null;
    const account = baseAcc.getAccount();
    const localOp = { ...op };
    const initialBundler = switcher.getBundler();
    const userOp = (0, userOperation_1.getUserOperation)(account, accountState, localOp, initialBundler.getName(), op.meta?.entryPointAuthorization, eip7702Auth);
    // set the callData
    if (userOp.activatorCall)
        localOp.activatorCall = userOp.activatorCall;
    const ambireAccount = new ethers_1.Interface(AmbireAccount_json_1.default.abi);
    userOp.signature = (0, userOperation_1.getSigForCalculations)();
    userOp.callData = ambireAccount.encodeFunctionData('executeBySender', [(0, accountOp_1.getSignableCalls)(localOp)]);
    const paymaster = await paymaster_1.paymasterFactory.create(op, userOp, account, network, provider);
    localOp.feeCall = paymaster.getFeeCallForEstimation(feeTokens);
    userOp.callData = ambireAccount.encodeFunctionData('executeBySender', [(0, accountOp_1.getSignableCalls)(localOp)]);
    const feeCallType = paymaster.getFeeCallType(feeTokens);
    if (paymaster.isUsable()) {
        const paymasterEstimationData = paymaster.getEstimationData();
        userOp.paymaster = paymasterEstimationData.paymaster;
        userOp.paymasterData = paymasterEstimationData.paymasterData;
        if (paymasterEstimationData.paymasterPostOpGasLimit)
            userOp.paymasterPostOpGasLimit = paymasterEstimationData.paymasterPostOpGasLimit;
        if (paymasterEstimationData.paymasterVerificationGasLimit)
            userOp.paymasterVerificationGasLimit = paymasterEstimationData.paymasterVerificationGasLimit;
    }
    const flags = {};
    while (true) {
        // estimate
        const bundler = switcher.getBundler();
        const estimations = await estimate(baseAcc, bundler, network, userOp, errorCallback);
        // if no errors, return the results and get on with life
        if (!(estimations.estimation instanceof Error)) {
            const gasData = estimations.estimation[0];
            return {
                preVerificationGas: gasData.preVerificationGas,
                verificationGasLimit: gasData.verificationGasLimit,
                callGasLimit: gasData.callGasLimit,
                paymasterVerificationGasLimit: gasData.paymasterVerificationGasLimit,
                paymasterPostOpGasLimit: gasData.paymasterPostOpGasLimit,
                gasPrice: estimations.gasPrice,
                paymaster,
                flags,
                feeCallType
            };
        }
        // try again if the error is 4337_INVALID_NONCE
        if (estimations.nonFatalErrors.length &&
            estimations.nonFatalErrors.find((err) => err.cause === '4337_INVALID_NONCE')) {
            const ep = new ethers_1.Contract(deploy_1.ERC_4337_ENTRYPOINT, EntryPoint_json_1.default, provider);
            let accountNonce = null;
            // infinite loading is fine here as this is how 4337_INVALID_NONCE error
            // was handled in previous cases and worked pretty well: retry until fix
            while (!accountNonce) {
                accountNonce = await ep.getNonce(account.addr, 0, { blockTag: 'pending' }).catch(() => null);
            }
            userOp.nonce = (0, ethers_1.toBeHex)(accountNonce);
            flags.has4337NonceDiscrepancy = true;
            continue;
        }
        // if there's an error but we can't switch, return the error
        if (!switcher.canSwitch(account, estimations.estimation))
            return estimations.estimation;
        // try again
        switcher.switch();
    }
}
//# sourceMappingURL=estimateBundler.js.map