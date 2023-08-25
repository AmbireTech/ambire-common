import { ethers } from 'ethers'
import { getAction, getLable, getToken, getOnBehalfOf } from '../../utils'
import { AccountOp } from '../../../accountOp/accountOp'
import { IrCall } from '../../interfaces'

export const aaveLendingPoolV2 = (humanizerInfo: any): { [key: string]: Function } => {
  const iface = new ethers.Interface(humanizerInfo?.['abis:AaveLendingPoolV2'])
  const matcher = {
    [`${iface.getFunction('deposit')?.selector}`]: (accountOp: AccountOp, call: IrCall) => {
      const [asset, amount, onBehalf] = iface.parseTransaction(call)?.args || []
      return [
        getAction('Deposit'),
        getToken(asset, amount),
        getLable('to Aave lending pool'),
        ...getOnBehalfOf(onBehalf, accountOp.accountAddr)
      ]
    },
    [`${iface.getFunction('withdraw')?.selector}`]: (accountOp: AccountOp, call: IrCall) => {
      const [asset, amount, onBehalf] = iface.parseTransaction(call)?.args || []
      return [
        getAction('Withdraw'),
        getToken(asset, amount),
        getLable('from Aave lending pool'),
        ...getOnBehalfOf(onBehalf, accountOp.accountAddr)
      ]
    },
    [`${iface.getFunction('repay')?.selector}`]: (accountOp: AccountOp, call: IrCall) => {
      const [asset, amount /* rateMode */, , onBehalf] = iface.parseTransaction(call)?.args || []
      return [
        getAction('Repay'),
        getToken(asset, amount),
        getLable('to Aave lending pool'),
        ...getOnBehalfOf(onBehalf, accountOp.accountAddr)
      ]
    },
    [`${iface.getFunction('borrow')?.selector}`]: (accountOp: AccountOp, call: IrCall) => {
      const [asset, amount] = iface.parseTransaction(call)?.args || []
      return [getAction('Borrow'), getToken(asset, amount), getLable('from Aave lending pool')]
    }
  }
  return matcher
}
