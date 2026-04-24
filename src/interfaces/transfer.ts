import { HumanizerMeta } from '../libs/humanizer/interfaces'
import { TokenResult } from '../libs/portfolio'
import { ControllerInterface } from './controller'
import { AddressStateOptional } from './domains'

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
}

export type AddressPoisoningMatch = {
  matchedAddress: string
  // Number of prefix and suffix chars that matched (e.g. 4, 5 or 6).
  // Used by validation message formatting to decide how much address context to show.
  matchedCharsCount: number
}
