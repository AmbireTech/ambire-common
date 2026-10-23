import { MaxUint256, TypedDataField } from 'ethers'

import { Message } from '../../../interfaces/userRequest'
import { getEip712EncodeTypeHash } from '../erc7730/eip712'
import { Erc7730TypedDataTypes } from '../erc7730/types'
import { HumanizerTypedMessageModule, RichHumanizerVisualization } from '../interfaces'
import {
  formatTimestampAsDate,
  getAction,
  getAddressVisualization,
  getDeadline,
  getLabel,
  getRichVisualization,
  getSingleValueRow,
  getText,
  getToken
} from '../utils'

// The hash of the exact EIP-2612 `Permit` struct. A struct that only has fields with the same
// names is not necessarily one: its owner could have given the fields another meaning.
const ERC2612_PERMIT_ENCODE_TYPE_HASH =
  '0x6e71edae12b1b97f4d1f60370fef10105fa2faae0126114a169c64845d6126c9'

const isErc2612PermitStruct = (types: Record<string, TypedDataField[]>) => {
  try {
    return (
      getEip712EncodeTypeHash(types as Erc7730TypedDataTypes, 'Permit') ===
      ERC2612_PERMIT_ENCODE_TYPE_HASH
    )
  } catch {
    return false
  }
}

// The way the ERC-7730 descriptor for the EIP-2612 permit shows it: an intent and labelled rows
const getErc2612PermitVisualization = (
  message: Message
): RichHumanizerVisualization | undefined => {
  if (message.content.kind !== 'typedMessage') return undefined

  const { domain, message: permit } = message.content
  const { verifyingContract } = domain
  if (!verifyingContract) return undefined

  try {
    const chainId = BigInt(domain.chainId ?? message.chainId)
    const deadline = BigInt(permit.deadline)

    return getRichVisualization('Authorize spending of tokens', [
      getSingleValueRow('Spender', getAddressVisualization(permit.spender)),
      getSingleValueRow(
        'Max spending amount',
        getToken(verifyingContract, BigInt(permit.value), chainId)
      ),
      getSingleValueRow(
        'Valid until',
        getText(formatTimestampAsDate(deadline) ?? deadline.toString())
      )
    ])
  } catch {
    // A value that is not a number cannot be shown in rows, the flat visualization still is
    return undefined
  }
}

export const erc20Module: HumanizerTypedMessageModule = (message: Message) => {
  if (message.content.kind !== 'typedMessage') return { fullVisualization: [] }
  const tm = message.content
  if (
    tm.primaryType !== 'Permit' ||
    !tm.types.Permit ||
    !tm.message ||
    !tm.domain.verifyingContract
  )
    return { fullVisualization: [] }

  // EIP-2612 permit
  if (['owner', 'spender', 'value', 'nonce', 'deadline'].every((i) => i in tm.message)) {
    const richVisualization = isErc2612PermitStruct(tm.types)
      ? getErc2612PermitVisualization(message)
      : undefined

    return {
      fullVisualization: [
        getAction('Grant approval'),
        getLabel('for'),
        getToken(tm.domain.verifyingContract!, tm.message.value),
        getLabel('to'),
        getAddressVisualization(tm.message.spender),
        ...(tm.message.deadline ? [getDeadline(tm.message.deadline)] : [])
      ],
      richVisualization,
      // A descriptor sets this for the rows it shows, and the rows are all there is to expand
      canHideDropdownArrow: richVisualization ? true : undefined
    }
  }

  // DAI-style permit (pre EIP-2612): no `value`, only a boolean `allowed` that
  // grants an unlimited allowance when true and revokes it when false.
  // `expiry` of 0 means the permit never expires
  if (['holder', 'spender', 'nonce', 'expiry', 'allowed'].every((i) => i in tm.message)) {
    const isGranting = Boolean(tm.message.allowed)
    if (!isGranting)
      return {
        fullVisualization: [
          getAction('Revoke approval'),
          getToken(tm.domain.verifyingContract!, 0n),
          getLabel('for'),
          getAddressVisualization(tm.message.spender)
        ]
      }
    return {
      fullVisualization: [
        getAction('Grant approval'),
        getLabel('for'),
        getToken(tm.domain.verifyingContract!, MaxUint256),
        getLabel('to'),
        getAddressVisualization(tm.message.spender),
        ...(tm.message.expiry ? [getDeadline(tm.message.expiry)] : [])
      ]
    }
  }

  return { fullVisualization: [] }
}
