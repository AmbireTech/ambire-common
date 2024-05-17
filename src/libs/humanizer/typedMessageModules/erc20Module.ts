import { TypedMessage } from '../../../interfaces/userRequest'
import { HumanizerTypedMessaageModule, HumanizerVisualization } from '../interfaces'
import { getAction, getAddressVisualization, getDeadline, getLabel, getToken } from '../utils'

export const erc20Module: HumanizerTypedMessaageModule = (tm: TypedMessage) => {
  if (tm.params.types.Permit && tm.params.primaryType === 'Permit') {
    if (
      tm.params.message.owner &&
      tm.params.message.spender &&
      tm.params.message.value &&
      tm.params.message.nonce &&
      tm.params.message.deadline &&
      tm.params.domain.verifyingContract
    ) {
      return {
        fullVisualization: [
          getAction('Send'),
          getToken(tm.params.domain.verifyingContract!, tm.params.message.value),
          getLabel('to'),
          getAddressVisualization(tm.params.message.spender),
          tm.params.message.deadline ? getDeadline(tm.params.message.deadline) : null
        ].filter((x) => x) as HumanizerVisualization[]
      }
    }
    // @TODO should we add humanization here?
  }
  if (tm.params.types.PermitSingle && tm.params.primaryType === 'PermitSingle') {
    if (
      tm?.params?.message?.spender &&
      tm?.params?.message?.details?.token &&
      tm?.params?.message?.details?.amount &&
      tm?.params?.message?.details?.expiration
    ) {
      return {
        fullVisualization: [
          getLabel('Approve'),
          getAddressVisualization(tm.params.message.spender),
          getLabel('to use'),
          getToken(tm.params.message.details.token, BigInt(tm.params.message.details.amount)),
          getDeadline(tm.params.message.details.expiration)
        ]
      }
    }
    // @TODO should we add humanization here?
  }
  return { fullVisualization: [] }
}
