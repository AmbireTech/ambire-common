import { ethers } from 'ethers'
import { getAction, getLabel, getToken, getOnBehalfOf, getKnownAbi } from '../../utils'
import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerMeta, IrCall } from '../../interfaces'

export const aaveLendingPoolV2 = (humanizerInfo: HumanizerMeta): { [key: string]: Function } => {
  const iface = new ethers.Interface(getKnownAbi(humanizerInfo, 'AaveLendingPoolV2'))
  const matcher = {
    [iface.getFunction('deposit')?.selector!]: (accountOp: AccountOp, call: IrCall) => {
      const [asset, amount, onBehalf] = iface.parseTransaction(call)?.args || []
      return [
        getAction('Deposit'),
        getToken(asset, amount),
        getLabel('to Aave lending pool'),
        ...getOnBehalfOf(onBehalf, accountOp.accountAddr)
      ]
    },
    [iface.getFunction('withdraw')?.selector!]: (accountOp: AccountOp, call: IrCall) => {
      const [asset, amount, onBehalf] = iface.parseTransaction(call)?.args || []
      return [
        getAction('Withdraw'),
        getToken(asset, amount),
        getLabel('from Aave lending pool'),
        ...getOnBehalfOf(onBehalf, accountOp.accountAddr)
      ]
    },
    [iface.getFunction('repay')?.selector!]: (accountOp: AccountOp, call: IrCall) => {
      const [asset, amount /* rateMode */, , onBehalf] = iface.parseTransaction(call)?.args || []
      return [
        getAction('Repay'),
        getToken(asset, amount),
        getLabel('to Aave lending pool'),
        ...getOnBehalfOf(onBehalf, accountOp.accountAddr)
      ]
    },
    [iface.getFunction('borrow')?.selector!]: (accountOp: AccountOp, call: IrCall) => {
      const [asset, amount] = iface.parseTransaction(call)?.args || []
      return [getAction('Borrow'), getToken(asset, amount), getLabel('from Aave lending pool')]
    }
  }
  return matcher
}
