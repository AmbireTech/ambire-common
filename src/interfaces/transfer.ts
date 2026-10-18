import { HumanizerMeta } from '../libs/humanizer/interfaces'
import { TokenResult } from '../libs/portfolio'
import { ControllerInterface } from './controller'
import { AddressStateOptional } from './domains'
import { PrivateAccountRef } from './privateAccount'

export type ITransferController = ControllerInterface<
  InstanceType<typeof import('../controllers/transfer/transfer').TransferController>
>

export interface TransferUpdate {
  humanizerInfo?: HumanizerMeta
  selectedToken?: TokenResult
  amount?: string
  shouldSetMaxAmount?: boolean
  addressState?: AddressStateOptional
  isRecipientAddressUnknownAgreed?: boolean
  amountFieldMode?: 'token' | 'fiat'
  /** A private account to send to instead of an address; null undoes it. */
  privateRecipient?: PrivateAccountRef | null
}

export type AddressPoisoningMatch = {
  matchedAddress: string
  // Number of consecutive chars that matched from the left/right side of the address body.
  // We keep them separate because poisoning lookalikes are not always symmetric (e.g. 3-left, 6-right).
  matchedPrefixCharsCount: number
  matchedSuffixCharsCount: number
}

export type AmountAdjustmentInfo = {
  feeAmount: string
  tokenSymbol: string
}
