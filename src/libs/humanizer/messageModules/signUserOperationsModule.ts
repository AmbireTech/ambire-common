import { Message } from '../../../interfaces/userRequest'
import { HumanizerTypedMessageModule } from '../interfaces'

export const signUserOperationsModule: HumanizerTypedMessageModule = (message: Message) => {
  if (message.content.kind !== 'signUserOperations') return { fullVisualization: [] }

  //   const fullVisualization = []

  //   for (let i = 0; i < message.content.chainIdWithUserOps.length; i++) {
  //     const userOp = message.content.chainIdWithUserOps[i].userOperation
  //     fullVisualization.push(getAction('Sender'))
  //     fullVisualization.push(getAddressVisualization(userOp.sender))
  //   }

  //   const fullVisualization = [getLabel('Signing user operations')]

  return {
    fullVisualization: []
  }
}
