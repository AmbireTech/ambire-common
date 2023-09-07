import { ethers } from 'ethers'
import { TypedMessage } from '../../../interfaces/userRequest'
import { HumanizerTypedMessaageModule, HumanizerVisualization } from '../interfaces'
import { getAction, getAddress, getDeadlineText, getLabel, getToken } from '../utils'

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

const PERMIT_2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
const visualizePermit = (permit: PermitDetails): HumanizerVisualization[] => {
  return [
    getAction('Permit'),
    getAddress(PERMIT_2_ADDRESS, 'Permi 2 contract'),
    getLabel('to use'),
    getToken(permit.token, permit.amount),
    getLabel('while expiration'),
    getDeadlineText(permit.expiration) as HumanizerVisualization
  ]
}

export const permit2Module: HumanizerTypedMessaageModule = (tm: TypedMessage) => {
  const visualizations: HumanizerVisualization[][] = []
  if (ethers.getAddress(tm.domain.verifyingContract as string) === PERMIT_2_ADDRESS)
    if (tm.types.PermitSingle[0].type === 'PermitDetails') {
      visualizations.push([
        ...visualizePermit(tm.message.details),
        getLabel('this signatuere'),
        getDeadlineText(tm.message.sigDeadline) as HumanizerVisualization
      ])
    } else if (tm.types.PermitSingle[0].type === 'PermitDetails[]') {
      tm.message.details.forEach((permitDetails: PermitDetails) => {
        visualizations.push([
          ...visualizePermit(permitDetails),
          getLabel('this signatuere'),
          getDeadlineText(tm.message.sidDeadline) as HumanizerVisualization
        ])
      })
    }

  return []
}
