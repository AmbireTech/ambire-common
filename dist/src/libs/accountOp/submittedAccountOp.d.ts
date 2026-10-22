import { TransactionReceipt } from 'ethers';
import { BUNDLER } from '../../consts/bundlers';
import { Network } from '../../interfaces/network';
import { AccountOp } from './accountOp';
import { AccountOpStatus, Call } from './types';
import type { TokenResult } from '../portfolio/interfaces';
export type AccountOpIdentifiedBy = {
    type: 'Transaction' | 'UserOperation' | 'Relayer' | 'MultipleTxns';
    identifier: string;
    bundler?: BUNDLER;
};
export type PortfoliosToUpdate = {
    [address: string]: Network['chainId'][];
};
export type BalanceChange = Pick<TokenResult, 'symbol' | 'name' | 'decimals' | 'address' | 'chainId' | 'priceIn' | 'marketDataIn' | 'meta' | 'flags'> & {
    amount: bigint;
    amountBefore: bigint;
    amountAfter: bigint;
    balanceChange: bigint;
};
export type NftBalanceChange = {
    address: string;
    chainId: bigint;
    tokenId: bigint;
    balanceChange: bigint;
};
export interface SubmittedAccountOp extends AccountOp {
    txnId?: string;
    nonce: bigint;
    success?: boolean;
    timestamp: number;
    isSingletonDeploy?: boolean;
    identifiedBy: AccountOpIdentifiedBy;
    blockNumber?: number;
    blockHash?: string;
    gasUsed?: string;
    balanceChanges?: BalanceChange[];
    nftBalanceChanges?: NftBalanceChange[];
    balanceChangesFetchRetryCount?: number;
}
type SubmittedAccountOpActionFields = Pick<SubmittedAccountOp, 'signingKeyAddr' | 'signingKeyType' | 'nonce' | 'eoaNonce' | 'feeCall' | 'activatorCall' | 'gasLimit' | 'signature' | 'asUserOperation' | 'signers' | 'signed' | 'safeTx' | 'flags'>;
export interface SubmittedAccountOpLike extends Pick<SubmittedAccountOp, 'id' | 'accountAddr' | 'chainId' | 'calls' | 'gasFeePayment' | 'txnId' | 'status' | 'meta' | 'timestamp' | 'identifiedBy' | 'blockNumber' | 'blockHash' | 'gasUsed' | 'balanceChanges' | 'nftBalanceChanges' | 'balanceChangesFetchRetryCount'>, Partial<SubmittedAccountOpActionFields> {
    activitySource?: 'internal' | 'external';
}
/**
 * Adds to each call of a batch broadcast as one txn per call (`MultipleTxns`) the hash
 * of its txn. Calls without a txn were not sent (e.g. rejected on the hardware wallet
 * midway through the batch), so they are marked as rejected.
 */
export declare function getCallsWithTxnIds(submittedAccountOp: SubmittedAccountOp): SubmittedAccountOp['calls'];
/**
 * Rebuilds a full `AccountOp` from a `SubmittedAccountOpLike` - e.g. to re-run `humanizeAccountOp`
 * against a past activity item, which only carries the looser `SubmittedAccountOpLike` shape.
 * Fields absent from `SubmittedAccountOpLike` (because they were optional on
 * `SubmittedAccountOpActionFields`, or never persisted) fall back to `AccountOp`'s own defaults.
 */
export declare function submittedAccountOpToAccountOp(submittedAccountOp: SubmittedAccountOpLike): AccountOp;
/**
 * Returns the account-level nonce to store in Activity. Safe transactions broadcast through a
 * bundler have an unrelated, random UserOperation nonce, which remains available on
 * `accountOp.asUserOperation.nonce` and must not replace the Safe transaction nonce.
 */
export declare function getSubmittedAccountOpNonce(accountOpNonce: AccountOp['nonce'], broadcastNonce: number | bigint, isSafeAccount: boolean): bigint;
export declare function isIdentifiedByTxn(identifiedBy: AccountOpIdentifiedBy): boolean;
export declare function isIdentifiedByUserOpHash(identifiedBy: AccountOpIdentifiedBy): boolean;
export declare function isIdentifiedByRelayer(identifiedBy: AccountOpIdentifiedBy): boolean;
export declare function isIdentifiedByMultipleTxn(identifiedBy: AccountOpIdentifiedBy): boolean;
export declare function getDappIdentifier(op: SubmittedAccountOp): string;
export declare function getMultipleBroadcastUnconfirmedCallOrLast(op: AccountOp): {
    call: Call;
    callIndex: number;
};
export declare function fetchFrontRanTxnId(identifiedBy: AccountOpIdentifiedBy, foundTxnId: string, network: Network, counter?: number): Promise<string>;
export declare function hasTimePassedSinceBroadcast(op: SubmittedAccountOp, mins: number): boolean;
export declare function fetchTxnId(identifiedBy: AccountOpIdentifiedBy, network: Network, callRelayer: Function, op?: SubmittedAccountOp): Promise<{
    status: string;
    txnId: string | null;
}>;
export declare function updateOpStatus(opReference: SubmittedAccountOp, status: AccountOpStatus, receipt?: TransactionReceipt): SubmittedAccountOp | null;
/**
 * Returns the addresses an account op sends funds to - native transfers plus ERC20/ERC721
 * `transfer`, `transferFrom` and both `safeTransferFrom` overloads - checksummed, deduplicated
 * and in call order. Contract interactions are left out: calling a contract is not sending to it.
 *
 * @param whitelist Optional list of addresses to filter the results (case-insensitive).
 */
export declare function getAccountOpRecipients(op: Pick<AccountOp, 'calls'>, whitelist?: string[]): {
    address: string;
    domain?: string;
}[];
/**
 * Checks if the SubmittedAccountOp has a call that was sent to the specified address.
 *
 * @returns the timestamp of the operation if found, otherwise null.
 */
export declare function checkIsRecipientOfAccountOp(op: SubmittedAccountOp, to: string): number | null;
export {};
//# sourceMappingURL=submittedAccountOp.d.ts.map