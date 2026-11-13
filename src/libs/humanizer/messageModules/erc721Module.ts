import { HumanizerTypedMessageFunction, HumanizerVisualization } from '../interfaces'
import {
  getAction,
  getAddressVisualization,
  getDeadline,
  getLabel,
  getToken,
  isTypeDeclaringFields
} from '../utils'

/** Fields of an ERC-4494 (NFT) `Permit` */
export const ERC721_PERMIT_FIELD_NAMES = ['spender', 'tokenId', 'nonce', 'deadline']

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

/**
 * Humanizes an ERC-4494 (NFT) `Permit`. ERC-20 permits use the same primary type,
 * so it checks the fields declared in `types.Permit`. Extra keys in `message` are
 * not signed, so they must not make another permit look like an NFT permit.
 */
export const humanizeErc721Permit: HumanizerTypedMessageFunction = (message) => {
  const tm = message.content
  if (
    isTypeDeclaringFields(tm.types, 'Permit', ERC721_PERMIT_FIELD_NAMES) &&
    tm.domain.verifyingContract &&
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
        tm.domain.verifyingContract
      )
    }
  }
  return null
}
