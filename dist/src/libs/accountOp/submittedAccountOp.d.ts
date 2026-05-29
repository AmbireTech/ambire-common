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
    balanceChangesFetchRetryCount?: number;
}
type SubmittedAccountOpActionFields = Pick<SubmittedAccountOp, 'signingKeyAddr' | 'signingKeyType' | 'nonce' | 'eoaNonce' | 'feeCall' | 'activatorCall' | 'gasLimit' | 'signature' | 'asUserOperation' | 'signers' | 'signed' | 'safeTx' | 'flags'>;
export interface SubmittedAccountOpLike extends Pick<SubmittedAccountOp, 'id' | 'accountAddr' | 'chainId' | 'calls' | 'gasFeePayment' | 'txnId' | 'status' | 'meta' | 'timestamp' | 'identifiedBy' | 'blockNumber' | 'blockHash' | 'gasUsed' | 'balanceChanges' | 'balanceChangesFetchRetryCount'>, Partial<SubmittedAccountOpActionFields> {
    activitySource?: 'internal' | 'external';
}
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
 * Returns all addresses that the SubmittedAccountOp has calls sent to.
 *
 * @param whitelist Optional list of addresses to filter the results.
 */
export declare function getAccountOpRecipients(op: SubmittedAccountOp, whitelist?: string[]): string[];
/**
 * Checks if the SubmittedAccountOp has a call that was sent to the specified address.
 *
 * @returns the timestamp of the operation if found, otherwise null.
 */
export declare function checkIsRecipientOfAccountOp(op: SubmittedAccountOp, to: string): number | null;
export {};
//# sourceMappingURL=submittedAccountOp.d.ts.map