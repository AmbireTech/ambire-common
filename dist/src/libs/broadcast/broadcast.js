"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BROADCAST_OPTIONS = void 0;
exports.getByOtherEOATxnData = getByOtherEOATxnData;
exports.getTxnData = getTxnData;
exports.buildRawTransaction = buildRawTransaction;
exports.broadcastTransaction = broadcastTransaction;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const estimate_1 = require("../estimate/estimate");
const AmbireAccount_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/AmbireAccount.json"));
const AmbireFactory_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/AmbireFactory.json"));
const IERC20_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/IERC20.json"));
const helpers_1 = require("../../libs/safe/helpers");
const wait_1 = tslib_1.__importDefault(require("../../utils/wait"));
const accountOp_1 = require("../accountOp/accountOp");
const helpers_2 = require("../errorDecoder/helpers");
const erc20interface = new ethers_1.Interface(IERC20_json_1.default.abi);
exports.BROADCAST_OPTIONS = {
    bySelf: 'self', // standard txn
    bySelf7702: 'self7702', // executeBySender
    byBundler: 'bundler', // userOp
    byRelayer: 'relayer', // execute
    byOtherEOA: 'otherEOA', // execute + standard
    delegation: 'delegation' // txn type 4
};
async function waitBeforeRetry(chainId) {
    // wait a bit longer on ethereum as txn confirmations are slower
    await (0, wait_1.default)(chainId === 1n ? 2000 : 1000);
}
function getByOtherEOATxnData(account, op, accountState) {
    if (accountState.isDeployed) {
        const ambireAccount = new ethers_1.Interface(AmbireAccount_json_1.default.abi);
        return {
            to: op.accountAddr,
            value: 0n,
            data: ambireAccount.encodeFunctionData('execute', [(0, accountOp_1.getSignableCalls)(op), op.signature])
        };
    }
    const ambireFactory = new ethers_1.Interface(AmbireFactory_json_1.default.abi);
    return {
        to: account.creation.factoryAddr,
        value: 0n,
        data: ambireFactory.encodeFunctionData('deployAndExecute', [
            account.creation.bytecode,
            account.creation.salt,
            (0, accountOp_1.getSignableCalls)(op),
            op.signature
        ])
    };
}
// estimate the gas for the call
async function estimateGas(provider, from, call, nonce, chainId, broadcastOption, op, error, counter = 0) {
    // this should happen only in the case of internet issues
    if (counter > 9) {
        throw new Error(`Failed estimating gas for broadcast${error ? `: ${(0, helpers_2.getErrorCodeStringFromReason)(error.message)}` : ''}`);
    }
    const callEstimateGas = provider
        .send('eth_estimateGas', [
        {
            from,
            to: call.to,
            value: (0, ethers_1.toQuantity)(call.value),
            data: call.data,
            nonce: (0, ethers_1.toQuantity)(nonce)
        },
        'pending'
    ])
        .catch((e) => e);
    const callGetNonce = provider.getTransactionCount(from).catch(() => null);
    const [gasLimit, foundNonce] = await Promise.all([callEstimateGas, callGetNonce]);
    // imagine a batch with two swaps, 4 txns total. Both swaps have the same from token
    // and from token amount. So #1 & #3 is an approval. #2 spends the approval.
    // when it's time to estimate #3, if the RPC doesn't know about #2, it will return
    // a lower gas for the transaction as the old state hasn't spent the approval =>
    // no storage writing. This results in an out of gas error on the #3 txn broadacst.
    // To fix this, we ensure there's no nonce discrepancy upon broadcast, meaning
    // the RPC knows about the previous txn that spends the approval, hence returning
    // the correct gasLimit for the call
    let hasNonceDiscrepancyOnApproval = nonce !== foundNonce;
    if (hasNonceDiscrepancyOnApproval) {
        try {
            hasNonceDiscrepancyOnApproval =
                call.data !== '0x' && !!erc20interface.decodeFunctionData('approve', call.data);
        }
        catch {
            hasNonceDiscrepancyOnApproval = false;
        }
    }
    // Sequential EOA calls can fail temporarily if the RPC pending state is stale.
    if (gasLimit instanceof Error || hasNonceDiscrepancyOnApproval) {
        if (gasLimit instanceof Error) {
            // Other estimation errors are deterministic, so return them immediately.
            const isGS013 = gasLimit.message.includes('GS013');
            const isEoaBatch = broadcastOption === exports.BROADCAST_OPTIONS.bySelf && op.calls.length > 1;
            if (!isGS013 && !isEoaBatch)
                throw gasLimit;
        }
        await waitBeforeRetry(chainId);
        return estimateGas(provider, from, call, nonce, chainId, broadcastOption, op, gasLimit, counter + 1);
    }
    // add gas overhead to prevent OOG
    return (0, estimate_1.getGasLimitWithOverhead)(BigInt(gasLimit));
}
async function getTxnData(account, op, accountState, provider, broadcastOption, nonce, call) {
    if (account.safeCreation) {
        const safeData = op.meta?.isSafeDeploy ? op.calls[0] : (0, helpers_1.getSafeBroadcastTxn)(op, accountState);
        if (!safeData)
            throw new Error('Safe deployment transaction is missing');
        const gasFeePayment = op.gasFeePayment;
        const simulatedGasLimit = gasFeePayment.simulatedGasLimit;
        if (gasFeePayment.isCustomGasLimit) {
            return {
                to: safeData.to,
                value: safeData.value,
                data: safeData.data,
                gasLimit: simulatedGasLimit
            };
        }
        const estimatedGasLimit = await estimateGas(provider, gasFeePayment.paidBy, safeData, nonce, op.chainId, broadcastOption, op);
        return {
            to: safeData.to,
            value: safeData.value,
            data: safeData.data,
            gasLimit: estimatedGasLimit > simulatedGasLimit ? estimatedGasLimit : simulatedGasLimit
        };
    }
    // no need to estimate gas for delegation, it's already estimated
    if (broadcastOption === exports.BROADCAST_OPTIONS.delegation) {
        if (op.calls.length > 1) {
            const ambireAccount = new ethers_1.Interface(AmbireAccount_json_1.default.abi);
            return {
                to: account.addr,
                value: 0n,
                data: ambireAccount.encodeFunctionData('executeBySender', [(0, accountOp_1.getSignableCalls)(op)])
            };
        }
        if (!call)
            throw new Error('single txn broadcast misconfig');
        return {
            to: call.to,
            value: call.value,
            data: call.data,
            gasLimit: op.gasFeePayment.simulatedGasLimit
        };
    }
    if (broadcastOption === exports.BROADCAST_OPTIONS.bySelf) {
        if (!call)
            throw new Error('single txn broadcast misconfig');
        // if the accountOp has more than 1 calls, we have to calculate the gas
        // for each one seperately
        let gasLimit = op.gasFeePayment.simulatedGasLimit;
        if (op.calls.length > 1) {
            gasLimit = await estimateGas(provider, account.addr, call, nonce, op.chainId, broadcastOption, op);
        }
        const singleCallTxn = {
            to: call.to,
            value: call.value,
            data: call.data,
            gasLimit
        };
        return singleCallTxn;
    }
    if (broadcastOption === exports.BROADCAST_OPTIONS.byOtherEOA) {
        const otherEOACall = getByOtherEOATxnData(account, op, accountState);
        const gasLimit = await estimateGas(provider, op.gasFeePayment.paidBy, otherEOACall, nonce, op.chainId, broadcastOption, op);
        return { ...otherEOACall, gasLimit };
    }
    // 7702 executeBySender
    const ambireAccount = new ethers_1.Interface(AmbireAccount_json_1.default.abi);
    return {
        to: account.addr,
        value: 0n,
        data: ambireAccount.encodeFunctionData('executeBySender', [(0, accountOp_1.getSignableCalls)(op)])
    };
}
async function buildRawTransaction(account, op, accountState, provider, network, nonce, broadcastOption, call) {
    const gasFeePayment = op.gasFeePayment;
    const txnData = await getTxnData(account, op, accountState, provider, broadcastOption, nonce, call);
    const rawTxn = {
        chainId: network.chainId,
        nonce,
        gasLimit: gasFeePayment.simulatedGasLimit,
        ...txnData,
        ...(gasFeePayment.isCustomGasLimit ? { gasLimit: gasFeePayment.simulatedGasLimit } : {})
    };
    if (gasFeePayment.maxPriorityFeePerGas !== undefined) {
        rawTxn.maxFeePerGas = gasFeePayment.gasPrice;
        rawTxn.maxPriorityFeePerGas = gasFeePayment.maxPriorityFeePerGas;
        rawTxn.type = 2;
    }
    else {
        rawTxn.gasPrice = gasFeePayment.gasPrice;
        rawTxn.type = 0;
    }
    return rawTxn;
}
async function broadcastTransaction(provider, signedTx, chainId, counter = 0) {
    if (counter > 2)
        throw new Error('broadcast failed');
    try {
        return provider.broadcastTransaction(signedTx);
    }
    catch (e) {
        console.log('broadcast failed: ', e);
        await waitBeforeRetry(chainId);
        return broadcastTransaction(provider, signedTx, chainId, counter + 1);
    }
}
//# sourceMappingURL=broadcast.js.map