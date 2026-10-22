"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findWalletStakingLeaveLogsInTxns = exports.getWalletStakingLeaveTxnIds = exports.WALLET_STAKING_RECEIPT_RPC_TIMEOUT_MS = void 0;
const ethers_1 = require("ethers");
const addresses_1 = require("../../consts/addresses");
const with_timeout_1 = require("../../utils/with-timeout");
const submittedAccountOp_1 = require("../accountOp/submittedAccountOp");
const types_1 = require("../accountOp/types");
const pendingWithdrawal_1 = require("./pendingWithdrawal");
exports.WALLET_STAKING_RECEIPT_RPC_TIMEOUT_MS = 6000;
const WALLET_STAKING_LEAVE_SELECTOR = new ethers_1.Interface([
    'function leave(uint256 shares, bool skipMint)'
]).getFunction('leave').selector;
/**
 * Returns the ids of the locally known transactions that called the WALLET staking `leave`
 * method (an unstake). Transactions that failed or were rejected are ignored.
 */
const getWalletStakingLeaveTxnIds = (accountOps) => {
    const stakingAddr = addresses_1.WALLET_STAKING_ADDR.toLowerCase();
    const txnIds = accountOps.flatMap(({ txnId, identifiedBy, status, calls }) => {
        if (status === types_1.AccountOpStatus.Failure || status === types_1.AccountOpStatus.Rejected)
            return [];
        const leaveCall = calls.find(({ to, data }) => to?.toLowerCase() === stakingAddr &&
            data.toLowerCase().startsWith(WALLET_STAKING_LEAVE_SELECTOR));
        // An EOA without 7702 sends each call of a batch as its own transaction, and the op's txnId is
        // only the last one - so the leave event is in the leave call's own transaction
        const leaveTxnId = (0, submittedAccountOp_1.isIdentifiedByMultipleTxn)(identifiedBy) ? leaveCall?.txnId : txnId;
        return leaveCall && leaveTxnId ? [leaveTxnId.toLowerCase()] : [];
    });
    return Array.from(new Set(txnIds));
};
exports.getWalletStakingLeaveTxnIds = getWalletStakingLeaveTxnIds;
/**
 * Reads the receipts of the transactions from the RPC and returns the account's WALLET staking
 * leave logs from them, in the relayer's shape. Only logs that the staking contract emitted are
 * trusted. It does not contact the relayer, so the account address stays private. A transaction
 * without a receipt (unknown or not mined yet) returns no logs.
 */
const findWalletStakingLeaveLogsInTxns = async (txnIds, accountAddr, provider) => {
    const stakingAddr = addresses_1.WALLET_STAKING_ADDR.toLowerCase();
    const uniqueTxnIds = Array.from(new Set(txnIds.map((txnId) => txnId.trim().toLowerCase())));
    const settledResults = await Promise.allSettled(uniqueTxnIds.map(async (txnId) => {
        if (!(0, ethers_1.isHexString)(txnId, 32))
            throw new Error(`Invalid transaction id: ${txnId}`);
        const receipt = await (0, with_timeout_1.withTimeout)(() => provider.getTransactionReceipt(txnId), {
            timeoutMs: exports.WALLET_STAKING_RECEIPT_RPC_TIMEOUT_MS,
            message: 'The transaction took too long to load.'
        });
        const stakingLogs = (receipt?.logs || [])
            .filter(({ address }) => address.toLowerCase() === stakingAddr)
            .map(({ topics, data }) => ({ topics: [...topics], data }));
        return {
            txnId,
            logs: (0, pendingWithdrawal_1.getUniqueAccountWalletStakingLeaveLogs)(stakingLogs, accountAddr).map(({ log }) => log)
        };
    }));
    const results = [];
    const failedTxnIds = [];
    const errors = [];
    settledResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
            results.push(result.value);
            return;
        }
        failedTxnIds.push(uniqueTxnIds[index]);
        errors.push(result.reason instanceof Error ? result.reason : new Error('Unable to load the transaction.'));
    });
    return { results, failedTxnIds, errors };
};
exports.findWalletStakingLeaveLogsInTxns = findWalletStakingLeaveLogsInTxns;
//# sourceMappingURL=localWithdrawals.js.map