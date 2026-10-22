import { Account, AccountOnchainState } from '../../interfaces/account';
import { Network } from '../../interfaces/network';
import { RPCProvider } from '../../interfaces/provider';
import { BaseAccount } from '../account/BaseAccount';
import { AccountOp } from '../accountOp/accountOp';
interface CallTracerLog {
    address: string;
    topics?: string[];
}
interface CallTracerFrame {
    to?: string;
    calls?: CallTracerFrame[];
    logs?: CallTracerLog[];
}
export declare function parseCallTracerResult(result: CallTracerFrame | undefined): {
    tokens: string[];
    nfts: [string, bigint[]][];
};
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
export declare function getDiscoveredAssets(provider: RPCProvider, baseAcc: BaseAccount, op: AccountOp, network: Network, accountState: AccountOnchainState, foundTokens: string[], foundNftTransfers: [string, bigint[]][]): Promise<{
    tokens: string[];
    nfts: [string, bigint[]][];
}>;
export declare function debugTraceCall(baseAcc: BaseAccount, op: AccountOp, network: Network, accountState: AccountOnchainState, overrideData?: any): Promise<{
    tokens: string[];
    nfts: [string, bigint[]][];
}>;
export {};
//# sourceMappingURL=debugTraceCall.d.ts.map