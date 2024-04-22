import { Interface, ZeroAddress } from 'ethers'

import { AccountOp } from '../../accountOp/accountOp'
import { HumanizerCallModule, HumanizerMeta, IrCall } from '../interfaces'
import { getKnownAbi, getUnknownVisualization, getUnwraping, getWraping } from '../utils'

const wrapSwapReducer = (calls: IrCall[]) => {
  const newCalls: IrCall[] = []
  for (let i = 0; i < calls.length; i++) {
    if (
      // swapping x amount of token for y of WETH and unwrapping y WETH for y ETH
      calls[i]?.fullVisualization?.[0].content?.includes('Swap') &&
      calls[i + 1]?.fullVisualization?.[0].content?.includes('Unwrap') &&
      calls[i + 1]?.fullVisualization?.[1].address &&
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
      calls[i + 1]?.fullVisualization?.[1].address
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
  humanizerMeta: HumanizerMeta,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  options?: any
) => {
  const iface = new Interface(getKnownAbi(humanizerMeta, 'WETH', options))
  const newCalls = irCalls.map((call: IrCall) => {
    const knownAddressData = humanizerMeta?.knownAddresses[call.to.toLowerCase()]
    if (
      knownAddressData?.name === 'Wrapped ETH' ||
      knownAddressData?.name === 'WETH' ||
      knownAddressData?.token?.symbol === 'WETH' ||
      knownAddressData?.name === 'WMATIC' ||
      knownAddressData?.token?.symbol === 'WMATIC' ||
      knownAddressData?.token?.symbol === 'WAVAX'
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
          fullVisualization: getUnknownVisualization('wrapped', call)
        }
    }
    return call
  })
  const parsedCalls = wrapSwapReducer(newCalls)
  return [parsedCalls, []]
}
