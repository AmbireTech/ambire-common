import { Interface } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { Bundler3 } from '../../const/abis/Bundler3'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { decodeGeneralAdapter } from './generalAdapter'

const iface = new Interface(Bundler3)

const Bundler3Module: HumanizerCallModule = (accOp: AccountOp, calls: IrCall[]): IrCall[] => {
  const matcher = {
    [iface.getFunction('multicall')?.selector!]: (call: IrCall): IrCall | undefined => {
      if (!call.to) return
      if (call.value) return
      const { bundle } = iface.parseTransaction(call)!.args
      const decodedBundle = decodeGeneralAdapter(accOp.accountAddr, bundle)
      const bundleVisualization = decodedBundle.map((c) => c.fullVisualization || []).flat()
      if (bundleVisualization.length) bundleVisualization.shift()
      return {
        ...call,
        fullVisualization: bundleVisualization.length ? bundleVisualization : undefined
      }
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

export default Bundler3Module
