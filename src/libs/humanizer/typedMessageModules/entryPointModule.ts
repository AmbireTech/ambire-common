import { Message } from '../../../interfaces/userRequest'
import { ENTRY_POINT_AUTHORIZATION_REQUEST_ID } from '../../userOperation/userOperation'
import { HumanizerTypedMessageModule } from '../interfaces'
import { getAction } from '../utils'

export const entryPointModule: HumanizerTypedMessageModule = (message: Message) => {
  if (message.content.kind !== 'typedMessage') return { fullVisualization: [] }

  if (message.fromActionId === ENTRY_POINT_AUTHORIZATION_REQUEST_ID)
    return { fullVisualization: [getAction('Authorize entry point')] }
  return { fullVisualization: [] }
}
