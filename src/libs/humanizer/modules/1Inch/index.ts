import { decodeFunctionData, parseAbi, toFunctionSelector, zeroAddress } from 'viem'

import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import {
  HexIrCall,
  eToNative,
  getAction,
  getLabel,
  getRecipientText,
  getToken,
  isHexCall,
  uintToAddress
} from '../../utils'

const cancelOrderAbi = parseAbi(['function cancelOrder(uint256 makerTraits, bytes32 orderHash)'])
const unoswap2Abi = parseAbi([
  'function unoswap2(uint256 token, uint256 amount, uint256 minReturn, uint256 dex, uint256 dex2)'
])
const swapAbi = parseAbi([
  'function swap(address executor, (address srcToken, address dstToken, address srcReceiver, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 flags) desc, bytes data) payable returns (uint256, uint256)'
])
const ethUnoswapAbi = parseAbi(['function ethUnoswap(uint256, uint256) payable returns (uint256)'])
const unoswapAbi = parseAbi([
  'function unoswap(uint256 token,uint256 amount,uint256 minReturn,uint256 dex) returns (uint256)'
])
const unoswapToAbi = parseAbi([
  'function unoswapTo(uint256 to,uint256 token,uint256 amount,uint256 minReturn,uint256 dex) returns (uint256)'
])
const unoswap3Abi = parseAbi([
  'function unoswap3(uint256 token,uint256 amount,uint256 minReturn,uint256 dex,uint256 dex2,uint256 dex3) returns (uint256)'
])
const swapWithPermitAbi = parseAbi([
  'function swap(address executor, (address srcToken, address dstToken, address srcReceiver, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 flags) desc, bytes permit, bytes data) payable returns (uint256 returnAmount, uint256 spentAmount)'
])

const OneInchModule: HumanizerCallModule = (accOp: AccountOp, call: IrCall) => {
  const matcher: Record<string, (call: HexIrCall) => any> = {
    [toFunctionSelector(cancelOrderAbi[0])]: (call) => {
      const { args } = decodeFunctionData({ abi: cancelOrderAbi, data: call.data })
      const [, orderHash] = args
      return [
        getAction('Cancel order'),
        getLabel(`with order hash ${orderHash.slice(0, 5)}...${orderHash.slice(63, 66)}`)
      ]
    },
    [toFunctionSelector(unoswap2Abi[0])]: (call) => {
      const { args } = decodeFunctionData({ abi: unoswap2Abi, data: call.data })
      const [tokenArg, amount] = args
      const token = uintToAddress(tokenArg)
      return [getAction('Swap'), getToken(eToNative(token), amount)]
    },
    [toFunctionSelector(swapAbi[0])]: (call) => {
      const { args } = decodeFunctionData({ abi: swapAbi, data: call.data })
      const [, desc] = args
      const { srcToken, dstToken, dstReceiver, amount, minReturnAmount } = desc
      return [
        getAction('Swap'),
        getToken(eToNative(srcToken), amount),
        getLabel('for'),
        getToken(eToNative(dstToken), minReturnAmount),
        ...getRecipientText(accOp.accountAddr, dstReceiver)
      ]
    },
    [toFunctionSelector(ethUnoswapAbi[0])]: (call) => {
      return [getAction('Swap'), getToken(zeroAddress, call.value)]
    },
    [toFunctionSelector(unoswapAbi[0])]: (call) => {
      const { args } = decodeFunctionData({ abi: unoswapAbi, data: call.data })
      const [tokenArg, amount] = args
      const token = uintToAddress(tokenArg)
      return [getAction('Swap'), getToken(eToNative(token), amount)]
    },
    [toFunctionSelector(unoswapToAbi[0])]: (call) => {
      const { args } = decodeFunctionData({ abi: unoswapToAbi, data: call.data })
      const [, tokenArg, amount] = args
      const token = uintToAddress(tokenArg)
      return [getAction('Swap'), getToken(eToNative(token), amount)]
    },
    [toFunctionSelector(unoswap3Abi[0])]: (call) => {
      const { args } = decodeFunctionData({ abi: unoswap3Abi, data: call.data })
      const [tokenArg, amount] = args
      const token = uintToAddress(tokenArg)
      return [getAction('Swap'), getToken(eToNative(token), amount)]
    },
    [toFunctionSelector(swapWithPermitAbi[0])]: (call) => {
      const { args } = decodeFunctionData({ abi: swapWithPermitAbi, data: call.data })
      const [, desc] = args
      const { srcToken, dstToken, dstReceiver, amount, minReturnAmount } = desc
      return [
        getAction('Swap'),
        getToken(srcToken, amount),
        getLabel('for'),
        getToken(dstToken, minReturnAmount),
        ...getRecipientText(accOp.accountAddr, dstReceiver)
      ]
    }
  }
  const match = matcher[call.data.slice(0, 10)]
  if (call.fullVisualization || !isHexCall(call) || !match) return call
  return { ...call, fullVisualization: match(call) }
}

export default OneInchModule
