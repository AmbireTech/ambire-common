import { Hex } from '../../interfaces/hex'

export interface PaymasterService {
  url: string
  context?: {
    policyId: string
  }
  id: number
  failed?: boolean
}

export interface PaymasterCapabilities {
  [chainId: Hex]: PaymasterService
}

export interface Sponsor {
  name: string
  icon?: string
}

export type PaymasterEstimationData = {
  paymaster: Hex
  paymasterData: Hex
  paymasterVerificationGasLimit?: Hex
  paymasterPostOpGasLimit?: Hex
  sponsor?: Sponsor
  isFinal?: boolean // Indicates that the caller does not need to call pm_getPaymasterData
}

export interface PaymasterData {
  paymaster: Hex
  paymasterData: Hex
}

export interface PaymasterSuccessReponse extends PaymasterData {
  success: boolean
}

export interface PaymasterErrorReponse {
  success: boolean
  message: string
  error: Error
}
