import { TokenResult } from '../libs/portfolio'
import { AddressStateOptional } from './domains'

export interface TransferUpdate {
  selectedAccount?: string
  preSelectedToken?: string
  selectedToken?: TokenResult
  amount?: string
  addressState?: AddressStateOptional
  isSWWarningAgreed?: boolean
  isRecipientAddressUnknownAgreed?: boolean
  isTopUp?: boolean
}
