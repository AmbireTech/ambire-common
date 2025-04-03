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
  token: string
  amount: bigint
  expiration: bigint
  nonce: bigint
}

interface PermitGist {
  token: string
  amount: bigint
}

const getPermitData = (permit: PermitDetails): PermitGist => {
  return { token: permit.token, amount: permit.amount }
}

export const permit2Module: HumanizerTypedMessageModule = (message: Message) => {
  if (message.content.kind !== 'typedMessage') return { fullVisualization: [] }
  const tm = message.content
  if (
    tm?.domain?.verifyingContract &&
    [PERMIT_2_ADDRESS.toLowerCase(), PANCAKE_SWAP_PERMIT_2_ADDRESS.toLocaleLowerCase()].includes(
      tm.domain.verifyingContract.toLowerCase()
    )
  ) {
    const messageType = tm?.types?.PermitSingle?.[0]?.type || tm?.types?.PermitBatch?.[0]?.type
    if (!['PermitDetails', 'PermitDetails[]'].includes(messageType))
      return { fullVisualization: [] }

    const permits: PermitGist[] =
      messageType === 'PermitDetails'
        ? [getPermitData(tm.message.details)]
        : tm.message.details.map((permitDetails: PermitDetails) => getPermitData(permitDetails))

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
