import { decodeFunctionData, toFunctionSelector } from 'viem'

import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, HumanizerVisualization, IrCall } from '../../interfaces'
import { getAction, getBreak, getToken, HexIrCall, isHexCall } from '../../utils'
import {
  blueBundlesV1MigrateBorrowPositionAbi,
  blueBundlesV1RepayAndWithdrawCollateralAbi,
  blueBundlesV1SupplyAbi,
  blueBundlesV1SupplyCollateralAndBorrowAbi,
  blueBundlesV1WithdrawAbi
} from './abi'

const joinActions = (actions: HumanizerVisualization[][]): HumanizerVisualization[] =>
  actions.flatMap((action, index) => (index ? [getBreak(), ...action] : action))

const matcher: Record<string, (call: HexIrCall) => IrCall> = {
  [toFunctionSelector(blueBundlesV1SupplyCollateralAndBorrowAbi[0])]: (call) => {
    const { args } = decodeFunctionData({
      abi: blueBundlesV1SupplyCollateralAndBorrowAbi,
      data: call.data
    })
    const [marketParams, collateralAssets, borrowAssets] = args
    const actions: HumanizerVisualization[][] = []

    if (collateralAssets)
      actions.push([getAction('Supply'), getToken(marketParams.collateralToken, collateralAssets)])
    if (borrowAssets)
      actions.push([getAction('Borrow'), getToken(marketParams.loanToken, borrowAssets)])

    return actions.length ? { ...call, fullVisualization: joinActions(actions) } : call
  },
  [toFunctionSelector(blueBundlesV1RepayAndWithdrawCollateralAbi[0])]: (call) => {
    const { args } = decodeFunctionData({
      abi: blueBundlesV1RepayAndWithdrawCollateralAbi,
      data: call.data
    })
    const [marketParams, repayAssets, repayShares, maxRepayAssets, collateralAssets] = args
    const actions: HumanizerVisualization[][] = []

    if (repayAssets)
      actions.push([getAction('Repay'), getToken(marketParams.loanToken, repayAssets)])
    if (!repayAssets && repayShares)
      actions.push([getAction('Repay up to'), getToken(marketParams.loanToken, maxRepayAssets)])
    if (collateralAssets)
      actions.push([
        getAction('Withdraw'),
        getToken(marketParams.collateralToken, collateralAssets)
      ])

    return actions.length ? { ...call, fullVisualization: joinActions(actions) } : call
  },
  [toFunctionSelector(blueBundlesV1SupplyAbi[0])]: (call) => {
    const { args } = decodeFunctionData({ abi: blueBundlesV1SupplyAbi, data: call.data })
    const [marketParams, assets] = args

    return {
      ...call,
      fullVisualization: [getAction('Supply'), getToken(marketParams.loanToken, assets)]
    }
  },
  [toFunctionSelector(blueBundlesV1WithdrawAbi[0])]: (call) => {
    const { args } = decodeFunctionData({ abi: blueBundlesV1WithdrawAbi, data: call.data })
    const [marketParams, withdrawAssets, withdrawShares] = args
    const fullVisualization = withdrawAssets
      ? [getAction('Withdraw'), getToken(marketParams.loanToken, withdrawAssets)]
      : [getAction(withdrawShares ? 'Withdraw supplied funds' : 'Withdraw')]

    return { ...call, fullVisualization }
  },
  [toFunctionSelector(blueBundlesV1MigrateBorrowPositionAbi[0])]: (call) => {
    decodeFunctionData({ abi: blueBundlesV1MigrateBorrowPositionAbi, data: call.data })

    return { ...call, fullVisualization: [getAction('Move borrowing position')] }
  }
}

const BlueBundlesV1Module: HumanizerCallModule = (_accountOp: AccountOp, call: IrCall): IrCall => {
  if (call.fullVisualization || !isHexCall(call)) return call

  const match = matcher[call.data.slice(0, 10)]
  if (!match) return call

  try {
    return match(call)
  } catch (error) {
    console.error('Failed to decode BlueBundlesV1 calldata', error)
    return call
  }
}

export default BlueBundlesV1Module
