import { Contacts } from '../controllers/addressBook/addressBook'
import { HumanizerMeta } from '../libs/humanizer/interfaces'
import { TokenResult } from '../libs/portfolio'
import { AddressStateOptional } from './domains'
import { Network } from './network'

export interface TransferUpdate {
  selectedAccount?: string
  humanizerInfo?: HumanizerMeta
  networks?: Network[]
  contacts?: Contacts
  selectedToken?: TokenResult
  amount?: string
  addressState?: AddressStateOptional
  isSWWarningAgreed?: boolean
  isRecipientAddressUnknownAgreed?: boolean
  isTopUp?: boolean
}
