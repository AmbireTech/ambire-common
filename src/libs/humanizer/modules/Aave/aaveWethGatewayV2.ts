import { Interface, ZeroAddress } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerMeta, IrCall } from '../../interfaces'
import { getAction, getKnownAbi, getLabel, getOnBehalfOf, getToken } from '../../utils'

export const aaveWethGatewayV2 = (humanizerInfo: HumanizerMeta): { [key: string]: Function } => {
  const iface = new Interface(getKnownAbi(humanizerInfo, 'AaveWethGatewayV2'))
  return {
    [iface.getFunction('depositETH')?.selector!]: (accountOp: AccountOp, call: IrCall) => {
      const [, onBehalfOf] = iface.parseTransaction(call)?.args || []
      return [
        getAction('Deposit'),
        getToken(ZeroAddress, call.value),
        getLabel('to Aave lending pool'),
        ...getOnBehalfOf(onBehalfOf, accountOp.accountAddr)
      ]
    },
    [iface.getFunction('withdrawETH')?.selector!]: (accountOp: AccountOp, call: IrCall) => {
      const [, /* lendingPool */ amount, to] = iface.parseTransaction(call)?.args || []
      return [
        getAction('Withdraw'),
        getToken(ZeroAddress, amount),
        getLabel('from Aave lending pool'),
        ...getOnBehalfOf(to, accountOp.accountAddr)
      ]
    },
    [iface.getFunction('repayETH')?.selector!]: (accountOp: AccountOp, call: IrCall) => {
      const [, , , /* lendingPool */ /* amount */ /* rateMode */ onBehalfOf] =
        iface.parseTransaction(call)?.args || []
      return [
        getAction('Repay'),
        getToken(ZeroAddress, call.value),
        getLabel('to Aave lending pool'),
        getOnBehalfOf(onBehalfOf, accountOp.accountAddr)
      ]
    },
    [iface.getFunction('borrowETH')?.selector!]: (accountOp: AccountOp, call: IrCall) => {
      const [, /* lendingPool */ amount] = iface.parseTransaction(call)?.args || []
      return [
        getAction('Borrow '),
        getToken(ZeroAddress, amount),
        getLabel('from Aave lending pool')
      ]
    }
  }
}
