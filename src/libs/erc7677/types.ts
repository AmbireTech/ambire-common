export interface PaymasterService {
  url: string
  context: {
    policyId: string
  }
}

export interface PaymasterCapabilities {
  [chainId: `0x${string}`]: PaymasterService
}

export type PaymasterEstimationData = {
  paymaster: `0x${string}`
  paymasterData: `0x${string}`
  paymasterVerificationGasLimit: `0x${string}`
  paymasterPostOpGasLimit: `0x${string}`
  sponsor?: { name: string; icon?: string }
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

export type GetPaymasterDataResult = {
  paymaster?: string
  paymasterData?: string
}
