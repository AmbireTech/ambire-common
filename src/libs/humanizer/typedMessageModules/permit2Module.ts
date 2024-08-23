import { PERMIT_2_ADDRESS } from '../../../consts/addresses'
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

const visualizePermit = (permit: PermitDetails): HumanizerVisualization[] => {
  return [
    getAction('Permit'),
    getAddressVisualization(PERMIT_2_ADDRESS),
    getLabel('to use'),
    getToken(permit.token, permit.amount),
    getLabel('for time period'),
    getDeadline(permit.expiration)
  ]
}

export const permit2Module: HumanizerTypedMessageModule = (message: Message) => {
  if (message.content.kind !== 'typedMessage') return { fullVisualization: [] }
  const tm = message.content
  const visualizations: HumanizerVisualization[] = []
  if (
    tm?.domain?.verifyingContract &&
    tm.domain.verifyingContract.toLowerCase() === PERMIT_2_ADDRESS.toLowerCase()
  ) {
    if (tm?.types?.PermitSingle?.[0]?.type === 'PermitDetails') {
      visualizations.push(
        ...visualizePermit(tm.message.details),
        getLabel('this whole signatuere'),
        getDeadline(tm.message.sigDeadline)
      )
    } else if (tm?.types?.PermitBatch?.[0]?.type === 'PermitDetails[]') {
      tm.message.details.forEach((permitDetails: PermitDetails, i: number) => {
        visualizations.push(
          ...[
            getLabel(`Permit #${i + 1}`),
            ...visualizePermit(permitDetails),
            getLabel('this whole signatuere'),
            getDeadline(tm.message.sigDeadline) as HumanizerVisualization
          ]
        )
      })
    }
    return { fullVisualization: visualizations }
  }

  return { fullVisualization: [] }
}
