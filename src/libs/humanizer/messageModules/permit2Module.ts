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
  getAction,
  getAddressVisualization,
  getDeadline,
  getDeclaredFieldType,
  getLabel,
  getRecipientText,
  getToken,
  getWarning
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

interface PermitDetails {
  token?: string
  amount?: bigint
  expiration?: bigint
  nonce?: bigint
}

interface TokenPermissions {
  token?: string
  amount?: bigint
}

function isCompletePermission(
  permission: TokenPermissions
): permission is { token: string; amount: bigint } {
  return permission.token !== undefined && permission.amount !== undefined
}

// The witness struct is defined by the app that asks for the signature, so the
// address that receives the tokens can be under any of these common names
const WITNESS_RECIPIENT_FIELD_NAMES = ['recipient', 'receiver', 'to']

/** Name of the Permit2 field that holds the app-defined witness struct */
const WITNESS_FIELD_NAME = 'witness'

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

const EMPTY_HUMANIZATION: HumanizerMessageResult = { fullVisualization: [] }

const PERMIT_2_CONTRACTS = [
  PERMIT_2_ADDRESS.toLowerCase(),
  PANCAKE_SWAP_PERMIT_2_ADDRESS.toLowerCase()
]

/** Tells if the message is signed for a known Permit2 contract (Uniswap or PancakeSwap) */
const isPermit2Message = (message: HumanizerTypedMessage): boolean => {
  const verifyingContract = message.content.domain?.verifyingContract
  return !!verifyingContract && PERMIT_2_CONTRACTS.includes(verifyingContract.toLowerCase())
}

/**
 * Humanizes a Permit2 signature transfer with an app-defined witness struct.
 * Primary types: `PermitWitnessTransferFrom` (one token) and
 * `PermitBatchWitnessTransferFrom` (many tokens).
 */
export const humanizePermit2WitnessTransfer: HumanizerTypedMessageFunction = (message) => {
  if (!isPermit2Message(message)) return EMPTY_HUMANIZATION

  const { permitted, spender, nonce, deadline } = message.content.message
  if ([permitted, spender, nonce, deadline].some((field) => field === undefined))
    return EMPTY_HUMANIZATION

  const permissions: TokenPermissions[] = Array.isArray(permitted) ? permitted : [permitted]
  const completePermissions = permissions.filter(isCompletePermission)
  if (!completePermissions.length || completePermissions.length !== permissions.length)
    return EMPTY_HUMANIZATION

  const tokenVisualizations = completePermissions
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

/** Humanizes a Permit2 signature transfer of one token (primary type `PermitTransferFrom`) */
export const humanizePermit2Transfer: HumanizerTypedMessageFunction = (message) => {
  if (!isPermit2Message(message)) return EMPTY_HUMANIZATION

  const { spender, nonce, deadline, permitted } = message.content.message
  if ([spender, nonce, deadline, permitted].some((a) => a === undefined)) return EMPTY_HUMANIZATION
  const { token, amount } = permitted
  if (token === undefined || amount === undefined) return EMPTY_HUMANIZATION
  return {
    fullVisualization: [
      getAction('Approve'),
      getAddressVisualization(spender),
      getLabel('to use'),
      getToken(token, amount),
      getDeadline(deadline)
    ]
  }
}

const humanizePermit2Allowance = (
  message: HumanizerTypedMessage,
  details: PermitDetails[]
): HumanizerMessageResult => {
  if (!details.length || !details.every(isCompletePermission)) return EMPTY_HUMANIZATION

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
  const { details } = message.content.message
  if (!isPermit2Message(message) || !details || Array.isArray(details)) return EMPTY_HUMANIZATION

  return humanizePermit2Allowance(message, [details])
}

/** Humanizes a Permit2 allowance for many tokens (primary type `PermitBatch`) */
export const humanizePermit2Batch: HumanizerTypedMessageFunction = (message) => {
  const { details } = message.content.message
  if (!isPermit2Message(message) || !Array.isArray(details)) return EMPTY_HUMANIZATION

  return humanizePermit2Allowance(message, details)
}
