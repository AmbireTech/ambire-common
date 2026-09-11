import { isAddress, zeroAddress } from 'viem'

import { PANCAKE_SWAP_PERMIT_2_ADDRESS, PERMIT_2_ADDRESS } from '../../../consts/addresses'
import { Message } from '../../../interfaces/userRequest'
import {
  HumanizerTypedMessageModule,
  HumanizerVisualization,
  HumanizerWarning
} from '../interfaces'
import {
  getAction,
  getAddressVisualization,
  getDeadline,
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

  const witnessMessageType =
    tm.types?.PermitWitnessTransferFrom?.[0]?.type ||
    tm.types?.PermitBatchWitnessTransferFrom?.[0]?.type

  if (
    witnessMessageType &&
    ['TokenPermissions', 'TokenPermissions[]'].includes(witnessMessageType)
  ) {
    const { permitted, spender, nonce, deadline, witness } = tm.message
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

  const messageType =
    tm?.types?.PermitSingle?.[0]?.type ||
    tm?.types?.PermitBatch?.[0]?.type ||
    tm.types?.PermitTransferFrom?.[0]?.type

  if (!messageType) return { fullVisualization: [] }
  if (messageType === 'TokenPermissions') {
    const { spender, nonce, deadline, permitted } = tm.message
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
  } else if (['PermitDetails', 'PermitDetails[]'].includes(messageType)) {
    if (!tm.message.details) return { fullVisualization: [] }
    const permits: { token: string; amount: bigint }[] = (
      messageType === 'PermitDetails' ? [tm.message.details] : tm.message.details
    ).map((d: PermitDetails) => ({
      token: d.token,
      amount: d.amount
    }))
    if (permits.some((p) => p.amount === undefined || p.token === undefined))
      return { fullVisualization: [] }

    if (!permits.length) return { fullVisualization: [] }

    const permitVisualizations = permits
      .map(({ token, amount }) => [
        getAddressVisualization(tm.message.spender),
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
        getDeadline(tm.message.sigDeadline) as HumanizerVisualization
      ]
    }
  }

  return { fullVisualization: [] }
}
