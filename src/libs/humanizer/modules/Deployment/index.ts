import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { getAction } from '../../utils'

export const deploymentModule: HumanizerCallModule = (
  _: AccountOp,
  irCalls: IrCall[]
  // humanizerMeta: HumanizerMeta
) => {
  const newCalls = irCalls.map((irCall) =>
    irCall.to === undefined
      ? {
          ...irCall,
          fullVisualization: [getAction('Deploy a smart contract')]
        }
      : irCall
  )
  return newCalls
}
