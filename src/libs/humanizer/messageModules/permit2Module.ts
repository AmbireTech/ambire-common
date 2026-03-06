import { PANCAKE_SWAP_PERMIT_2_ADDRESS, PERMIT_2_ADDRESS } from '../../../consts/addresses'
import { Message } from '../../../interfaces/userRequest'
import { HumanizerTypedMessageModule, HumanizerVisualization } from '../interfaces'
import { getAction, getAddressVisualization, getDeadline, getLabel, getToken } from '../utils'

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
