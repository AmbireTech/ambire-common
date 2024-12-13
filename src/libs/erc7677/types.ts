export interface PaymasterService {
  url: string
  context: {
    policyId: string
  }
  id: number
  failed?: boolean
}

export interface PaymasterCapabilities {
  [chainId: `0x${string}`]: PaymasterService
}

export interface Sponsor {
  name: string
  icon?: string
}

export type PaymasterEstimationData = {
  paymaster: `0x${string}`
  paymasterData: `0x${string}`
  paymasterVerificationGasLimit?: `0x${string}`
  paymasterPostOpGasLimit?: `0x${string}`
  sponsor?: Sponsor
  isFinal?: boolean // Indicates that the caller does not need to call pm_getPaymasterData
}

export interface PaymasterData {
  paymaster: `0x${string}`
  paymasterData: `0x${string}`
}

export interface PaymasterSuccessReponse extends PaymasterData {
  success: boolean
}

export interface PaymasterErrorReponse {
  success: boolean
  message: string
  error: Error
}
