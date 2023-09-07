import { ethers } from 'ethers'
import { HumanizerCallModule, HumanizerVisualization, IrCall } from '../interfaces'
import { AccountOp } from '../../accountOp/accountOp'
import { getAction, getLabel, getToken, getAddress } from '../utils'

// const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'

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
          fullVisualization: [
            getAction('Unknown action (WETH)'),
            getLabel('to'),
            getAddress(call.to)
          ] as HumanizerVisualization[]
        }
    }
    return call
  })
  return [newCalls, []]
}
