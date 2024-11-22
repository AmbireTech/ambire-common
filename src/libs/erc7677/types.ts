export interface PaymasterService {
  url: string
  context: {
    policyId: string
  }
}

export interface PaymasterCapabilities {
  [walletAddress: string]: PaymasterService
}

export type PaymasterEstimationData = {
  sponsor?: { name: string; icon?: string }
  paymaster?: `0x${string}`
  paymasterData?: `0x${string}`
  paymasterVerificationGasLimit?: `0x${string}`
  paymasterPostOpGasLimit?: `0x${string}`
  isFinal?: boolean // Indicates that the caller does not need to call pm_getPaymasterData
}

export type GetPaymasterDataResult = {
  paymaster?: string
  paymasterData?: string
}
