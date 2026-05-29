import { TokenError, TokenResult } from '../portfolio/interfaces';
import { BalanceChange } from './submittedAccountOp';
import type { BalanceChangesReceipt, DebugTraceTransaction } from './hyperEvmBalanceChanges';
export type { BalanceChangesReceipt, BalanceChangeTransferLog } from './hyperEvmBalanceChanges';
export declare const getBalanceChangeTokenAddresses: (tokenAddrs: string[], chainId?: bigint) => string[];
export declare const compareTokenBalances: (beforeTokensWithErrors: [TokenError, TokenResult][], afterTokensWithErrors: [TokenError, TokenResult][]) => BalanceChange[];
type GetTokenBalancesOnBlock = (accountId: string, chainId: bigint, tokenAddrs: string[], blockTag: number | 'latest', accountAddr?: string) => Promise<[TokenError, TokenResult][]>;
export declare const getAccountOpBalanceChanges: ({ accountAddr, chainId, tokenAddrs, receiptBlockNumber, getTokenBalancesOnBlock, prevBlockNumber, receipts, debugTraceTransaction }: {
    accountAddr: string;
    chainId: bigint;
    tokenAddrs: string[];
    receiptBlockNumber: number;
    getTokenBalancesOnBlock: GetTokenBalancesOnBlock;
    prevBlockNumber?: number;
    receipts?: BalanceChangesReceipt[];
    debugTraceTransaction?: DebugTraceTransaction;
}) => Promise<BalanceChange[]>;
//# sourceMappingURL=balanceChanges.d.ts.map