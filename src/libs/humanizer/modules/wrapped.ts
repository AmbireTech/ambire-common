import { Interface, ZeroAddress } from 'ethers'

import { AccountOp } from '../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../interfaces'
import { getKnownAbi, getUnknownVisualization, getUnwraping, getWraping } from '../utils'

const WRAPPEDISH_ADDRESSES: { [kjey: string]: string } = {
  [ZeroAddress]: 'native',
  '0x4200000000000000000000000000000000000042': 'OP',
  '0x4200000000000000000000000000000000000006': 'WETHOptimism',
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 'WETH',
  '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619': 'WETHPolygon',
  '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270': 'WMATIC',
  '0x82af49447d8a07e3bd95bd0d56f35241523fbab1': 'WETHArbitrum'
}
const wrapSwapReducer = (calls: IrCall[]) => {
  const newCalls: IrCall[] = []
  for (let i = 0; i < calls.length; i++) {
    if (
      // swapping x amount of token for y of WETH and unwrapping y WETH for y ETH
      calls[i]?.fullVisualization?.[0].content?.includes('Swap') &&
      calls[i + 1]?.fullVisualization?.[0].content?.includes('Unwrap') &&
      calls[i + 1]?.fullVisualization?.[1].address &&
      WRAPPEDISH_ADDRESSES[calls[i + 1]?.fullVisualization?.[1].address!] &&
      calls[i]?.fullVisualization?.[3].amount === calls[i + 1]?.fullVisualization?.[1]?.amount
    ) {
      const newVisualization = calls[i]?.fullVisualization!
      newVisualization[3].address = ZeroAddress

      newCalls.push({
        to: calls[i].to,
        value: calls[i].value + calls[i + 1].value,
        // the unwrap call.data is omitted
        data: calls[i].data,
        fromUserRequestId: calls[i].fromUserRequestId,
        fullVisualization: newVisualization
      })
      i += 1
    } else if (
      calls[i]?.fullVisualization?.[0].content?.includes('Wrap') &&
      calls[i + 1]?.fullVisualization?.[0].content?.includes('Swap') &&
      calls[i].value === calls[i + 1]?.fullVisualization?.[1].amount &&
      calls[i + 1]?.fullVisualization?.[1].address &&
      WRAPPEDISH_ADDRESSES[calls[i + 1]?.fullVisualization?.[1].address!]
    ) {
      const newVisualization = calls[i + 1]?.fullVisualization!
      newVisualization[1].address = ZeroAddress
      newCalls.push({
        to: calls[i + 1].to,
        value: calls[i].value + calls[i + 1].value,
        // the wrap data is omitted
        data: calls[i + 1].data,
        fromUserRequestId: calls[i].fromUserRequestId,
        fullVisualization: newVisualization
      })
      i += 1
    } else {
      newCalls.push(calls[i])
    }
  }
  return newCalls
}

export const wrappingModule: HumanizerCallModule = (
  accountOp: AccountOp,
  irCalls: IrCall[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  options?: any
) => {
  const iface = new Interface(getKnownAbi(accountOp.humanizerMeta, 'WETH', options))
  const newCalls = irCalls.map((call: IrCall) => {
    const knownAddressData = accountOp.humanizerMeta?.knownAddresses[call.to.toLowerCase()]
    if (
      knownAddressData?.name === 'Wrapped ETH' ||
      knownAddressData?.name === 'WETH' ||
      knownAddressData?.token?.symbol === 'WETH' ||
      knownAddressData?.name === 'WMATIC' ||
      knownAddressData?.token?.symbol === 'WMATIC'
    ) {
      // 0xd0e30db0
      if (call.data.slice(0, 10) === iface.getFunction('deposit')?.selector) {
        return {
          ...call,
          fullVisualization: getWraping(ZeroAddress, call.value)
        }
      }
      // 0x2e1a7d4d
      if (call.data.slice(0, 10) === iface.getFunction('withdraw')?.selector) {
        const [amount] = iface.parseTransaction(call)?.args || []
        return {
          ...call,
          fullVisualization: getUnwraping(ZeroAddress, amount)
        }
      }
      if (!call?.fullVisualization)
        return {
          ...call,
          fullVisualization: getUnknownVisualization('WETH', call)
        }
    }
    return call
  })
  const parsedCalls = wrapSwapReducer(newCalls)
  return [parsedCalls, []]
}
