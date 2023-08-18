import { ethers } from 'ethers'
import { IrCall } from '../../interfaces'
import { getAction, getOnBehalfOf, getToken, getLable } from '../../utils'
import { AccountOp } from '../../../accountOp/accountOp'

export const aaveWethGatewayV2 = (humanizerInfo: any) => {
  const iface = new ethers.Interface(humanizerInfo?.['abis:aaveWethGatewayV2'])
  return {
    [`${iface.getFunction('depositETH')}`]: (accountOp: AccountOp, call: IrCall) => {
      const [, , /* depositETH */ /* lendingPool */ onBehalfOf] =
        iface.parseTransaction(call)?.args || []
      return [
        getAction('Deposit'),
        getToken(ethers.ZeroAddress, call.value),
        getLable('to Aave lending pool'),
        ...getOnBehalfOf(onBehalfOf, accountOp.accountAddr)
      ]
    },
    [`${iface.getFunction('withdrawETH')}`]: (accountOp: AccountOp, call: IrCall) => {
      const [, /* lendingPool */ amount, to] = iface.parseTransaction(call)?.args || []
      return [
        getAction('Withdraw'),
        getToken(ethers.ZeroAddress, amount),
        getLable('from Aave lending pool'),
        ...getOnBehalfOf(to, accountOp.accountAddr)
      ]
    },
    [`${iface.getFunction('repayETH')}`]: (accountOp: AccountOp, call: IrCall) => {
      const [, , , , /* repayETH */ /* lendingPool */ /* amount */ /* rateMode */ onBehalfOf] =
        iface.parseTransaction(call)?.args || []
      return [
        getAction('Repay'),
        getToken(ethers.ZeroAddress, call.value),
        getLable('to Aave lending pool'),
        getOnBehalfOf(onBehalfOf, accountOp.accountAddr)
      ]
    },
    [`${iface.getFunction('borrowETH')}`]: (accountOp: AccountOp, call: IrCall) => {
      const [, /* lendingPool */ amount] = iface.parseTransaction(call)?.args || []
      return [
        getAction('Borrow '),
        getToken(ethers.ZeroAddress, amount),
        getLable('from Aave lending pool')
      ]
    }
  }
}
