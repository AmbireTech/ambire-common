import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { getAction, getLegacyVisualization } from '../../utils'

export const deploymentModule: HumanizerCallModule = (
  _: AccountOp,
  call: IrCall
  // humanizerMeta: HumanizerMeta
) =>
  call.to === undefined
    ? {
        ...call,
        fullVisualization: getLegacyVisualization([getAction('Deploy a smart contract')])
      }
    : call
