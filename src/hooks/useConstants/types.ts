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
  inputs: [
    {
      internalType: string
      name: string
      type: string
    }
  ]
  stateMutability: string
  type: string
}

export interface HumanizerInfoAbisType {
  ['AaveWethGatewayV2']: HumanizerInfoAbiType[]
  ['PancakeRouter']: HumanizerInfoAbiType[]
  ['UniV2Router']: HumanizerInfoAbiType[]
  ['UniV3Router']: HumanizerInfoAbiType[]
  ['UniV3Router2']: HumanizerInfoAbiType[]
  ['WETH']: HumanizerInfoAbiType[]
  ['AaveLendingPoolV2']: HumanizerInfoAbiType[]
  ['MovrRouter']: HumanizerInfoAbiType[]
  ['MovrAnyswap']: HumanizerInfoAbiType[]
  ['ERC721']: HumanizerInfoAbiType[]
  ['YearnVault']: HumanizerInfoAbiType[]
  ['IdentityFactory']: HumanizerInfoAbiType[]
  ['Batcher']: HumanizerInfoAbiType[]
  ['StakingPool']: HumanizerInfoAbiType[]
  ['WyvernExchange']: HumanizerInfoAbiType[]
  ['ERC20']: HumanizerInfoAbiType[]
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
  adexToStakingTransfersLogs: AdexToStakingTransfersLogsType
  WALLETInitialClaimableRewards: WALLETInitialClaimableRewardsType[]
  tokenList: object
  humanizerInfo: HumanizerInfoType
  lastFetched: number
}

export interface UseConstantsReturnType {
  constants: ConstantsType | null
  isLoading: boolean
  retryFetch: () => void
  hasError: boolean
}

export interface ResultEndpointResponse {
  tokenList: ConstantsType['tokenList']
  humanizerInfo: ConstantsType['humanizerInfo']
  WALLETInitialClaimableRewards: ConstantsType['WALLETInitialClaimableRewards']
}
