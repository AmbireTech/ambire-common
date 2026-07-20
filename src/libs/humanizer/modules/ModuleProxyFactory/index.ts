import { decodeFunctionData, parseAbi, toFunctionSelector } from 'viem'

import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { HexIrCall, getAction, getAddressVisualization, isHexCall } from '../../utils'

const deployModuleAbi = parseAbi([
  'function deployModule(address masterCopy, bytes memory initializer, uint256 saltNonce)'
])

const ModuleProxyFactoryModule: HumanizerCallModule = (accOp: AccountOp, call: IrCall): IrCall => {
  const matcher: Record<string, (call: HexIrCall) => IrCall | undefined> = {
    [toFunctionSelector(deployModuleAbi[0])]: (call) => {
      const { args } = decodeFunctionData({ abi: deployModuleAbi, data: call.data })
      const [masterCopy] = args
      const fullVisualization = [getAction('Deploy module'), getAddressVisualization(masterCopy)]
      return { ...call, fullVisualization }
    }
  }
  if (call.fullVisualization || !isHexCall(call)) return call
  const match = matcher[call.data.slice(0, 10)]
  if (!match) return call
  const newCall = match(call)
  if (!newCall) return call
  return newCall
}

export default ModuleProxyFactoryModule
