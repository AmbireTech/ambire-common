import { ethers } from 'ethers'
import { TypedMessage } from '../../../interfaces/userRequest'
import { HumanizerTypedMessaageModule, HumanizerVisualization } from '../interfaces'
import { getAction, getDeadlineText, getAddress, getLabel, getToken } from '../utils'

const visualizePermit = (
  spender: string,
  value: bigint,
  deadline: bigint,
  token: string
): HumanizerVisualization[] => {
  const res = [getAction('Send'), getToken(token, value), getLabel('to'), getAddress(spender)]
  if (getDeadlineText(deadline)) res.push(getDeadlineText(deadline) as HumanizerVisualization)
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
      return visualizePermit(
        ethers.getAddress(tm.message.spender),
        tm.message.value,
        tm.message.deadline,
        ethers.getAddress(tm.domain.verifyingContract as string)
      )
    }
  }
  return []
}
