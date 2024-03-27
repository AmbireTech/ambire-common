import { UserOperation } from '../userOperation/types'

export interface Erc4337estimation {
  userOp: UserOperation
  gasUsed: bigint
}

export interface EstimateResult {
  gasUsed: bigint
  nonce: number
  feePaymentOptions: {
    availableAmount: bigint
    paidBy: string
    address: string
    gasUsed?: bigint
    addedNative: bigint
    isGasTank: boolean
  }[]
  erc4337estimation: Erc4337estimation | null
  arbitrumL1FeeIfArbitrum: { noFee: bigint; withFee: bigint }
  l1FeeAsL2Gas: bigint
  error: Error | null
}
