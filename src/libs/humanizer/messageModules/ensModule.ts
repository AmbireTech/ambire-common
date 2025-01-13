import { Message } from '../../../interfaces/userRequest'
import { HumanizerTypedMessageModule } from '../interfaces'
import { getAction, getDeadline, getLabel } from '../utils'

export const ensMessageModule: HumanizerTypedMessageModule = (message: Message) => {
  if (message.content.kind !== 'typedMessage') return { fullVisualization: [] }
  if (message.content.domain.name === 'Ethereum Name Service') {
    if (
      message.content.message.upload === 'avatar' &&
      message.content.message.name &&
      message.content.message.expiry
    )
      return {
        fullVisualization: [
          getAction('Update'),
          getLabel('ENS profile pic of'),
          getLabel(message.content.message.name),
          getDeadline(BigInt(message.content.message.expiry) / 1000n)
        ]
      }
  }
  return { fullVisualization: [] }
}
