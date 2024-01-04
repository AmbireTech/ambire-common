import { ethers } from 'ethers'
import { HumanizerCallModule, IrCall } from '../interfaces'
import { AccountOp } from '../../accountOp/accountOp'
import { getUnknownVisualization, getUnwraping, getWraping } from '../utils'

const WRAPPEDISH_ADDRESSES: { [kjey: string]: string } = {
  [ethers.ZeroAddress]: 'native',
  '0x4200000000000000000000000000000000000042': 'OP',
  '0x4200000000000000000000000000000000000006': 'WETHOptimism',
  '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2': 'WETH',
  '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619': 'WETHPolygon',
  '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270': 'WMATIC'
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
      newVisualization[3].address = ethers.ZeroAddress

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
      newVisualization[1].address = ethers.ZeroAddress
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
  const iface = new ethers.Interface(accountOp.humanizerMeta?.['abis:WETH'])
  const newCalls = irCalls.map((call: IrCall) => {
    if (
      accountOp.humanizerMeta?.[`names:${call.to}`] === 'Wrapped ETH' ||
      accountOp.humanizerMeta?.[`names:${call.to}`] === 'WETH' ||
      accountOp.humanizerMeta?.[`tokens:${call.to}`]?.[0] === 'WETH' ||
      accountOp.humanizerMeta?.[`names:${call.to}`] === 'WMATIC' ||
      accountOp.humanizerMeta?.[`tokens:${call.to}`]?.[0] === 'WMATIC'
    ) {
      // 0xd0e30db0
      if (call.data.slice(0, 10) === iface.getFunction('deposit')?.selector) {
        return {
          ...call,
          fullVisualization: getWraping(ethers.ZeroAddress, call.value)
        }
      }
      // 0x2e1a7d4d
      if (call.data.slice(0, 10) === iface.getFunction('withdraw')?.selector) {
        const [amount] = iface.parseTransaction(call)?.args || []
        return {
          ...call,
          fullVisualization: getUnwraping(ethers.ZeroAddress, amount)
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
