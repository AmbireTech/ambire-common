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

  recipientAddress: string

  recipientEnsAddress: string

  recipientUDAddress: string

  isRecipientDomainResolving: boolean

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
