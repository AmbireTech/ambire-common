import { Interface, ZeroAddress } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { KyberSwap } from '../../const/abis'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { getAction, getLabel, getToken } from '../../utils'

const parseAddressKyber = (address: string) =>
  address.slice(2).toLocaleLowerCase() === 'e'.repeat(40) ? ZeroAddress : address

const KyberModule: HumanizerCallModule = (accOp: AccountOp, calls: IrCall[]) => {
  const iface = new Interface(KyberSwap)

  const matcher = {
    [iface.getFunction(
      'swap(tuple(address callTarget,address approveTarget,bytes targetData,tuple(address srcToken,address dstToken,address[] srcReceivers,uint256[] srcAmounts,address[] feeReceivers,uint256[] feeAmounts,address dstReceiver,uint256 amount,uint256 minReturnAmount,uint256 flags,bytes permit) desc,bytes clientData) execution)'
    )?.selector!]: (call: IrCall) => {
      const {
        execution: {
          desc: { srcToken, dstToken, amount, minReturnAmount }
        }
      } = iface.parseTransaction(call)!.args
      return [
        getAction('Swap'),
        getToken(parseAddressKyber(srcToken), amount),
        getLabel('for'),
        getToken(parseAddressKyber(dstToken), minReturnAmount)
      ]
    }
  }
  const newCalls = calls.map((call) => {
    if (call.fullVisualization || !matcher[call.data.slice(0, 10)]) return call
    return { ...call, fullVisualization: matcher[call.data.slice(0, 10)](call) }
  })

  return [newCalls, []]
}

export default KyberModule
