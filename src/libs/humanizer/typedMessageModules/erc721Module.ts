import { ethers } from 'ethers'
import { TypedMessage } from '../../../interfaces/userRequest'
import { HumanizerTypedMessaageModule, HumanizerVisualization } from '../interfaces'
import { getAction, getDeadlineText, getAddress, getLabel, getNft } from '../utils'

const visualizePermit = (
  spender: string,
  tokenId: bigint,
  deadline: bigint,
  contract: string
): HumanizerVisualization[] => {
  const res = [
    getAction('Sign permit'),
    getLabel('to'),
    getAction('Permit use of'),
    getNft(contract, tokenId),
    getLabel('to'),
    getAddress(spender)
  ]
  if (getDeadlineText(deadline)) res.push(getDeadlineText(deadline) as HumanizerVisualization)
  return res
}
export const erc721Module: HumanizerTypedMessaageModule = (tm: TypedMessage) => {
  if (tm.types.Permit && tm.primaryType === 'Permit') {
    if (tm.message.spender && tm.message.tokenId && tm.message.nonce && tm.message.deadline) {
      return visualizePermit(
        ethers.getAddress(tm.message.spender),
        tm.message.tokenId,
        tm.message.deadline,
        ethers.getAddress(tm.domain.verifyingContract as string)
      )
    }
  }
  return []
}
