import { decodeFunctionData, parseAbi, toFunctionSelector } from 'viem'

import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { HexIrCall, eToNative, getAction, getLabel, getToken, isHexCall } from '../../utils'

const swapAbi = parseAbi([
  'function swap((address callTarget,address approveTarget,bytes targetData,(address srcToken,address dstToken,address[] srcReceivers,uint256[] srcAmounts,address[] feeReceivers,uint256[] feeAmounts,address dstReceiver,uint256 amount,uint256 minReturnAmount,uint256 flags,bytes permit) desc,bytes clientData) execution) payable returns (uint256,uint256)'
])
const swapSimpleModeAbi = parseAbi([
  'function swapSimpleMode(address caller,(address srcToken,address dstToken,address[] srcReceivers,uint256[] srcAmounts,address[] feeReceivers,uint256[] feeAmounts,address dstReceiver,uint256 amount,uint256 minReturnAmount,uint256 flags,bytes permit) desc,bytes executorData,bytes clientData) returns (uint256,uint256)'
])

const KyberModule: HumanizerCallModule = (accOp: AccountOp, calls: IrCall[]) => {
  const matcher: Record<string, (call: HexIrCall) => any> = {
    [toFunctionSelector(swapAbi[0])]: (call) => {
      const { args } = decodeFunctionData({ abi: swapAbi, data: call.data })
      const [execution] = args
      const { srcToken, dstToken, amount, minReturnAmount } = execution.desc
      return [
        getAction('Swap'),
        getToken(eToNative(srcToken), amount),
        getLabel('for'),
        getToken(eToNative(dstToken), minReturnAmount)
      ]
    },
    [toFunctionSelector(swapSimpleModeAbi[0])]: (call) => {
      const { args } = decodeFunctionData({ abi: swapSimpleModeAbi, data: call.data })
      const [, desc] = args
      const { srcToken, dstToken, amount, minReturnAmount } = desc
      return [
        getAction('Swap'),
        getToken(eToNative(srcToken), amount),
        getLabel('for'),
        getToken(eToNative(dstToken), minReturnAmount)
      ]
    }
  }
  const newCalls = calls.map((call) => {
    if (call.fullVisualization || !isHexCall(call) || !matcher[call.data.slice(0, 10)]) return call
    return { ...call, fullVisualization: matcher[call.data.slice(0, 10)](call) }
  })

  return newCalls
}

export default KyberModule
