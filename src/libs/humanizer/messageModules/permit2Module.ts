import { isAddress, zeroAddress } from 'viem'

import { PANCAKE_SWAP_PERMIT_2_ADDRESS, PERMIT_2_ADDRESS } from '../../../consts/addresses'
import {
  HumanizerMessageResult,
  HumanizerTypedMessage,
  HumanizerTypedMessageFunction,
  HumanizerVisualization,
  HumanizerWarning
} from '../interfaces'
import {
  APP_DEFINED_STRUCT_TYPE,
  ExpectedTypedData,
  getAction,
  getAddressVisualization,
  getDeadline,
  getDeclaredFieldType,
  getLabel,
  getRecipientText,
  getToken,
  getWarning,
  isExactTypedData,
  TypedDataField
} from '../utils'

// interfaces
// export interface PermitSingle {
//     details: PermitDetails
//     spender: string
//     sigDeadline: BigNumberish
//   }

// interface PermitBatch {
//   details: PermitDetails[]
//   spender: string
//   sigDeadline: BigNumberish
// }

// example
// const permitSingle: PermitSingle = {
//   details: {
//     token: tokenAddress,
//     amount: MaxAllowanceTransferAmount,
//     // You may set your own deadline - we use 30 days.
//     expiration: toDeadline(/* 30 days= */ 1000 * 60 * 60 * 24 * 30),
//     nonce
//   },
//   spender: spenderAddress,
//   // You may set your own deadline - we use 30 minutes.
//   sigDeadline: toDeadline(/* 30 minutes= */ 1000 * 60 * 60 * 30)
// }

/** A token and an amount, from `PermitDetails` or `TokenPermissions` */
interface TokenAmount {
  token: string
  amount: bigint
}

/** Permit2 `PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)` */
const PERMIT_DETAILS_FIELDS: TypedDataField[] = [
  { name: 'token', type: 'address' },
  { name: 'amount', type: 'uint160' },
  { name: 'expiration', type: 'uint48' },
  { name: 'nonce', type: 'uint48' }
]

/** Permit2 `TokenPermissions(address token,uint256 amount)` */
const TOKEN_PERMISSIONS_FIELDS: TypedDataField[] = [
  { name: 'token', type: 'address' },
  { name: 'amount', type: 'uint256' }
]

/** Permit2 allowance for one token, as the Permit2 SDK builds it */
const PERMIT_SINGLE_TYPED_DATA: ExpectedTypedData = {
  primaryType: 'PermitSingle',
  types: {
    PermitSingle: [
      { name: 'details', type: 'PermitDetails' },
      { name: 'spender', type: 'address' },
      { name: 'sigDeadline', type: 'uint256' }
    ],
    PermitDetails: PERMIT_DETAILS_FIELDS
  }
}

/** Permit2 allowance for many tokens, as the Permit2 SDK builds it */
const PERMIT_BATCH_TYPED_DATA: ExpectedTypedData = {
  primaryType: 'PermitBatch',
  types: {
    PermitBatch: [
      { name: 'details', type: 'PermitDetails[]' },
      { name: 'spender', type: 'address' },
      { name: 'sigDeadline', type: 'uint256' }
    ],
    PermitDetails: PERMIT_DETAILS_FIELDS
  }
}

