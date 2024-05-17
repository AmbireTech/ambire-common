import { TypedMessage } from '../../../interfaces/userRequest'
import { HumanizerTypedMessaageModule, HumanizerVisualization } from '../interfaces'
import { getAction, getAddressVisualization, getDeadline, getLabel, getNft } from '../utils'

const visualizePermit = (
  spender: string,
  tokenId: bigint,
  deadline: bigint,
  contract: string
): HumanizerVisualization[] => {
  const res = [
    getAction('Permit use of'),
    getNft(contract, tokenId),
    getLabel('to'),
    getAddressVisualization(spender)
  ]
  if (getDeadline(deadline)) res.push(getDeadline(deadline) as HumanizerVisualization)
  return res
}
export const erc721Module: HumanizerTypedMessaageModule = (tm: TypedMessage) => {
  if (tm.params.types.Permit && tm.params.primaryType === 'Permit') {
    if (
      tm.params.message.spender &&
      tm.params.message.tokenId &&
      tm.params.message.nonce &&
      tm.params.message.deadline
    ) {
      return {
        fullVisualization: visualizePermit(
          tm.params.message.spender,
          tm.params.message.tokenId,
          tm.params.message.deadline,
          tm.params.domain.verifyingContract as string
        )
      }
    }
  }
  return { fullVisualization: [] }
}
