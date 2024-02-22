import { ethers } from 'ethers'
import { HumanizerMeta, IrCall } from '../../interfaces'
import { getAction, getOnBehalfOf, getToken, getLabel, getKnownAbi } from '../../utils'
import { AccountOp } from '../../../accountOp/accountOp'

export const aaveWethGatewayV2 = (humanizerInfo: HumanizerMeta): { [key: string]: Function } => {
  const iface = new ethers.Interface(getKnownAbi(humanizerInfo, 'AaveWethGatewayV2'))
  return {
    [iface.getFunction('depositETH')?.selector!]: (accountOp: AccountOp, call: IrCall) => {
      const [, onBehalfOf] = iface.parseTransaction(call)?.args || []
      return [
        getAction('Deposit'),
        getToken(ethers.ZeroAddress, call.value),
        getLabel('to Aave lending pool'),
        ...getOnBehalfOf(onBehalfOf, accountOp.accountAddr)
      ]
    },
    [iface.getFunction('withdrawETH')?.selector!]: (accountOp: AccountOp, call: IrCall) => {
      const [, /* lendingPool */ amount, to] = iface.parseTransaction(call)?.args || []
      return [
        getAction('Withdraw'),
        getToken(ethers.ZeroAddress, amount),
        getLabel('from Aave lending pool'),
        ...getOnBehalfOf(to, accountOp.accountAddr)
      ]
    },
    [iface.getFunction('repayETH')?.selector!]: (accountOp: AccountOp, call: IrCall) => {
      const [, , , /* lendingPool */ /* amount */ /* rateMode */ onBehalfOf] =
        iface.parseTransaction(call)?.args || []
      return [
        getAction('Repay'),
        getToken(ethers.ZeroAddress, call.value),
        getLabel('to Aave lending pool'),
        getOnBehalfOf(onBehalfOf, accountOp.accountAddr)
      ]
    },
    [iface.getFunction('borrowETH')?.selector!]: (accountOp: AccountOp, call: IrCall) => {
      const [, /* lendingPool */ amount] = iface.parseTransaction(call)?.args || []
      return [
        getAction('Borrow '),
        getToken(ethers.ZeroAddress, amount),
        getLabel('from Aave lending pool')
      ]
    }
  }
}
