"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BROADCAST_OPTIONS = void 0;
exports.getByOtherEOATxnData = getByOtherEOATxnData;
exports.getTxnData = getTxnData;
exports.buildRawTransaction = buildRawTransaction;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const AmbireAccount_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/AmbireAccount.json"));
const AmbireFactory_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/AmbireFactory.json"));
const IERC20_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/IERC20.json"));
const wait_1 = tslib_1.__importDefault(require("../../utils/wait"));
const accountOp_1 = require("../accountOp/accountOp");
const erc20interface = new ethers_1.Interface(IERC20_json_1.default.abi);
exports.BROADCAST_OPTIONS = {
    bySelf: 'self', // standard txn
    bySelf7702: 'self7702', // executeBySender
    byBundler: 'bundler', // userOp
    byRelayer: 'relayer', // execute
    byOtherEOA: 'otherEOA', // execute + standard
    delegation: 'delegation' // txn type 4
};
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
async function estimateGas(provider, from, call, nonce, counter = 0) {
    // this should happen only in the case of internet issues
    if (counter > 10)
        throw new Error('Failed estimating gas from broadcast');
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
        catch (e) {
            hasNonceDiscrepancyOnApproval = false;
        }
    }
    // if there's an error, wait a bit and retry
    // the error is most likely because of an incorrect RPC pending state
    if (gasLimit instanceof Error || hasNonceDiscrepancyOnApproval) {
        await (0, wait_1.default)(1500);
        return estimateGas(provider, from, call, nonce, counter + 1);
    }
    return gasLimit;
}
async function getTxnData(account, op, accountState, provider, broadcastOption, nonce, call) {
    // no need to estimate gas for delegation, it's already estimated
    if (broadcastOption === exports.BROADCAST_OPTIONS.delegation) {
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
            gasLimit = await estimateGas(provider, account.addr, call, nonce);
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
        const gasLimit = await estimateGas(provider, account.addr, otherEOACall, nonce);
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
        ...txnData
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
//# sourceMappingURL=broadcast.js.map