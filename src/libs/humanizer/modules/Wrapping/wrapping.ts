import { Interface, ZeroAddress } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { WETH } from '../../const/abis'
import { HumanizerCallModule, HumanizerMeta, IrCall } from '../../interfaces'
import { getUnwrapping, getWrapping } from '../../utils'

export const wrappingModule: HumanizerCallModule = (
  _: AccountOp,
  irCalls: IrCall[],
  humanizerMeta: HumanizerMeta
) => {
  const iface = new Interface(WETH)
  const newCalls = irCalls.map((call: IrCall) => {
    if (!call.to) return call
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
          fullVisualization: getWrapping(ZeroAddress, call.value)
        }
      }
      // 0x2e1a7d4d
      if (call.data.slice(0, 10) === iface.getFunction('withdraw')?.selector) {
        const [amount] = iface.parseTransaction(call)?.args || []
        return {
          ...call,
          fullVisualization: getUnwrapping(ZeroAddress, amount)
        }
      }
    }
    return call
  })
  return newCalls
}
