import { isAddress, zeroAddress } from 'viem'

import { PANCAKE_SWAP_PERMIT_2_ADDRESS, PERMIT_2_ADDRESS } from '../../../consts/addresses'
import { Message } from '../../../interfaces/userRequest'
import { HumanizerTypedMessageModule, HumanizerWarning } from '../interfaces'
import {
  getAction,
  getAddressVisualization,
  getDeadline,
  getLabel,
  getRecipientText,
  getSignedMessage,
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

function isCompletePermitDetails(
  details: PermitDetails
): details is { token: string; amount: bigint; expiration: bigint } {
  return (
    details.token !== undefined && details.amount !== undefined && details.expiration !== undefined
  )
}

function isCompletePermission(
  permission: TokenPermissions
): permission is { token: string; amount: bigint } {
  return permission.token !== undefined && permission.amount !== undefined
}

const WITNESS_PRIMARY_TYPES = ['PermitWitnessTransferFrom', 'PermitBatchWitnessTransferFrom']

// The witness struct is defined by the app that asks for the signature, so the
// address that receives the tokens can be under any of these common names
const WITNESS_RECIPIENT_FIELD_NAMES = ['recipient', 'receiver', 'to']

function getWitnessRecipient(witness: Record<string, any> | undefined): string | undefined {
  if (!witness) return undefined

  const recipientFieldName = WITNESS_RECIPIENT_FIELD_NAMES.find((fieldName) => {
    const value = witness[fieldName]
    return typeof value === 'string' && isAddress(value)
  })

  return recipientFieldName ? witness[recipientFieldName] : undefined
}

export const permit2Module: HumanizerTypedMessageModule = (message: Message) => {
  if (message.content.kind !== 'typedMessage') return { fullVisualization: [] }
  const tm = message.content
  if (
    !tm?.domain?.verifyingContract ||
    ![PERMIT_2_ADDRESS.toLowerCase(), PANCAKE_SWAP_PERMIT_2_ADDRESS.toLocaleLowerCase()].includes(
      tm.domain.verifyingContract.toLowerCase()
    )
  )
    return { fullVisualization: [] }

  // The branch is chosen by the type that is actually signed, not by which type names or message
  // keys happen to be present, and only the fields declared in that type are read
  const signedMessage = getSignedMessage(tm.types, tm.primaryType, tm.message)

  if (WITNESS_PRIMARY_TYPES.includes(tm.primaryType)) {
    const { permitted, spender, nonce, deadline, witness } = signedMessage
    if ([permitted, spender, nonce, deadline].some((field) => field === undefined))
      return { fullVisualization: [] }

    const permissions: TokenPermissions[] = Array.isArray(permitted) ? permitted : [permitted]
    const completePermissions = permissions.filter(isCompletePermission)
    if (!completePermissions.length || completePermissions.length !== permissions.length)
      return { fullVisualization: [] }

    const tokenVisualizations = completePermissions
      .map(({ token, amount }) => [getToken(token, amount), getLabel('and')])
      .flat()
      .slice(0, -1)

    const recipient = getWitnessRecipient(witness)
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

  if (tm.primaryType === 'PermitTransferFrom') {
    const { spender, nonce, deadline, permitted } = signedMessage
    if ([spender, nonce, deadline, permitted].some((a) => a === undefined))
      return { fullVisualization: [] }
    const { token, amount } = permitted
    if (token === undefined || amount === undefined) return { fullVisualization: [] }
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

  if (tm.primaryType === 'PermitSingle' || tm.primaryType === 'PermitBatch') {
    const { spender, details } = signedMessage
    if (!details || !spender) return { fullVisualization: [] }

    const permits: PermitDetails[] = tm.primaryType === 'PermitSingle' ? [details] : details
    if (!Array.isArray(permits) || !permits.length) return { fullVisualization: [] }
    // The allowance expiration is what limits how long the spender can use the tokens, so
    // it is required. The signature deadline only limits how long the signature can be submitted
    if (!permits.every(isCompletePermitDetails)) return { fullVisualization: [] }

    const permitVisualizations = permits
      .map(({ token, amount, expiration }) => [
        getAddressVisualization(spender),
        getLabel('to use'),
        getToken(token, amount),
        getDeadline(expiration),
        getLabel('and')
      ])
      .flat()
      .slice(0, -1)

    return {
      fullVisualization: [getAction('Approve'), ...permitVisualizations]
    }
  }

  return { fullVisualization: [] }
}
