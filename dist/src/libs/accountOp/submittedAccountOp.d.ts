import { TransactionReceipt } from 'ethers';
import { BUNDLER } from '../../consts/bundlers';
import { Fetch } from '../../interfaces/fetch';
import { Network } from '../../interfaces/network';
import { AccountOp } from './accountOp';
import { AccountOpStatus, Call } from './types';
export type AccountOpIdentifiedBy = {
    type: 'Transaction' | 'UserOperation' | 'Relayer' | 'MultipleTxns';
    identifier: string;
    bundler?: BUNDLER;
};
export interface SubmittedAccountOp extends AccountOp {
    txnId?: string;
    nonce: bigint;
    success?: boolean;
    timestamp: number;
    isSingletonDeploy?: boolean;
    identifiedBy: AccountOpIdentifiedBy;
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
export declare function fetchTxnId(identifiedBy: AccountOpIdentifiedBy, network: Network, fetchFn: Fetch, callRelayer: Function, op?: AccountOp): Promise<{
    status: string;
    txnId: string | null;
}>;
export declare function updateOpStatus(opReference: SubmittedAccountOp, status: AccountOpStatus, receipt?: TransactionReceipt): SubmittedAccountOp | null;
//# sourceMappingURL=submittedAccountOp.d.ts.map