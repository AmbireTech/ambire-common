import { Message } from '../../../interfaces/userRequest'
import { HumanizerTypedMessageModule, HumanizerVisualization } from '../interfaces'
import { getAction, getAddressVisualization, getDeadline, getLabel, getToken } from '../utils'

const visualizePermit = (
  spender: string,
  tokenId: bigint,
  deadline: bigint,
  contract: string
): HumanizerVisualization[] => {
  const res = [
    getAction('Permit use of'),
    getToken(contract, tokenId),
    getLabel('to'),
    getAddressVisualization(spender)
  ]
  if (getDeadline(deadline)) res.push(getDeadline(deadline) as HumanizerVisualization)
  return res
}
export const erc721Module: HumanizerTypedMessageModule = (message: Message) => {
  if (message.content.kind !== 'typedMessage') return { fullVisualization: [] }
  const tm = message.content
  if (
    tm.types.Permit &&
    tm.primaryType === 'Permit' &&
    tm.message.spender &&
    tm.message.tokenId &&
    tm.message.nonce &&
    tm.message.deadline
  ) {
    return {
      fullVisualization: visualizePermit(
        tm.message.spender,
        tm.message.tokenId,
        tm.message.deadline,
        tm.domain.verifyingContract as string
      )
    }
  }
  return { fullVisualization: [] }
}
