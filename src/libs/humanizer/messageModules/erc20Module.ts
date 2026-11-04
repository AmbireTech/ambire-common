import { MaxUint256 } from 'ethers'

import { Message } from '../../../interfaces/userRequest'
import { HumanizerTypedMessageModule } from '../interfaces'
import {
  getAction,
  getAddressVisualization,
  getDeadline,
  getLabel,
  getSignedMessage,
  getToken
} from '../utils'

export const erc20Module: HumanizerTypedMessageModule = (message: Message) => {
  if (message.content.kind !== 'typedMessage') return { fullVisualization: [] }
  const tm = message.content
  if (
    tm.primaryType !== 'Permit' ||
    !tm.types.Permit ||
    !tm.message ||
    !tm.domain.verifyingContract
  )
    return { fullVisualization: [] }

  // Only the fields declared in the signed type are shown, because any other key in
  // the message is not covered by the signature
  const signedMessage = getSignedMessage(tm.types, tm.primaryType, tm.message)

  // EIP-2612 permit
  if (['owner', 'spender', 'value', 'nonce', 'deadline'].every((i) => i in signedMessage)) {
    return {
      fullVisualization: [
        getAction('Grant approval'),
        getLabel('for'),
        getToken(tm.domain.verifyingContract!, signedMessage.value),
        getLabel('to'),
        getAddressVisualization(signedMessage.spender),
        ...(signedMessage.deadline ? [getDeadline(signedMessage.deadline)] : [])
      ]
    }
  }

  // DAI-style permit (pre EIP-2612): no `value`, only a boolean `allowed` that
  // grants an unlimited allowance when true and revokes it when false.
  // `expiry` of 0 means the permit never expires
  if (['holder', 'spender', 'nonce', 'expiry', 'allowed'].every((i) => i in signedMessage)) {
    const isGranting = Boolean(signedMessage.allowed)
    if (!isGranting)
      return {
        fullVisualization: [
          getAction('Revoke approval'),
          getToken(tm.domain.verifyingContract!, 0n),
          getLabel('for'),
          getAddressVisualization(signedMessage.spender)
        ]
      }
    return {
      fullVisualization: [
        getAction('Grant approval'),
        getLabel('for'),
        getToken(tm.domain.verifyingContract!, MaxUint256),
        getLabel('to'),
        getAddressVisualization(signedMessage.spender),
        ...(signedMessage.expiry ? [getDeadline(signedMessage.expiry)] : [])
      ]
    }
  }

  return { fullVisualization: [] }
}
