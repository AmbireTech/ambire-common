import { Message } from '../../../interfaces/userRequest'
import { HumanizerTypedMessageModule, HumanizerVisualization } from '../interfaces'
import { getAction, getAddressVisualization, getDeadline, getLabel, getToken } from '../utils'

export const erc20Module: HumanizerTypedMessageModule = (message: Message) => {
  if (message.content.kind !== 'typedMessage') return { fullVisualization: [] }
  const tm = message.content
  if (
    tm.types.Permit &&
    tm.primaryType === 'Permit' &&
    tm.message.owner &&
    tm.message.spender &&
    tm.message.value &&
    tm.message.nonce &&
    tm.message.deadline &&
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
  if (
    tm.types.PermitSingle &&
    tm.primaryType === 'PermitSingle' &&
    tm?.message?.spender &&
    tm?.message?.details?.token &&
    tm?.message?.details?.amount &&
    tm?.message?.details?.expiration
  ) {
    return {
      fullVisualization: [
        getAction('Approve'),
        getAddressVisualization(tm.message.spender),
        getLabel('to use'),
        getToken(tm.message.details.token, BigInt(tm.message.details.amount)),
        getDeadline(tm.message.details.expiration)
      ]
    }
  }
  return { fullVisualization: [] }
}
