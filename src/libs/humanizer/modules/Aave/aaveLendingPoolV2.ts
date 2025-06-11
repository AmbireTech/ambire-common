import { Interface } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { AaveLendingPoolV2 } from '../../const/abis'
import { IrCall } from '../../interfaces'
import { getAction, getAddressVisualization, getLabel, getOnBehalfOf, getToken } from '../../utils'

export const aaveLendingPoolV2 = (): { [key: string]: Function } => {
  const iface = new Interface(AaveLendingPoolV2)
  const matcher = {
    [iface.getFunction('deposit')?.selector!]: (accountOp: AccountOp, call: IrCall) => {
      if (!call.to) throw Error('Humanizer: should not be in aave module when !call.to')
      const [asset, amount, onBehalf] = iface.parseTransaction(call)?.args || []
      return [
        getAction('Deposit'),
        getToken(asset, amount),
        getLabel('to'),
        getAddressVisualization(call.to),
        ...getOnBehalfOf(onBehalf, accountOp.accountAddr)
      ]
    },
    [iface.getFunction('withdraw')?.selector!]: (accountOp: AccountOp, call: IrCall) => {
      if (!call.to) throw Error('Humanizer: should not be in aave module when !call.to')

      const [asset, amount, onBehalf] = iface.parseTransaction(call)?.args || []
      return [
        getAction('Withdraw'),
        getToken(asset, amount),
        getLabel('from'),
        getAddressVisualization(call.to),
        ...getOnBehalfOf(onBehalf, accountOp.accountAddr)
      ]
    },
    [iface.getFunction('repay')?.selector!]: (accountOp: AccountOp, call: IrCall) => {
      if (!call.to) throw Error('Humanizer: should not be in aave module when !call.to')

      const [asset, amount /* rateMode */, , onBehalf] = iface.parseTransaction(call)?.args || []
      return [
        getAction('Repay'),
        getToken(asset, amount),
        getLabel('to'),
        getAddressVisualization(call.to),
        ...getOnBehalfOf(onBehalf, accountOp.accountAddr)
      ]
    },
    [iface.getFunction('borrow')?.selector!]: (accountOp: AccountOp, call: IrCall) => {
      if (!call.to) throw Error('Humanizer: should not be in aave module when !call.to')

      const [asset, amount] = iface.parseTransaction(call)?.args || []
      return [
        getAction('Borrow'),
        getToken(asset, amount),
        getLabel('from'),
        getAddressVisualization(call.to)
      ]
    }
  }
  return matcher
}
