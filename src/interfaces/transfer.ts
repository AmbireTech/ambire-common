import { Contacts } from '../controllers/addressBook/addressBook'
import { HumanizerMeta } from '../libs/humanizer/interfaces'
import { TokenResult } from '../libs/portfolio'
import { AddressStateOptional } from './domains'

export interface TransferUpdate {
  humanizerInfo?: HumanizerMeta
  selectedToken?: TokenResult
  amount?: string
  addressState?: AddressStateOptional
  isSWWarningAgreed?: boolean
  isRecipientAddressUnknownAgreed?: boolean
  isTopUp?: boolean
  amountFieldMode?: 'token' | 'fiat'
}
