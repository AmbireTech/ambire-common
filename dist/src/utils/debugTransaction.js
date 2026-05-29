import { HYPER_EVM_CHAIN_ID } from '../libs/accountOp/hyperEvmBalanceChanges';
export const getDebugTraceTransaction = (chainId, provider) => (txnHash) => chainId === HYPER_EVM_CHAIN_ID && provider
    ? provider.send('debug_traceTransaction', [txnHash, { tracer: 'callTracer' }])
    : Promise.resolve(null);
//# sourceMappingURL=debugTransaction.js.map