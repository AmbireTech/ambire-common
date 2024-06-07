import { TypedMessage } from '../../../interfaces/userRequest'
import { HumanizerTypedMessaageModule, HumanizerVisualization } from '../interfaces'
import { getAction, getAddressVisualization, getDeadline, getLabel, getToken } from '../utils'

export const erc20Module: HumanizerTypedMessaageModule = (tm: TypedMessage) => {
  if (tm.types.Permit && tm.primaryType === 'Permit') {
    if (
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
          getToken(tm.domain.verifyingContract!, tm.message.value),
          getLabel('to'),
          getAddressVisualization(tm.message.spender),
          tm.message.deadline ? getDeadline(tm.message.deadline) : null
        ].filter((x) => x) as HumanizerVisualization[]
      }
    }
    // @TODO should we add humanization here?
  }
  if (tm.types.PermitSingle && tm.primaryType === 'PermitSingle') {
    if (
      tm?.message?.spender &&
      tm?.message?.details?.token &&
      tm?.message?.details?.amount &&
      tm?.message?.details?.expiration
    ) {
      return {
        fullVisualization: [
          getLabel('Approve'),
          getAddressVisualization(tm.message.spender),
          getLabel('to use'),
          getToken(tm.message.details.token, BigInt(tm.message.details.amount)),
          getDeadline(tm.message.details.expiration)
        ]
      }
    }
    // @TODO should we add humanization here?
  }
  return { fullVisualization: [] }
}
