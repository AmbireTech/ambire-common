import { TokenError, TokenResult } from '../portfolio/interfaces';
import { BalanceChange } from './submittedAccountOp';
export declare const HYPER_EVM_CHAIN_ID = 999n;
export type BalanceChangeTransferLog = {
    address: string;
    topics: readonly string[];
    data: string;
};
export type BalanceChangesReceipt = {
    logs: readonly BalanceChangeTransferLog[];
    hash?: string;
    from?: string;
    gasUsed?: bigint;
    gasPrice?: bigint;
    fee?: bigint;
};
export type DebugTraceCall = {
    type?: string;
    from?: string;
    to?: string;
    value?: string;
    calls?: DebugTraceCall[];
};
export type DebugTraceTransaction = (txnHash: string) => Promise<DebugTraceCall | null>;
type GetTokenBalancesOnBlock = (accountId: string, chainId: bigint, tokenAddrs: string[], blockTag: number | 'latest', accountAddr?: string) => Promise<[TokenError, TokenResult][]>;
export declare const getHyperEvmBalanceChanges: ({ accountAddr, chainId, getTokenBalancesOnBlock, receipts, debugTraceTransaction }: {
    accountAddr: string;
    chainId: bigint;
    getTokenBalancesOnBlock: GetTokenBalancesOnBlock;
    receipts?: BalanceChangesReceipt[];
    debugTraceTransaction?: DebugTraceTransaction;
}) => Promise<BalanceChange[]>;
export {};
//# sourceMappingURL=hyperEvmBalanceChanges.d.ts.map