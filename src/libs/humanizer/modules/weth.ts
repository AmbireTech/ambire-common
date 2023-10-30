import { ethers } from 'ethers'
import { HumanizerCallModule, IrCall } from '../interfaces'
import { AccountOp } from '../../accountOp/accountOp'
import { getAction, getToken, getUnknownVisualization } from '../utils'

const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'

const wrpaUnwrapParser = (calls: IrCall[]) => {
  const newCalls: IrCall[] = []
  for (let i = 0; i < calls.length; i++) {
    if (
      // swapping x amount of token for y of WETH and unwrapping y WETH for y ETH
      calls[i]?.fullVisualization?.[0].content === 'Swap' &&
      calls[i + 1]?.fullVisualization?.[0].content === 'Unwrap' &&
      calls[i]?.fullVisualization?.[3].address === WETH_ADDRESS &&
      calls[i]?.fullVisualization?.[3].amount === calls[i + 1]?.fullVisualization?.[1]?.amount
    ) {
      const newVisualization = calls[i]?.fullVisualization!
      newVisualization[3].address = ethers.ZeroAddress

      newCalls.push({
        to: calls[i].to,
        value: calls[i].value + calls[i + 1].value,
        // the unwrap call.data is omitted
        data: calls[i].data,
        fullVisualization: newVisualization
      })
      i += 1
    } else if (
      calls[i]?.fullVisualization?.[0].content === 'Wrap' &&
      calls[i + 1]?.fullVisualization?.[0].content === 'Swap' &&
      calls[i].value === calls[i + 1]?.fullVisualization?.[1].amount &&
      calls[i + 1]?.fullVisualization?.[1].address === WETH_ADDRESS
    ) {
      const newVisualization = calls[i + 1]?.fullVisualization!
      newVisualization[1].address = ethers.ZeroAddress
      newCalls.push({
        to: calls[i + 1].to,
        value: calls[i].value + calls[i + 1].value,
        // the wrap data is omitted
        data: calls[i + 1].data,
        fullVisualization: newVisualization
      })
      i += 1
    } else {
      newCalls.push(calls[i])
    }
  }
  return newCalls
}

export const wethHumanizer: HumanizerCallModule = (
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
      accountOp.humanizerMeta?.[`tokens:${call.to}`]?.[0] === 'WETH'
    ) {
      // 0xd0e30db0
      if (call.data.slice(0, 10) === iface.getFunction('deposit')?.selector) {
        return {
          ...call,
          fullVisualization: [getAction('Wrap'), getToken(ethers.ZeroAddress, call.value)]
        }
      }
      // 0x2e1a7d4d
      if (call.data.slice(0, 10) === iface.getFunction('withdraw')?.selector) {
        const [amount] = iface.parseTransaction(call)?.args || []
        return {
          ...call,
          fullVisualization: [getAction('Unwrap'), getToken(ethers.ZeroAddress, amount)]
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
  const parsedCalls = wrpaUnwrapParser(newCalls)
  return [parsedCalls, []]
}
