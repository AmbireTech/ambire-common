import { Contacts } from '../controllers/addressBook/addressBook'
import { HumanizerMeta } from '../libs/humanizer/interfaces'
import { TokenResult } from '../libs/portfolio'
import { AddressStateOptional } from './domains'
import { NetworkDescriptor } from './networkDescriptor'

export interface TransferUpdate {
  selectedAccount?: string
  humanizerInfo?: HumanizerMeta
  networks?: NetworkDescriptor[]
  contacts?: Contacts
  selectedToken?: TokenResult
  amount?: string
  addressState?: AddressStateOptional
  isSWWarningAgreed?: boolean
  isRecipientAddressUnknownAgreed?: boolean
  isTopUp?: boolean
}
