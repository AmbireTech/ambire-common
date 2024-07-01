import { JsonRpcProvider, toBeHex, toQuantity, ZeroAddress } from 'ethers'

import BalanceGetter from '../../../contracts/compiled/BalanceGetter.json'
import { DEPLOYLESS_SIMULATION_FROM } from '../../consts/deploy'
import { AccountOp } from '../accountOp/accountOp'
import { DeploylessMode, fromDescriptor } from '../deployless/deployless'
import { GasRecommendation } from '../gasPrice/gasPrice'

export async function debugTraceCall(
  op: AccountOp,
  provider: JsonRpcProvider,
  gasUsed: bigint,
  gasPrices: GasRecommendation[],
  supportsStateOverride: boolean
): Promise<string[]> {
  const fast = gasPrices.find((gas: any) => gas.name === 'fast')
  if (!fast) return []

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
            disableStorage: true,
            stateOverrides: supportsStateOverride
              ? {
                  [op.accountAddr]: {
                    balance: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
                  }
                }
              : {}
          }
        ])
        .catch((e: any) => {
          return [ZeroAddress]
        })
    })
  )
  const foundAddresses = [...new Set(results.flat(Infinity))]

  // we set the 3rd param to "true" as we don't need state override
  const deploylessTokens = fromDescriptor(provider, BalanceGetter, true)
  const opts = {
    blockTag: 'latest',
    from: DEPLOYLESS_SIMULATION_FROM,
    mode: DeploylessMode.ProxyContract
  }
  const [tokensWithErr] = await deploylessTokens.call(
    'getBalances',
    [op.accountAddr, foundAddresses],
    opts
  )

  return foundAddresses.filter((addr, i) => tokensWithErr[i].error === '0x')
}
