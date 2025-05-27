import { Message } from '../../../interfaces/userRequest'
import { HumanizerTypedMessageModule, HumanizerVisualization } from '../interfaces'
import { getAction, getAddressVisualization, getDeadline, getLabel, getToken } from '../utils'

export const erc20Module: HumanizerTypedMessageModule = (message: Message) => {
  if (message.content.kind !== 'typedMessage') return { fullVisualization: [] }
  const tm = message.content
  if (
    tm.types.Permit &&
    tm.primaryType === 'Permit' &&
    tm.message &&
    ['owner', 'spender', 'value', 'nonce', 'deadline'].every((i) => i in tm.message) &&
    tm.domain.verifyingContract
  ) {
    return {
      fullVisualization: [
        getAction('Grant approval'),
        getLabel('for'),
        getToken(tm.domain.verifyingContract!, tm.message.value),
        getLabel('to'),
        getAddressVisualization(tm.message.spender),
        tm.message.deadline ? getDeadline(tm.message.deadline) : null
      ].filter((x) => x) as HumanizerVisualization[]
    }
  }
  return { fullVisualization: [] }
}
