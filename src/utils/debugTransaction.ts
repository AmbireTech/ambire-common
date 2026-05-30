import { DebugTraceTransaction, HYPER_EVM_CHAIN_ID } from '../libs/accountOp/hyperEvmBalanceChanges'

type DebugTraceProvider = {
  send(method: string, params: any[]): Promise<any>
}

export const getDebugTraceTransaction =
  (chainId: bigint, provider?: DebugTraceProvider): DebugTraceTransaction =>
  (txnHash) =>
    chainId === HYPER_EVM_CHAIN_ID && provider
      ? provider.send('debug_traceTransaction', [txnHash, { tracer: 'callTracer' }])
      : Promise.resolve(null)
