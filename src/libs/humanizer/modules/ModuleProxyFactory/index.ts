/* eslint-disable @typescript-eslint/no-unused-vars */
import { Interface } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { ModuleProxyFactory } from '../../const/abis/ModuleProxyFactory'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { getAction, getAddressVisualization } from '../../utils'

const iface = new Interface(ModuleProxyFactory)

const ModuleProxyFactoryModule: HumanizerCallModule = (
  accOp: AccountOp,
  calls: IrCall[]
): IrCall[] => {
  const matcher = {
    [iface.getFunction('deployModule')?.selector!]: (call: IrCall): IrCall | undefined => {
      const { masterCopy } = iface.parseTransaction(call)!.args
      const fullVisualization = [getAction('Deploy module'), getAddressVisualization(masterCopy)]
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

export default ModuleProxyFactoryModule
