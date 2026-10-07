import {
  decodeFunctionData,
  getAddress,
  isAddress,
  parseAbi,
  toFunctionSelector,
  zeroAddress
} from 'viem'

import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, HumanizerMeta, IrCall } from '../../interfaces'
import { getUnwrapping, getWrapping, isHexCall } from '../../utils'

const depositAbi = parseAbi(['function deposit() payable'])
const withdrawAbi = parseAbi(['function withdraw(uint256 wad)'])

const depositSelector = toFunctionSelector(depositAbi[0])
const withdrawSelector = toFunctionSelector(withdrawAbi[0])

export const wrappingModule: HumanizerCallModule = (
  _: AccountOp,
  call: IrCall,
  humanizerMeta?: HumanizerMeta
) => {
  if (!call.to || !isAddress(call.to)) return call
  const knownAddressData = humanizerMeta?.knownAddresses[getAddress(call.to)]
  if (
    knownAddressData?.name === 'Wrapped ETH' ||
    knownAddressData?.name === 'WETH' ||
    knownAddressData?.token?.symbol === 'WETH' ||
    knownAddressData?.name === 'WMATIC' ||
    knownAddressData?.token?.symbol === 'WMATIC' ||
    knownAddressData?.token?.symbol === 'WAVAX'
  ) {
    // 0xd0e30db0
    if (isHexCall(call) && call.data.slice(0, 10) === depositSelector) {
      return {
        ...call,
        fullVisualization: getWrapping(zeroAddress, call.value)
      }
    }
    // 0x2e1a7d4d
    if (isHexCall(call) && call.data.slice(0, 10) === withdrawSelector) {
      const { args } = decodeFunctionData({ abi: withdrawAbi, data: call.data })
      const [amount] = args
      return {
        ...call,
        fullVisualization: getUnwrapping(zeroAddress, amount)
      }
    }
  }
  return call
}
