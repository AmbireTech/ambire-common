"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pollTxnId = exports.fetchTxnId = exports.getDappIdentifier = exports.isIdentifiedByRelayer = exports.isIdentifiedByUserOpHash = exports.isIdentifiedByTxn = void 0;
const getBundler_1 = require("../../services/bundlers/getBundler");
const jiffyscan_1 = require("../../services/explorers/jiffyscan");
function isIdentifiedByTxn(identifiedBy) {
    return identifiedBy.type === 'Transaction';
}
exports.isIdentifiedByTxn = isIdentifiedByTxn;
function isIdentifiedByUserOpHash(identifiedBy) {
    return identifiedBy.type === 'UserOperation';
}
exports.isIdentifiedByUserOpHash = isIdentifiedByUserOpHash;
function isIdentifiedByRelayer(identifiedBy) {
    return identifiedBy.type === 'Relayer';
}
exports.isIdentifiedByRelayer = isIdentifiedByRelayer;
function getDappIdentifier(op) {
    let hash = `${op.identifiedBy.type}:${op.identifiedBy.identifier}`;
    if (op.identifiedBy?.bundler)
        hash = `${hash}:${op.identifiedBy.bundler}`;
    return hash;
}
exports.getDappIdentifier = getDappIdentifier;
async function fetchTxnId(identifiedBy, network, fetchFn, callRelayer, op) {
    if (isIdentifiedByTxn(identifiedBy))
        return {
            status: 'success',
            txnId: identifiedBy.identifier
        };
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
exports.fetchTxnId = fetchTxnId;
async function pollTxnId(identifiedBy, network, fetchFn, callRelayer, failCount = 0) {
    // allow 8 retries and declate fetching the txnId a failure after
    if (failCount >= 8)
        return null;
    const fetchTxnIdResult = await fetchTxnId(identifiedBy, network, fetchFn, callRelayer);
    if (fetchTxnIdResult.status === 'rejected')
        return null;
    if (fetchTxnIdResult.status === 'not_found') {
        const delayPromise = () => new Promise((resolve) => {
            setTimeout(resolve, 1500);
        });
        await delayPromise();
        const increase = failCount + 1;
        return pollTxnId(identifiedBy, network, fetchFn, callRelayer, increase);
    }
    return fetchTxnIdResult.txnId;
}
exports.pollTxnId = pollTxnId;
//# sourceMappingURL=submittedAccountOp.js.map