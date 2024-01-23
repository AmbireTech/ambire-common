import { ethers } from 'ethers'
import { TypedMessage } from '../../../interfaces/userRequest'
import { HumanizerTypedMessaageModule, HumanizerVisualization } from '../interfaces'
import { getAction, getDeadline, getAddress, getLabel, getNft } from '../utils'

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
    getAddress(spender)
  ]
  if (getDeadline(deadline)) res.push(getDeadline(deadline) as HumanizerVisualization)
  return res
}
export const erc721Module: HumanizerTypedMessaageModule = (tm: TypedMessage) => {
  if (tm.types.Permit && tm.primaryType === 'Permit') {
    if (tm.message.spender && tm.message.tokenId && tm.message.nonce && tm.message.deadline) {
      return {
        fullVisualization: visualizePermit(
          ethers.getAddress(tm.message.spender),
          tm.message.tokenId,
          tm.message.deadline,
          ethers.getAddress(tm.domain.verifyingContract as string)
        )
      }
    }
  }
  return { fullVisualization: [] }
}
