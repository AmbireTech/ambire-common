import { MaxUint256 } from 'ethers'

import {
  HumanizerMessageResult,
  HumanizerTypedMessageFunction,
  HumanizerVisualization
} from '../interfaces'
import {
  ExpectedTypedData,
  getAction,
  getAddressVisualization,
  getDeadline,
  getLabel,
  getToken,
  isExactTypedData,
  TypedDataField
} from '../utils'

/** EIP-2612 `Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)` */
const ERC2612_PERMIT_FIELDS: TypedDataField[] = [
  { name: 'owner', type: 'address' },
  { name: 'spender', type: 'address' },
  { name: 'value', type: 'uint256' },
  { name: 'nonce', type: 'uint256' },
  { name: 'deadline', type: 'uint256' }
]

/** DAI-style (before EIP-2612) `Permit(address holder,address spender,uint256 nonce,uint256 expiry,bool allowed)` */
const DAI_PERMIT_FIELDS: TypedDataField[] = [
  { name: 'holder', type: 'address' },
  { name: 'spender', type: 'address' },
  { name: 'nonce', type: 'uint256' },
  { name: 'expiry', type: 'uint256' },
  { name: 'allowed', type: 'bool' }
]

/** ERC-4494 (NFT) `Permit(address spender,uint256 tokenId,uint256 nonce,uint256 deadline)` */
const ERC4494_PERMIT_FIELDS: TypedDataField[] = [
  { name: 'spender', type: 'address' },
  { name: 'tokenId', type: 'uint256' },
  { name: 'nonce', type: 'uint256' },
  { name: 'deadline', type: 'uint256' }
]

type PermitHumanizer = (token: string, permit: Record<string, any>) => HumanizerMessageResult | null

const humanizeErc2612Permit: PermitHumanizer = (token, permit) => ({
  fullVisualization: [
    getAction('Grant approval'),
    getLabel('for'),
    getToken(token, permit.value),
    getLabel('to'),
    getAddressVisualization(permit.spender),
    ...(permit.deadline ? [getDeadline(permit.deadline)] : [])
  ]
})

// DAI-style permit (pre EIP-2612): no `value`, only a boolean `allowed` that
// grants an unlimited allowance when true and revokes it when false.
// `expiry` of 0 means the permit never expires
const humanizeDaiPermit: PermitHumanizer = (token, permit) => {
  const isGranting = Boolean(permit.allowed)
  if (!isGranting)
    return {
      fullVisualization: [
        getAction('Revoke approval'),
        getToken(token, 0n),
        getLabel('for'),
        getAddressVisualization(permit.spender)
      ]
    }
  return {
    fullVisualization: [
      getAction('Grant approval'),
      getLabel('for'),
      getToken(token, MaxUint256),
      getLabel('to'),
      getAddressVisualization(permit.spender),
      ...(permit.expiry ? [getDeadline(permit.expiry)] : [])
    ]
  }
}

const humanizeNftPermit: PermitHumanizer = (contract, permit) => {
  const fullVisualization: HumanizerVisualization[] = [
    getAction('Permit use of'),
    getToken(contract, permit.tokenId),
    getLabel('to'),
    getAddressVisualization(permit.spender),
    getDeadline(permit.deadline)
  ]
  return { fullVisualization }
}

const getPermitTypedData = (fields: TypedDataField[]): ExpectedTypedData => ({
  primaryType: 'Permit',
  types: { Permit: fields }
})

/** The permits that use the `Permit` primary type. Their signed types differ, so at most one matches */
const PERMIT_KINDS: { typedData: ExpectedTypedData; humanize: PermitHumanizer }[] = [
  { typedData: getPermitTypedData(ERC2612_PERMIT_FIELDS), humanize: humanizeErc2612Permit },
  { typedData: getPermitTypedData(DAI_PERMIT_FIELDS), humanize: humanizeDaiPermit },
  { typedData: getPermitTypedData(ERC4494_PERMIT_FIELDS), humanize: humanizeNftPermit }
]

/**
 * Humanizes a `Permit` typed message: a token permit (EIP-2612 or DAI-style) or
 * an NFT permit (ERC-4494). All three use the same primary type, so the signed
 * `types.Permit` decides which one it is. The typed message must be exactly one
 * of the known definitions, with no extra keys in `message`. Any other `Permit`
 * is not humanized.
 */
export const humanizePermit: HumanizerTypedMessageFunction = (message) => {
  const contract = message.content.domain.verifyingContract
  if (!contract) return null

  const permitKind = PERMIT_KINDS.find(({ typedData }) =>
    isExactTypedData(message.content, typedData)
  )

  return permitKind ? permitKind.humanize(contract, message.content.message) : null
}
