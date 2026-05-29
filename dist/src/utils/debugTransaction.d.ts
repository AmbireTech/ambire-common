import { DebugTraceTransaction } from '../libs/accountOp/hyperEvmBalanceChanges';
type DebugTraceProvider = {
    send(method: string, params: any[]): Promise<any>;
};
export declare const getDebugTraceTransaction: (chainId: bigint, provider?: DebugTraceProvider) => DebugTraceTransaction;
export {};
//# sourceMappingURL=debugTransaction.d.ts.map