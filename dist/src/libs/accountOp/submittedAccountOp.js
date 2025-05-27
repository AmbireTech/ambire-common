"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isIdentifiedByTxn = isIdentifiedByTxn;
exports.isIdentifiedByUserOpHash = isIdentifiedByUserOpHash;
exports.isIdentifiedByRelayer = isIdentifiedByRelayer;
exports.isIdentifiedByMultipleTxn = isIdentifiedByMultipleTxn;
exports.getDappIdentifier = getDappIdentifier;
exports.getMultipleBroadcastUnconfirmedCallOrLast = getMultipleBroadcastUnconfirmedCallOrLast;
exports.fetchFrontRanTxnId = fetchFrontRanTxnId;
exports.fetchTxnId = fetchTxnId;
exports.updateOpStatus = updateOpStatus;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const getBundler_1 = require("../../services/bundlers/getBundler");
const jiffyscan_1 = require("../../services/explorers/jiffyscan");
const wait_1 = tslib_1.__importDefault(require("../../utils/wait"));
const types_1 = require("./types");
function isIdentifiedByTxn(identifiedBy) {
    return identifiedBy && identifiedBy.type === 'Transaction';
}
function isIdentifiedByUserOpHash(identifiedBy) {
    return identifiedBy && identifiedBy.type === 'UserOperation';
}
function isIdentifiedByRelayer(identifiedBy) {
    return identifiedBy && identifiedBy.type === 'Relayer';
}
function isIdentifiedByMultipleTxn(identifiedBy) {
    return identifiedBy && identifiedBy.type === 'MultipleTxns';
}
function getDappIdentifier(op) {
    let hash = `${op.identifiedBy.type}:${op.identifiedBy.identifier}`;
    if (op.identifiedBy?.bundler)
        hash = `${hash}:${op.identifiedBy.bundler}`;
    return hash;
}
function getMultipleBroadcastUnconfirmedCallOrLast(op) {
    // get the first BroadcastedButNotConfirmed call if any
    for (let i = 0; i < op.calls.length; i++) {
        const currentCall = op.calls[i];
        if (currentCall.status === types_1.AccountOpStatus.BroadcastedButNotConfirmed)
            return { call: currentCall, callIndex: i };
    }
    // if no BroadcastedButNotConfirmed, get the last one
    return { call: op.calls[op.calls.length - 1], callIndex: op.calls.length - 1 };
}
async function fetchFrontRanTxnId(identifiedBy, foundTxnId, network, counter = 0) {
    // try to find the probably front ran txn id 5 times and if it can't,
    // return the already found one. It could've really failed
    if (counter >= 5)
        return foundTxnId;
    const userOpHash = identifiedBy.identifier;
    const bundler = identifiedBy.bundler
        ? (0, getBundler_1.getBundlerByName)(identifiedBy.bundler)
        : (0, getBundler_1.getDefaultBundler)(network);
    const bundlerResult = await bundler.getStatus(network, userOpHash);
    if (!bundlerResult.transactionHash ||
        bundlerResult.transactionHash.toLowerCase() === foundTxnId.toLowerCase()) {
        await (0, wait_1.default)(2000);
        return fetchFrontRanTxnId(identifiedBy, foundTxnId, network, counter + 1);
    }
    return bundlerResult.transactionHash;
}
async function fetchTxnId(identifiedBy, network, fetchFn, callRelayer, op) {
    if (isIdentifiedByTxn(identifiedBy))
        return {
            status: 'success',
            txnId: identifiedBy.identifier
        };
    if (isIdentifiedByMultipleTxn(identifiedBy)) {
        if (op) {
            return {
                status: 'success',
                txnId: getMultipleBroadcastUnconfirmedCallOrLast(op).call.txnId
            };
        }
        // always return the last txn id if no account op
        const txnIds = identifiedBy.identifier.split('-');
        return {
            status: 'success',
            txnId: txnIds[txnIds.length - 1]
        };
    }
    if (isIdentifiedByUserOpHash(identifiedBy)) {
        const userOpHash = identifiedBy.identifier;
        const bundler = identifiedBy.bundler
            ? (0, getBundler_1.getBundlerByName)(identifiedBy.bundler)
            : (0, getBundler_1.getDefaultBundler)(network);
        const [response, bundlerResult] = await Promise.all([
            (0, jiffyscan_1.fetchUserOp)(userOpHash, fetchFn),
            bundler.getStatus(network, userOpHash)
        ]);
        if (bundlerResult.status === 'rejected')
            return {
                status: 'rejected',
                txnId: null
            };
        if (bundlerResult.transactionHash)
            return {
                status: 'success',
                txnId: bundlerResult.transactionHash
            };
        // on custom networks the response is null
        if (!response)
            return {
                status: 'not_found',
                txnId: null
            };
        // nothing we can do if we don't have information
        if (response.status !== 200)
            return {
                status: 'not_found',
                txnId: null
            };
        const data = await response.json();
        const userOps = data.userOps;
        // if there are not user ops, it means the userOpHash is not
        // indexed, yet, so we wait
        if (userOps.length)
            return {
                status: 'success',
                txnId: userOps[0].transactionHash
            };
        return {
            status: 'not_found',
            txnId: null
        };
    }
    const id = identifiedBy.identifier;
    let response = null;
    try {
        response = await callRelayer(`/v2/get-txn-id/${id}`);
    }
    catch (e) {
        // eslint-disable-next-line no-console
        console.log(`relayer responded with an error when trying to find the txnId: ${e}`);
        return {
            status: 'not_found',
            txnId: null
        };
    }
    if (!response.data.txId) {
        if (op && op.txnId)
            return {
                status: 'success',
                txnId: op.txnId
            };
        return {
            status: 'not_found',
            txnId: null
        };
    }
    return {
        status: 'success',
        txnId: response.data.txId
    };
}
function updateOpStatus(
// IMPORTANT: pass a reference to this.#accountsOps[accAddr][chainId][index]
// so we could mutate it from inside this method
opReference, status, receipt) {
    if (opReference.identifiedBy.type === 'MultipleTxns') {
        const callIndex = getMultipleBroadcastUnconfirmedCallOrLast(opReference).callIndex;
        // eslint-disable-next-line no-param-reassign
        opReference.calls[callIndex].status = status;
        // if there's a receipt, add the fee
        if (receipt) {
            // eslint-disable-next-line no-param-reassign
            opReference.calls[callIndex].fee = {
                inToken: ethers_1.ZeroAddress,
                amount: receipt.fee
            };
        }
        if (callIndex === opReference.calls.length - 1) {
            // eslint-disable-next-line no-param-reassign
            opReference.status = status;
            return opReference;
        }
        // returning null here means the accountOp as a whole is still not ready
        // to be updated as there are still pending transaction to be confirmed
        return null;
    }
    // eslint-disable-next-line no-param-reassign
    opReference.status = status;
    return opReference;
}
//# sourceMappingURL=submittedAccountOp.js.map