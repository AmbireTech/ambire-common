export interface UseConstantsProps {
  fetch: any
  endpoint: string
}

export interface WALLETInitialClaimableRewardsType {
  addr: string
  fromBalanceClaimable: number
  fromADXClaimable: number
  totalClaimable: string
  leaf: string
  proof: string[]
}

export interface HumanizerInfoTokensType {
  [key: string]: [string, number]
}

export interface HumanizerInfoAbiType {
  constant?: boolean
  payable?: boolean
  anonymous?: boolean
  outputs?: [
    {
      name: string
      type: string
    }
  ]
  inputs?: [
    {
      internalType: string
      name: string
      type: string
    }
  ]
  stateMutability: string
  type: string
}

export type HumanizerInfoAbisKeysType =
  | 'AaveWethGatewayV2'
  | 'PancakeRouter'
  | 'UniV2Router'
  | 'UniV3Router'
  | 'UniV3Router2'
  | 'WETH'
  | 'AaveLendingPoolV2'
  | 'MovrRouter'
  | 'MovrAnyswap'
  | 'ERC721'
  | 'YearnVault'
  | 'IdentityFactory'
  | 'Batcher'
  | 'StakingPool'
  | 'WyvernExchange'
  | 'ERC20'

export type HumanizerInfoAbisType = {
  [key in HumanizerInfoAbisKeysType]: HumanizerInfoAbiType[]
}

export interface HumanizerInfoType {
  abis: HumanizerInfoAbisType
  tokens: HumanizerInfoTokensType
  names: object
  yearnVaults: object[]
  tesseractVaults: object[]
}

export interface AdexToStakingTransfersLogsType {
  jsonrpc: string
  id: number
  result: object[]
}

export interface ConstantsType {
  WALLETInitialClaimableRewards: WALLETInitialClaimableRewardsType[]
  tokenList: object
  humanizerInfo: HumanizerInfoType
  lastFetched: number
}

export interface UseConstantsReturnType {
  constants: ConstantsType | null
  isLoading: boolean
  retryFetch: () => void
  getAdexToStakingTransfersLogsType: () => Promise<AdexToStakingTransfersLogsType | null>
  hasError: boolean
}

export interface ResultEndpointResponse {
  tokenList: ConstantsType['tokenList']
  humanizerInfo: ConstantsType['humanizerInfo']
  WALLETInitialClaimableRewards: ConstantsType['WALLETInitialClaimableRewards']
}
