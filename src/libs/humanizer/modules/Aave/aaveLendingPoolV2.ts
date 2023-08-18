import { ethers } from 'ethers'
import { getAction, getLable, getToken, getOnBehalfOf } from '../../utils'
import { AccountOp } from '../../../accountOp/accountOp'
import { IrCall } from '../../interfaces'

export const aaveLendingPoolV2 = (humanizerInfo: any) => {
  const iface = new ethers.Interface(humanizerInfo?.['abis:AaveLendingPoolV2'])

  const matcher = {
    [`${iface.getFunction('depositETH')?.selector}`]: (accountOp: AccountOp, call: IrCall) => {
      const [, , /* depositETH */ /* lendingPool */ onBehalfOf] =
        iface.parseTransaction(call)?.args || []
      return [
        getAction('Deposit'),
        getToken(ethers.ZeroAddress, call.value),
        getLable('to Aave lending pool'),
        ...getOnBehalfOf(onBehalfOf, accountOp.accountAddr)
      ]
    },
    [`${iface.getFunction('withdrawETH')?.selector}`]: (accountOp: AccountOp, call: IrCall) => {
      const [, /* lendingPool */ amount, to] = iface.parseTransaction(call)?.args || []
      return [
        getAction('Withdraw'),
        getToken(ethers.ZeroAddress, amount),
        getLable('from Aave lending pool'),
        ...getOnBehalfOf(to, accountOp.accountAddr)
      ]
    },
    [`${iface.getFunction('repayETH')?.selector}`]: (accountOp: AccountOp, call: IrCall) => {
      const [, , , , /* repayETH */ /* lendingPool */ /* amount */ /* rateMode */ onBehalfOf] =
        iface.parseTransaction(call)?.args || []
      return [
        getAction('Repay'),
        getToken(ethers.ZeroAddress, call.value),
        getLable('to Aave lending pool'),
        ...getOnBehalfOf(onBehalfOf, accountOp.accountAddr)
      ]
    },
    [`${iface.getFunction('borrowETH')?.selector}`]: (accountOp: AccountOp, call: IrCall) => {
      const [, /* lendingPool */ amount] = iface.parseTransaction(call)?.args || []
      return [
        getAction('Borrow'),
        getToken(ethers.ZeroAddress, amount),
        getLable('from Aave lending pool')
      ]
    }
  }
  return matcher
}
