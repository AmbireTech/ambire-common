import { RPCProvider } from '../../interfaces/provider';
import { WalletStakingRelayerLog } from './pendingWithdrawal';
import type { SubmittedAccountOp } from '../accountOp/submittedAccountOp';
export declare const WALLET_STAKING_RECEIPT_RPC_TIMEOUT_MS = 6000;
/**
 * Returns the ids of the locally known transactions that called the WALLET staking `leave`
 * method (an unstake). Transactions that failed or were rejected are ignored.
 */
export declare const getWalletStakingLeaveTxnIds: (accountOps: SubmittedAccountOp[]) => string[];
/**
 * Reads the receipts of the transactions from the RPC and returns the account's WALLET staking
 * leave logs from them, in the relayer's shape. Only logs that the staking contract emitted are
 * trusted. It does not contact the relayer, so the account address stays private. A transaction
 * without a receipt (unknown or not mined yet) returns no logs.
 */
export declare const findWalletStakingLeaveLogsInTxns: (txnIds: string[], accountAddr: string, provider: RPCProvider) => Promise<{
    results: {
        txnId: string;
        logs: WalletStakingRelayerLog[];
    }[];
    failedTxnIds: string[];
    errors: Error[];
}>;
//# sourceMappingURL=localWithdrawals.d.ts.map