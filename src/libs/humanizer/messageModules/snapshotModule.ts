import { Message } from '../../../interfaces/userRequest'
import { HumanizerTypedMessageModule } from '../interfaces'
import { getAction, getDeadline, getLabel } from '../utils'

export const snapshotModule: HumanizerTypedMessageModule = (message: Message) => {
  if (message.content.kind !== 'typedMessage') return { fullVisualization: [] }
  if (
    message.content.domain.name === 'snapshot' &&
    message.content.message.choice &&
    message.content.message.space
  ) {
    return {
      fullVisualization: [
        getAction('Vote'),
        getLabel('in'),
        getLabel('Snapshot:', true),
        getLabel(message.content.message.space, true)
      ]
    }
  }
  return { fullVisualization: [] }
}
