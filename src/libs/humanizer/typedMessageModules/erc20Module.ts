import { TypedMessage } from '../../../interfaces/userRequest'
import { HumanizerTypedMessaageModule, HumanizerVisualization } from '../interfaces'
import { getAction, getDeadline, getAddressVisualization, getLabel, getToken } from '../utils'

const visualizePermit = (
  spender: string,
  value: bigint,
  deadline: bigint,
  token: string
): HumanizerVisualization[] => {
  const res = [
    getAction('Send'),
    getToken(token, value),
    getLabel('to'),
    getAddressVisualization(spender)
  ]
  if (getDeadline(deadline)) res.push(getDeadline(deadline) as HumanizerVisualization)
  return res
}

export const erc20Module: HumanizerTypedMessaageModule = (tm: TypedMessage) => {
  if (tm.types.Permit && tm.primaryType === 'Permit') {
    if (
      tm.message.owner &&
      tm.message.spender &&
      tm.message.value &&
      tm.message.nonce &&
      tm.message.deadline
    ) {
      return {
        fullVisualization: visualizePermit(
          tm.message.spender,
          tm.message.value,
          tm.message.deadline,
          tm.domain.verifyingContract as string
        )
      }
    }
  }
  return { fullVisualization: [] }
}
