import { TokenResult } from '../libs/portfolio'
import { UserRequest } from './userRequest'

export interface TransferControllerState {
  isInitialized: boolean

  tokens: TokenResult[]

  selectedToken: TokenResult | null

  isSWWarningVisible: boolean

  isSWWarningAgreed: boolean

  amount: string

  maxAmount: string

  recipient: {
    address: string
    isENS: boolean
    isUD: boolean
    isDomainResolving: boolean
  }

  isRecipientAddressUnknown: boolean

  isRecipientAddressUnknownAgreed: boolean

  isRecipientSmartContract: boolean

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
}
