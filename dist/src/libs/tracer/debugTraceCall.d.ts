import { Account, AccountOnchainState } from '../../interfaces/account';
import { Network } from '../../interfaces/network';
import { BaseAccount } from '../account/BaseAccount';
import { AccountOp } from '../accountOp/accountOp';
export declare function getStateOverride(account: Account, op: AccountOp, accountState: AccountOnchainState): {
    [account.addr]: {
        code: string;
        stateDiff: {
            [x: string]: string;
        };
    };
};
export declare function getFunctionParams(account: Account, op: AccountOp, accountState: AccountOnchainState): {
    to: string;
    value: string;
    data: string;
    from: string;
} | {
    to: string;
    value: number;
    data: string;
    from: string;
};
export declare function debugTraceCall(baseAcc: BaseAccount, op: AccountOp, network: Network, accountState: AccountOnchainState, overrideData?: any): Promise<{
    tokens: string[];
    nfts: [string, bigint[]][];
}>;
//# sourceMappingURL=debugTraceCall.d.ts.map