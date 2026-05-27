import { decodeFunctionData, parseAbi, toFunctionSelector } from 'viem'

import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerVisualization } from '../../interfaces'
import { HexIrCall, getAction, getAddressVisualization, getLabel, getOnBehalfOf, getToken } from '../../utils'

const depositAbi = parseAbi([
  'function deposit(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)'
])
const withdrawAbi = parseAbi([
  'function withdraw(address asset, uint256 amount, address to) returns (uint256)'
])
const repayAbi = parseAbi([
  'function repay(address asset, uint256 amount, uint256 rateMode, address onBehalfOf) returns (uint256)'
])
const borrowAbi = parseAbi([
  'function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)'
])

export const aaveLendingPoolV2 = (): { [key: string]: (a: AccountOp, c: HexIrCall) => HumanizerVisualization[] } => {
  const matcher = {
    [toFunctionSelector(depositAbi[0])]: (accountOp: AccountOp, call: HexIrCall) => {
      if (!call.to) throw Error('Humanizer: should not be in aave module when !call.to')
      const { args } = decodeFunctionData({ abi: depositAbi, data: call.data })
      const [asset, amount, onBehalf] = args
      return [
        getAction('Deposit'),
        getToken(asset, amount),
        getLabel('to'),
        getAddressVisualization(call.to),
        ...getOnBehalfOf(onBehalf, accountOp.accountAddr)
      ]
    },
    [toFunctionSelector(withdrawAbi[0])]: (accountOp: AccountOp, call: HexIrCall) => {
      if (!call.to) throw Error('Humanizer: should not be in aave module when !call.to')

      const { args } = decodeFunctionData({ abi: withdrawAbi, data: call.data })
      const [asset, amount, onBehalf] = args
      return [
        getAction('Withdraw'),
        getToken(asset, amount),
        getLabel('from'),
        getAddressVisualization(call.to),
        ...getOnBehalfOf(onBehalf, accountOp.accountAddr)
      ]
    },
    [toFunctionSelector(repayAbi[0])]: (accountOp: AccountOp, call: HexIrCall) => {
      if (!call.to) throw Error('Humanizer: should not be in aave module when !call.to')

      const { args } = decodeFunctionData({ abi: repayAbi, data: call.data })
      const [asset, amount /* rateMode */, , onBehalf] = args
      return [
        getAction('Repay'),
        getToken(asset, amount),
        getLabel('to'),
        getAddressVisualization(call.to),
        ...getOnBehalfOf(onBehalf, accountOp.accountAddr)
      ]
    },
    [toFunctionSelector(borrowAbi[0])]: (accountOp: AccountOp, call: HexIrCall) => {
      if (!call.to) throw Error('Humanizer: should not be in aave module when !call.to')

      const { args } = decodeFunctionData({ abi: borrowAbi, data: call.data })
      const [asset, amount] = args
      return [
        getAction('Borrow'),
        getToken(asset, amount),
        getLabel('from'),
        getAddressVisualization(call.to)
      ]
    }
  }
  return matcher
}
