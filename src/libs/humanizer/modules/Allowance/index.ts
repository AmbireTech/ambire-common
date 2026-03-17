/* eslint-disable @typescript-eslint/no-unused-vars */
import { Interface } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { Allowance } from '../../const/abis/Allowance'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { getAction, getAddressVisualization, getLabel, getToken } from '../../utils'

const iface = new Interface(Allowance)

const getTimeString = (resetTimeMin: bigint): string => {
  if (resetTimeMin === 1440n) return 'Daily'
  if (resetTimeMin === 10080n) return 'Weekly'
  if (resetTimeMin === 20160n) return 'Biweekly'
  if (resetTimeMin === 43200n) return 'Monthly'
  return `Every ${resetTimeMin.toString()} minutes`
}

const AllowanceModule: HumanizerCallModule = (accOp: AccountOp, calls: IrCall[]): IrCall[] => {
  const matcher = {
    [iface.getFunction('setAllowance')?.selector!]: (call: IrCall): IrCall | undefined => {
      const { delegate, token, allowanceAmount, resetTimeMin, resetBaseMin } =
        iface.parseTransaction(call)!.args

      const fullVisualization = [
        getAction('Allow'),
        getAddressVisualization(delegate),
        getLabel('to spend'),
        getToken(token, allowanceAmount),
        getLabel(getTimeString(resetTimeMin))
      ]

      return { ...call, fullVisualization }
    },
    [iface.getFunction('addDelegate')?.selector!]: (call: IrCall): IrCall | undefined => {
      const { delegate } = iface.parseTransaction(call)!.args

      const fullVisualization = [getAction('Add delegate'), getAddressVisualization(delegate)]

      return { ...call, fullVisualization }
    },
    [iface.getFunction('removeDelegate')?.selector!]: (call: IrCall): IrCall | undefined => {
      const { delegate, removeAllowances } = iface.parseTransaction(call)!.args

      const fullVisualization = [getAction('Remove delegate'), getAddressVisualization(delegate)]
      if (removeAllowances) fullVisualization.push(getLabel('and set allowance to 0'))

      return { ...call, fullVisualization }
    },
    [iface.getFunction('deleteAllowance')?.selector!]: (call: IrCall): IrCall | undefined => {
      const { delegate, token } = iface.parseTransaction(call)!.args

      const fullVisualization = [
        getAction('Remove allowance for'),
        getAddressVisualization(delegate),
        getToken(token, 0n)
      ]

      return { ...call, fullVisualization }
    },
    [iface.getFunction('executeAllowanceTransfer')?.selector!]: (
      call: IrCall
    ): IrCall | undefined => {
      const { safe, token, to, amount, paymentToken, payment, delegate, signature } =
        iface.parseTransaction(call)!.args

      const fullVisualization = [
        getAction('Execute allowance for'),
        getAddressVisualization(delegate),
        getLabel('for'),
        getToken(token, amount)
      ]

      return { ...call, fullVisualization }
    }
  }
  const newCalls = calls.map((call) => {
    const match = matcher[call.data.slice(0, 10)]
    if (call.fullVisualization || !match) return call
    const newCall = match(call)
    if (!newCall) return call
    return newCall
  })

  return newCalls
}

export default AllowanceModule
