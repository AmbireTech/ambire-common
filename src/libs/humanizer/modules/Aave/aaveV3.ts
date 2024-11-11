import { Interface } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { AaveV3Pool } from '../../const/abis'
import { IrCall } from '../../interfaces'
import {
  getAction,
  getAddressVisualization,
  getDeadline,
  getLabel,
  getOnBehalfOf,
  getToken
} from '../../utils'

export const aaveV3Pool = (): { [key: string]: Function } => {
  const iface = new Interface(AaveV3Pool)
  return {
    [iface.getFunction(
      'supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)'
    )?.selector!]: (accountOp: AccountOp, call: IrCall) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { asset, amount, onBehalfOf, referralCode } = iface.parseTransaction(call)!.args
      return [
        getAction('Deposit'),
        getToken(asset, amount),
        getLabel('to'),
        getAddressVisualization(call.to),
        ...getOnBehalfOf(onBehalfOf, accountOp.accountAddr)
      ]
    },
    [iface.getFunction(
      'flashLoanSimple(address receiverAddress, address asset, uint256 amount, bytes params, uint16 referralCode)'
    )?.selector!]: (accountOp: AccountOp, call: IrCall) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { receiverAddress, asset, amount, params, referralCode } =
        iface.parseTransaction(call)!.args

      return [
        getAction('Execute Flash Loan'),
        getToken(asset, amount),
        getLabel('and call'),
        getAddressVisualization(receiverAddress)
      ]
    },
    [iface.getFunction('repayWithATokens(bytes32 args)')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { args } = iface.parseTransaction(call)!.args
      return [getAction('Repay with token A'), getLabel('to'), getAddressVisualization(call.to)]
    },
    [iface.getFunction('repayWithPermit(bytes32 args, bytes32 r, bytes32 s)')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { args } = iface.parseTransaction(call)!.args
      return [getAction('Repay with permit'), getLabel('to'), getAddressVisualization(call.to)]
    },
    [iface.getFunction(
      'supplyWithPermit(address asset, uint256 amount, address onBehalfOf, uint16 referralCode, uint256 deadline, uint8 permitV, bytes32 permitR, bytes32 permitS)'
    )?.selector!]: (accountOp: AccountOp, call: IrCall) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { asset, amount, onBehalfOf, referralCode, deadline, permitV, permitR, bytes32 } =
        iface.parseTransaction(call)!.args
      return [
        getAction('Supply'),
        getToken(asset, amount),
        getLabel('to'),
        getAddressVisualization(call.to),
        ...(onBehalfOf !== accountOp.accountAddr
          ? [getLabel('on behalf of'), getAddressVisualization(onBehalfOf)]
          : []),
        getDeadline(deadline)
      ]
    }
  }
}
