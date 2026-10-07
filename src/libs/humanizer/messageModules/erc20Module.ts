import { MaxUint256 } from 'ethers'

import { Message } from '../../../interfaces/userRequest'
import { HumanizerTypedMessageModule } from '../interfaces'
import { getAction, getAddressVisualization, getDeadline, getLabel, getToken } from '../utils'

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

  // EIP-2612 permit
  if (['owner', 'spender', 'value', 'nonce', 'deadline'].every((i) => i in tm.message)) {
    return {
      fullVisualization: [
        getAction('Grant approval'),
        getLabel('for'),
        getToken(tm.domain.verifyingContract!, tm.message.value),
        getLabel('to'),
        getAddressVisualization(tm.message.spender),
        ...(tm.message.deadline ? [getDeadline(tm.message.deadline)] : [])
      ]
    }
  }

  // DAI-style permit (pre EIP-2612): no `value`, only a boolean `allowed` that
  // grants an unlimited allowance when true and revokes it when false.
  // `expiry` of 0 means the permit never expires
  if (['holder', 'spender', 'nonce', 'expiry', 'allowed'].every((i) => i in tm.message)) {
    const isGranting = Boolean(tm.message.allowed)
    if (!isGranting)
      return {
        fullVisualization: [
          getAction('Revoke approval'),
          getToken(tm.domain.verifyingContract!, 0n),
          getLabel('for'),
          getAddressVisualization(tm.message.spender)
        ]
      }
    return {
      fullVisualization: [
        getAction('Grant approval'),
        getLabel('for'),
        getToken(tm.domain.verifyingContract!, MaxUint256),
        getLabel('to'),
        getAddressVisualization(tm.message.spender),
        ...(tm.message.expiry ? [getDeadline(tm.message.expiry)] : [])
      ]
    }
  }

  return { fullVisualization: [] }
}
