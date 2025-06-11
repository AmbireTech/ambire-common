import { Interface, ZeroAddress } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { AaveWethGatewayV2 } from '../../const/abis'
import { IrCall } from '../../interfaces'
import { getAction, getAddressVisualization, getLabel, getOnBehalfOf, getToken } from '../../utils'

export const aaveWethGatewayV2 = (): { [key: string]: Function } => {
  const iface = new Interface(AaveWethGatewayV2)
  return {
    [iface.getFunction('depositETH')?.selector!]: (accountOp: AccountOp, call: IrCall) => {
      if (!call.to) throw Error('Humanizer: should not be in aave module when !call.to')
      const [, onBehalfOf] = iface.parseTransaction(call)?.args || []
      return [
        getAction('Deposit'),
        getToken(ZeroAddress, call.value),
        getLabel('to'),
        getAddressVisualization(call.to),
        ...getOnBehalfOf(onBehalfOf, accountOp.accountAddr)
      ]
    },
    [iface.getFunction('withdrawETH')?.selector!]: (accountOp: AccountOp, call: IrCall) => {
      if (!call.to) throw Error('Humanizer: should not be in aave module when !call.to')
      const [, /* lendingPool */ amount, to] = iface.parseTransaction(call)?.args || []
      return [
        getAction('Withdraw'),
        getToken(ZeroAddress, amount),
        getLabel('from'),
        getAddressVisualization(call.to),
        ...getOnBehalfOf(to, accountOp.accountAddr)
      ]
    },
    [iface.getFunction('repayETH')?.selector!]: (accountOp: AccountOp, call: IrCall) => {
      if (!call.to) throw Error('Humanizer: should not be in aave module when !call.to')
      const [, , , /* lendingPool */ /* amount */ /* rateMode */ onBehalfOf] =
        iface.parseTransaction(call)?.args || []
      return [
        getAction('Repay'),
        getToken(ZeroAddress, call.value),
        getLabel('to'),
        getAddressVisualization(call.to),
        getOnBehalfOf(onBehalfOf, accountOp.accountAddr)
      ]
    },
    [iface.getFunction('borrowETH')?.selector!]: (accountOp: AccountOp, call: IrCall) => {
      if (!call.to) throw Error('Humanizer: should not be in aave module when !call.to')
      const [, /* lendingPool */ amount] = iface.parseTransaction(call)?.args || []
      return [
        getAction('Borrow'),
        getToken(ZeroAddress, amount),
        getLabel('from'),
        getAddressVisualization(call.to)
      ]
    }
  }
}
