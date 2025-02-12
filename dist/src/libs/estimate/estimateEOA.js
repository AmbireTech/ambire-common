"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.estimateEOA = void 0;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const Estimation_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/Estimation.json"));
const addresses_1 = require("../../consts/addresses");
const deploy_1 = require("../../consts/deploy");
const deployless_1 = require("../../consts/deployless");
const simulationStateOverride_1 = require("../../utils/simulationStateOverride");
const accountOp_1 = require("../accountOp/accountOp");
const deployless_2 = require("../deployless/deployless");
const errorHumanizer_1 = require("../errorHumanizer");
const errors_1 = require("./errors");
const estimateWithRetries_1 = require("./estimateWithRetries");
const abiCoder = new ethers_1.AbiCoder();
async function estimateEOA(account, op, accountStates, network, provider, feeTokens, blockFrom, blockTag, errorCallback) {
    if (op.calls.length !== 1)
        return (0, errors_1.estimationErrorFormatted)(new Error("Trying to make multiple calls with a Basic Account which shouldn't happen. Please try again or contact support."));
    const deploylessEstimator = (0, deployless_2.fromDescriptor)(provider, Estimation_json_1.default, !network.rpcNoStateOverride);
    const optimisticOracle = network.isOptimistic ? deploy_1.OPTIMISTIC_ORACLE : ethers_1.ZeroAddress;
    const call = op.calls[0];
    // TODO: try to remove this call
    const nonce = await provider.getTransactionCount(account.addr);
    const accountState = accountStates[op.accountAddr][op.networkId];
    const encodedCallData = abiCoder.encode([
        'bytes',
        'address',
        'address',
        'uint256',
        'uint256',
        'uint256',
        'uint256' // gasLimit
    ], [call.data, call.to ?? ethers_1.ZeroAddress, account.addr, 100000000, 2, nonce, 100000]);
    const initializeRequests = () => [
        provider
            .estimateGas({
            from: account.addr,
            to: call.to ?? undefined,
            value: call.value,
            data: call.data,
            nonce
        })
            .catch(errorHumanizer_1.getHumanReadableEstimationError),
        !network.rpcNoStateOverride
            ? deploylessEstimator
                .call('estimateEoa', [
                account.addr,
                [account.addr, deployless_1.EOA_SIMULATION_NONCE, op.calls.map(accountOp_1.toSingletonCall), '0x'],
                encodedCallData,
                [account.addr],
                addresses_1.FEE_COLLECTOR,
                optimisticOracle
            ], {
                from: blockFrom,
                blockTag,
                mode: deployless_2.DeploylessMode.StateOverride,
                stateToOverride: (0, simulationStateOverride_1.getEoaSimulationStateOverride)(account.addr)
            })
                .catch((e) => {
                console.log('error calling estimateEoa:', e);
                return [[0n, [], {}]];
            })
            : deploylessEstimator
                .call('getL1GasEstimation', [encodedCallData, addresses_1.FEE_COLLECTOR, optimisticOracle], {
                from: blockFrom,
                blockTag
            })
                .catch(errorHumanizer_1.getHumanReadableEstimationError)
    ];
    const result = await (0, estimateWithRetries_1.estimateWithRetries)(initializeRequests, 'estimation-eoa', errorCallback);
    const feePaymentOptions = [
        {
            paidBy: account.addr,
            availableAmount: accountState.balance,
            addedNative: 0n,
            token: feeTokens.find((token) => token.address === ethers_1.ZeroAddress && !token.flags.onGasTank)
        }
    ];
    if (result instanceof Error)
        return (0, errors_1.estimationErrorFormatted)(result, { feePaymentOptions });
    let gasUsed = 0n;
    if (!network.rpcNoStateOverride) {
        const [gasUsedEstimateGas, [[gasUsedEstimationSol, feeTokenOutcomes, l1GasEstimation]]] = result;
        if (feeTokenOutcomes.length && feeTokenOutcomes[0].length) {
            feePaymentOptions[0].availableAmount = feeTokenOutcomes[0][1];
        }
        if (l1GasEstimation && l1GasEstimation.fee) {
            feePaymentOptions[0].addedNative = l1GasEstimation.fee;
        }
        // if it's a simple transfer, trust estimateGas as it should be 21K
        // if it's a contract call, trust whichever is higher
        if (call.data === '0x')
            gasUsed = gasUsedEstimateGas;
        else
            gasUsed =
                gasUsedEstimateGas > gasUsedEstimationSol ? gasUsedEstimateGas : gasUsedEstimationSol;
    }
    else {
        const [gasUsedEstimateGas, [l1GasEstimation]] = result;
        feePaymentOptions[0].addedNative = l1GasEstimation.fee;
        gasUsed = gasUsedEstimateGas;
    }
    return {
        gasUsed,
        currentAccountNonce: nonce,
        feePaymentOptions,
        error: result instanceof Error ? result : null
    };
}
exports.estimateEOA = estimateEOA;
//# sourceMappingURL=estimateEOA.js.map