import { MaxUint256 } from 'ethers'

import { HumanizerTypedMessageFunction } from '../interfaces'
import {
  getAction,
  getAddressVisualization,
  getDeadline,
  getLabel,
  getToken,
  isTypeDeclaringFields
} from '../utils'

/** Fields of an EIP-2612 `Permit` */
const ERC2612_PERMIT_FIELD_NAMES = ['owner', 'spender', 'value', 'nonce', 'deadline']
/** Fields of a DAI-style `Permit` (before EIP-2612) */
const DAI_PERMIT_FIELD_NAMES = ['holder', 'spender', 'nonce', 'expiry', 'allowed']

/**
 * Humanizes an ERC-20 `Permit` (EIP-2612 or DAI-style). Both use the same primary
 * type, so the branch is chosen from the fields declared in `types.Permit`. Extra
 * keys in `message` are not signed, so they must not choose the branch.
 */
export const humanizeErc20Permit: HumanizerTypedMessageFunction = (message) => {
  const tm = message.content
  if (!tm.types.Permit || !tm.message || !tm.domain.verifyingContract) return null

  const token = tm.domain.verifyingContract

  // EIP-2612 permit
  if (isTypeDeclaringFields(tm.types, 'Permit', ERC2612_PERMIT_FIELD_NAMES)) {
    return {
      fullVisualization: [
        getAction('Grant approval'),
        getLabel('for'),
        getToken(token, tm.message.value),
        getLabel('to'),
        getAddressVisualization(tm.message.spender),
        ...(tm.message.deadline ? [getDeadline(tm.message.deadline)] : [])
      ]
    }
  }

  // DAI-style permit (pre EIP-2612): no `value`, only a boolean `allowed` that
  // grants an unlimited allowance when true and revokes it when false.
  // `expiry` of 0 means the permit never expires
  if (isTypeDeclaringFields(tm.types, 'Permit', DAI_PERMIT_FIELD_NAMES)) {
    const isGranting = Boolean(tm.message.allowed)
    if (!isGranting)
      return {
        fullVisualization: [
          getAction('Revoke approval'),
          getToken(token, 0n),
          getLabel('for'),
          getAddressVisualization(tm.message.spender)
        ]
      }
    return {
      fullVisualization: [
        getAction('Grant approval'),
        getLabel('for'),
        getToken(token, MaxUint256),
        getLabel('to'),
        getAddressVisualization(tm.message.spender),
        ...(tm.message.expiry ? [getDeadline(tm.message.expiry)] : [])
      ]
    }
  }

  return null
}
