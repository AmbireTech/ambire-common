import { PERMIT_2_ADDRESS } from '../../../consts/addresses'
import { TypedMessage } from '../../../interfaces/userRequest'
import { HumanizerTypedMessaageModule, HumanizerVisualization } from '../interfaces'
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

export const permit2Module: HumanizerTypedMessaageModule = (tm: TypedMessage) => {
  const visualizations: HumanizerVisualization[] = []
  if (
    tm?.params?.domain?.verifyingContract &&
    tm.params.domain.verifyingContract.toLowerCase() === PERMIT_2_ADDRESS.toLowerCase()
  ) {
    if (tm.params?.types?.PermitSingle?.[0]?.type === 'PermitDetails') {
      visualizations.push(
        ...visualizePermit(tm.params.message.details),
        getLabel('this whole signatuere'),
        getDeadline(tm.params.message.sigDeadline)
      )
    } else if (tm.params?.types?.PermitBatch?.[0]?.type === 'PermitDetails[]') {
      tm.params.message.details.forEach((permitDetails: PermitDetails, i: number) => {
        visualizations.push(
          ...[
            getLabel(`Permit #${i + 1}`),
            ...visualizePermit(permitDetails),
            getLabel('this whole signatuere'),
            getDeadline(tm.params.message.sigDeadline) as HumanizerVisualization
          ]
        )
      })
    }
    return { fullVisualization: visualizations }
  }

  return { fullVisualization: [] }
}
