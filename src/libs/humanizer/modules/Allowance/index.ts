import { decodeFunctionData, parseAbi, toFunctionSelector } from 'viem'

import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { HexIrCall, getAction, getAddressVisualization, getLabel, getToken, isHexCall } from '../../utils'

const setAllowanceAbi = parseAbi([
  'function setAllowance(address delegate, address token, uint96 allowanceAmount, uint16 resetTimeMin, uint32 resetBaseMin)'
])
const deleteAllowanceAbi = parseAbi(['function deleteAllowance(address delegate, address token)'])
const executeAllowanceTransferAbi = parseAbi([
  'function executeAllowanceTransfer(address safe, address token, address to, uint96 amount, address paymentToken, uint96 payment, address delegate, bytes memory signature)'
])
const addDelegateAbi = parseAbi(['function addDelegate(address delegate)'])
const removeDelegateAbi = parseAbi([
  'function removeDelegate(address delegate, bool removeAllowances)'
])

const getTimeString = (resetTimeMin: bigint): string => {
  if (resetTimeMin === 1440n) return 'Daily'
  if (resetTimeMin === 10080n) return 'Weekly'
  if (resetTimeMin === 20160n) return 'Biweekly'
  if (resetTimeMin === 43200n) return 'Monthly'
  return `Every ${resetTimeMin.toString()} minutes`
}

const AllowanceModule: HumanizerCallModule = (accOp: AccountOp, calls: IrCall[]): IrCall[] => {
  const matcher: Record<string, (call: HexIrCall) => IrCall | undefined> = {
    [toFunctionSelector(setAllowanceAbi[0])]: (call) => {
      const { args } = decodeFunctionData({ abi: setAllowanceAbi, data: call.data })
      const [delegate, token, allowanceAmount, resetTimeMin] = args

      const fullVisualization = [
        getAction('Allow'),
        getAddressVisualization(delegate),
        getLabel('to spend'),
        getToken(token, allowanceAmount),
        getLabel(getTimeString(BigInt(resetTimeMin)))
      ]

      return { ...call, fullVisualization }
    },
    [toFunctionSelector(addDelegateAbi[0])]: (call) => {
      const { args } = decodeFunctionData({ abi: addDelegateAbi, data: call.data })
      const [delegate] = args

      const fullVisualization = [getAction('Add delegate'), getAddressVisualization(delegate)]

      return { ...call, fullVisualization }
    },
    [toFunctionSelector(removeDelegateAbi[0])]: (call) => {
      const { args } = decodeFunctionData({ abi: removeDelegateAbi, data: call.data })
      const [delegate, removeAllowances] = args

      const fullVisualization = [getAction('Remove delegate'), getAddressVisualization(delegate)]
      if (removeAllowances) fullVisualization.push(getLabel('and set allowance to 0'))

      return { ...call, fullVisualization }
    },
    [toFunctionSelector(deleteAllowanceAbi[0])]: (call) => {
      const { args } = decodeFunctionData({ abi: deleteAllowanceAbi, data: call.data })
      const [delegate, token] = args

      const fullVisualization = [
        getAction('Remove allowance for'),
        getAddressVisualization(delegate),
        getToken(token, 0n)
      ]

      return { ...call, fullVisualization }
    },
    [toFunctionSelector(executeAllowanceTransferAbi[0])]: (call) => {
      const { args } = decodeFunctionData({
        abi: executeAllowanceTransferAbi,
        data: call.data
      })
      const [, token, , amount, , , delegate] = args

      const fullVisualization = [
        getAction('Execute allowance for'),
        getAddressVisualization(delegate),
        getLabel('for'),
        getToken(token, amount)
      ]

      return { ...call, fullVisualization }
    }
  }
  const newCalls = calls.map((call) => {
    if (call.fullVisualization || !isHexCall(call)) return call
    const match = matcher[call.data.slice(0, 10)]
    if (!match) return call
    const newCall = match(call)
    if (!newCall) return call
    return newCall
  })

  return newCalls
}

export default AllowanceModule
