import { BUNDLER } from '../../consts/bundlers';
import { Fetch } from '../../interfaces/fetch';
import { Network } from '../../interfaces/network';
import { AccountOp } from './accountOp';
export type AccountOpIdentifiedBy = {
    type: 'Transaction' | 'UserOperation' | 'Relayer';
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
    flags?: {
        hideActivityBanner?: boolean;
    };
}
export declare function isIdentifiedByTxn(identifiedBy: AccountOpIdentifiedBy): boolean;
export declare function isIdentifiedByUserOpHash(identifiedBy: AccountOpIdentifiedBy): boolean;
export declare function isIdentifiedByRelayer(identifiedBy: AccountOpIdentifiedBy): boolean;
export declare function getDappIdentifier(op: SubmittedAccountOp): string;
export declare function fetchTxnId(identifiedBy: AccountOpIdentifiedBy, network: Network, fetchFn: Fetch, callRelayer: Function, op?: AccountOp): Promise<{
    status: string;
    txnId: string | null;
}>;
export declare function pollTxnId(identifiedBy: AccountOpIdentifiedBy, network: Network, fetchFn: Fetch, callRelayer: Function, failCount?: number): Promise<string | null>;
//# sourceMappingURL=submittedAccountOp.d.ts.map