/** Permit2 signature transfer of one token, as the Permit2 SDK builds it */
const PERMIT_TRANSFER_FROM_TYPED_DATA: ExpectedTypedData = {
  primaryType: 'PermitTransferFrom',
  types: {
    PermitTransferFrom: [
      { name: 'permitted', type: 'TokenPermissions' },
      { name: 'spender', type: 'address' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' }
    ],
    TokenPermissions: TOKEN_PERMISSIONS_FIELDS
  }
}

/** Name of the Permit2 field that holds the app-defined witness struct */
const WITNESS_FIELD_NAME = 'witness'

/** Permit2 signature transfer with a witness struct that the app defines, as the Permit2 SDK builds it */
const getWitnessTransferTypedData = (
  primaryType: string,
  permittedType: string
): ExpectedTypedData => ({
  primaryType,
  types: {
    [primaryType]: [
      { name: 'permitted', type: permittedType },
      { name: 'spender', type: 'address' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: WITNESS_FIELD_NAME, type: APP_DEFINED_STRUCT_TYPE }
    ],
    TokenPermissions: TOKEN_PERMISSIONS_FIELDS
  }
})

const PERMIT_WITNESS_TRANSFER_FROM_TYPED_DATA = getWitnessTransferTypedData(
  'PermitWitnessTransferFrom',
  'TokenPermissions'
)
const PERMIT_BATCH_WITNESS_TRANSFER_FROM_TYPED_DATA = getWitnessTransferTypedData(
  'PermitBatchWitnessTransferFrom',
  'TokenPermissions[]'
)

// The witness struct is defined by the app that asks for the signature, so the
// address that receives the tokens can be under any of these common names
const WITNESS_RECIPIENT_FIELD_NAMES = ['recipient', 'receiver', 'to']

function getWitnessRecipient(message: HumanizerTypedMessage): string | undefined {
  const { types, primaryType } = message.content
  const witness: Record<string, any> | undefined = message.content.message[WITNESS_FIELD_NAME]
  if (!witness) return undefined

  // Only declared fields are signed. An undeclared `witness` key, or a recipient
  // key that the witness type does not declare, is not signed and must not be shown
  const witnessTypeName = getDeclaredFieldType(types, primaryType, WITNESS_FIELD_NAME)
  if (!witnessTypeName) return undefined

  const recipientFieldName = WITNESS_RECIPIENT_FIELD_NAMES.find((fieldName) => {
    const value = witness[fieldName]
    return (
      getDeclaredFieldType(types, witnessTypeName, fieldName) === 'address' &&
      typeof value === 'string' &&
      isAddress(value)
    )
  })

  return recipientFieldName ? witness[recipientFieldName] : undefined
}

const PERMIT_2_CONTRACTS = [
  PERMIT_2_ADDRESS.toLowerCase(),
  PANCAKE_SWAP_PERMIT_2_ADDRESS.toLowerCase()
]

/**
 * Tells if the message is signed for a known Permit2 contract (Uniswap or
 * PancakeSwap) and is exactly the expected Permit2 definition
 */
const isExactPermit2Message = (
  message: HumanizerTypedMessage,
  expected: ExpectedTypedData
): boolean => {
  const verifyingContract = message.content.domain?.verifyingContract
  return (
    !!verifyingContract &&
    PERMIT_2_CONTRACTS.includes(verifyingContract.toLowerCase()) &&
    isExactTypedData(message.content, expected)
  )
}

const humanizeWitnessTransfer = (
  message: HumanizerTypedMessage,
  permissions: TokenAmount[]
): HumanizerMessageResult | null => {
  if (!permissions.length) return null

  const { spender, deadline } = message.content.message
  const tokenVisualizations = permissions
    .map(({ token, amount }) => [getToken(token, amount), getLabel('and')])
    .flat()
    .slice(0, -1)

  const recipient = getWitnessRecipient(message)
  // A zero recipient does not mean the tokens are burned. Permit2 only checks
  // the signature, so whoever executes the transfer picks where the tokens go
  const isRecipientChosenLater = !!recipient && recipient.toLowerCase() === zeroAddress
  const warnings: HumanizerWarning[] = isRecipientChosenLater
    ? [
        getWarning(
          'This request does not say who receives the tokens. Whoever submits it decides where the tokens go. Sign it only if you fully trust the app.',
          'PERMIT2_MISSING_RECIPIENT'
        )
      ]
    : []

  const recipientVisualizations = () => {
    if (isRecipientChosenLater) return [getLabel('and send them to anyone', true)]
    if (!recipient) return []

    return getRecipientText(message.accountAddr, recipient)
  }

  return {
    fullVisualization: [
      getAction('Approve'),
      getAddressVisualization(spender),
      getLabel('to transfer'),
      ...tokenVisualizations,
      ...recipientVisualizations(),
      getDeadline(deadline)
    ],
    warnings
  }
}

/** Humanizes a Permit2 signature transfer of one token with an app-defined witness (primary type `PermitWitnessTransferFrom`) */
export const humanizePermit2WitnessTransfer: HumanizerTypedMessageFunction = (message) => {
  if (!isExactPermit2Message(message, PERMIT_WITNESS_TRANSFER_FROM_TYPED_DATA)) return null

  return humanizeWitnessTransfer(message, [message.content.message.permitted])
}

/** Humanizes a Permit2 signature transfer of many tokens with an app-defined witness (primary type `PermitBatchWitnessTransferFrom`) */
export const humanizePermit2BatchWitnessTransfer: HumanizerTypedMessageFunction = (message) => {
  if (!isExactPermit2Message(message, PERMIT_BATCH_WITNESS_TRANSFER_FROM_TYPED_DATA)) return null

  return humanizeWitnessTransfer(message, message.content.message.permitted)
}

/** Humanizes a Permit2 signature transfer of one token (primary type `PermitTransferFrom`) */
export const humanizePermit2Transfer: HumanizerTypedMessageFunction = (message) => {
  if (!isExactPermit2Message(message, PERMIT_TRANSFER_FROM_TYPED_DATA)) return null

  const { spender, deadline, permitted } = message.content.message
  return {
    fullVisualization: [
      getAction('Approve'),
      getAddressVisualization(spender),
      getLabel('to use'),
      getToken(permitted.token, permitted.amount),
      getDeadline(deadline)
    ]
  }
}

const humanizePermit2Allowance = (
  message: HumanizerTypedMessage,
  details: TokenAmount[]
): HumanizerMessageResult | null => {
  if (!details.length) return null

  const { spender, sigDeadline } = message.content.message
  const permitVisualizations = details
    .map(({ token, amount }) => [
      getAddressVisualization(spender),
      getLabel('to use'),
      getToken(token, amount),
      getLabel('and')
    ])
    .flat()
    .slice(0, -1)

  return {
    fullVisualization: [
      getAction('Approve'),
      ...permitVisualizations,
      getDeadline(sigDeadline) as HumanizerVisualization
    ]
  }
}

/** Humanizes a Permit2 allowance for one token (primary type `PermitSingle`) */
export const humanizePermit2Single: HumanizerTypedMessageFunction = (message) => {
  if (!isExactPermit2Message(message, PERMIT_SINGLE_TYPED_DATA)) return null

  return humanizePermit2Allowance(message, [message.content.message.details])
}

/** Humanizes a Permit2 allowance for many tokens (primary type `PermitBatch`) */
export const humanizePermit2Batch: HumanizerTypedMessageFunction = (message) => {
  if (!isExactPermit2Message(message, PERMIT_BATCH_TYPED_DATA)) return null

  return humanizePermit2Allowance(message, message.content.message.details)
}
