import { HumanizerMeta } from '../libs/humanizer/interfaces'
import { TokenResult } from '../libs/portfolio'
import { AddressState, AddressStateOptional } from './domains'
import { UserRequest } from './userRequest'

export interface TransferControllerState {
  isInitialized: boolean

  tokens: TokenResult[]

  selectedToken: TokenResult | null

  isSWWarningVisible: boolean

  isSWWarningAgreed: boolean

  amount: string

  maxAmount: string

  addressState: AddressState

  isRecipientAddressUnknown: boolean

  isRecipientAddressUnknownAgreed: boolean

  isRecipientHumanizerKnownTokenOrSmartContract: boolean

  userRequest: UserRequest

  validationFormMsgs: {
    amount: {
      success: boolean
      message: string
    }
    recipientAddress: {
      success: boolean
      message: string
    }
  }

  isFormValid: boolean

  isTopUp: boolean
}

export interface TransferUpdate {
  selectedAccount?: string
  preSelectedToken?: string
  humanizerInfo?: HumanizerMeta
  tokens?: TokenResult[]
  selectedToken?: TokenResult
  amount?: string
  addressState?: AddressStateOptional
  isSWWarningAgreed?: boolean
  isRecipientAddressUnknownAgreed?: boolean
  isTopUp?: boolean
}
