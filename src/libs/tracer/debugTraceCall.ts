import { JsonRpcProvider, Provider, toQuantity, ZeroAddress } from 'ethers'

import { AccountOp } from '../accountOp/accountOp'
import { GasRecommendation } from '../gasPrice/gasPrice'

export async function debugTraceCall(
  op: AccountOp,
  provider: JsonRpcProvider,
  gasUsed: bigint,
  gasPrices: GasRecommendation[]
) {
  const fast = gasPrices.find((gas: any) => gas.name === 'fast')
  if (!fast) return null

  const gasPrice =
    'gasPrice' in fast ? fast.gasPrice : fast.baseFeePerGas + fast.maxPriorityFeePerGas

  const results = await Promise.all(
    op.calls.map(async (call) => {
      return provider
        .send('debug_traceCall', [
          {
            to: call.to,
            value: toQuantity(call.value.toString()),
            data: call.data,
            from: op.accountAddr,
            gasPrice: toQuantity(gasPrice.toString()),
            gas: toQuantity(gasUsed.toString())
          },
          'latest',
          {
            tracer:
              "{data: [], fault: function (log) {}, step: function (log) { if (log.op.toString() === 'LOG3') { this.data.push([ toHex(log.contract.getAddress()), '0x' + ('0000000000000000000000000000000000000000' + log.stack.peek(4).toString(16)).slice(-40)])}}, result: function () { return this.data }}",
            enableMemory: false,
            enableReturnData: true,
            disableStorage: true
          }
        ])
        .catch((e: any) => {
          return [ZeroAddress]
        })
    })
  )

  console.log(results)

  return results
}
