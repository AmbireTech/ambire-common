import { decodeFunctionData, parseAbi, toFunctionSelector, zeroAddress } from 'viem'

import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerVisualization } from '../../interfaces'
import {
  HexIrCall,
  getAction,
  getAddressVisualization,
  getLabel,
  getOnBehalfOf,
  getToken
} from '../../utils'

const depositETHAbi = parseAbi([
  'function depositETH(address lendingPool, address onBehalfOf, uint16 referralCode) payable'
])
const withdrawETHAbi = parseAbi([
  'function withdrawETH(address lendingPool, uint256 amount, address to)'
])
const repayETHAbi = parseAbi([
  'function repayETH(address lendingPool, uint256 amount, uint256 rateMode, address onBehalfOf) payable'
])
const borrowETHAbi = parseAbi([
  'function borrowETH(address lendingPool, uint256 amount, uint256 interesRateMode, uint16 referralCode)'
])

export const aaveWethGatewayV2 = (): {
  [key: string]: (a: AccountOp, c: HexIrCall) => HumanizerVisualization[]
} => {
  return {
    [toFunctionSelector(depositETHAbi[0])]: (accountOp: AccountOp, call: HexIrCall) => {
      if (!call.to) throw Error('Humanizer: should not be in aave module when !call.to')
      const { args } = decodeFunctionData({ abi: depositETHAbi, data: call.data })
      const [, onBehalfOf] = args
      return [
        getAction('Deposit'),
        getToken(zeroAddress, call.value),
        getLabel('to'),
        getAddressVisualization(call.to),
        ...getOnBehalfOf(onBehalfOf, accountOp.accountAddr)
      ]
    },
    [toFunctionSelector(withdrawETHAbi[0])]: (accountOp: AccountOp, call: HexIrCall) => {
      if (!call.to) throw Error('Humanizer: should not be in aave module when !call.to')
      const { args } = decodeFunctionData({ abi: withdrawETHAbi, data: call.data })
      const [, /* lendingPool */ amount, to] = args
      return [
        getAction('Withdraw'),
        getToken(zeroAddress, amount),
        getLabel('from'),
        getAddressVisualization(call.to),
        ...getOnBehalfOf(to, accountOp.accountAddr)
      ]
    },
    [toFunctionSelector(repayETHAbi[0])]: (accountOp: AccountOp, call: HexIrCall) => {
      if (!call.to) throw Error('Humanizer: should not be in aave module when !call.to')
      const { args } = decodeFunctionData({ abi: repayETHAbi, data: call.data })
      const [, , , /* lendingPool */ /* amount */ /* rateMode */ onBehalfOf] = args
      return [
        getAction('Repay'),
        getToken(zeroAddress, call.value),
        getLabel('to'),
        getAddressVisualization(call.to),
        ...getOnBehalfOf(onBehalfOf, accountOp.accountAddr)
      ]
    },
    [toFunctionSelector(borrowETHAbi[0])]: (accountOp: AccountOp, call: HexIrCall) => {
      if (!call.to) throw Error('Humanizer: should not be in aave module when !call.to')
      const { args } = decodeFunctionData({ abi: borrowETHAbi, data: call.data })
      const [, /* lendingPool */ amount] = args
      return [
        getAction('Borrow'),
        getToken(zeroAddress, amount),
        getLabel('from'),
        getAddressVisualization(call.to)
      ]
    }
  }
}
