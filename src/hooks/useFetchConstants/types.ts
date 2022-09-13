export interface UseFetchConstantsProps {
  fetch: any
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

export interface HumanizerInfoAbisType {
  ['AaveWethGatewayV2']: object[]
  ['PancakeRouter']: object[]
  ['UniV2Router']: object[]
  ['UniV3Router']: object[]
  ['UniV3Router2']: object[]
  ['WETH']: object[]
  ['AaveLendingPoolV2']: object[]
  ['MovrRouter']: object[]
  ['MovrAnyswap']: object[]
  ['ERC721']: object[]
  ['YearnVault']: object[]
  ['IdentityFactory']: object[]
  ['Batcher']: object[]
  ['StakingPool']: object[]
  ['WyvernExchange']: object[]
  ['ERC20']: object[]
}

export interface HumanizerInfoType {
  abis: HumanizerInfoAbisType
  tokens: HumanizerInfoTokensType
  names: object
  yearnVaults: object[]
  tesseractVaults: object[]
}

export interface ConstantsType {
  adexToStakingTransfersLogs: {
    jsonrpc: string
    id: number
    result: object[]
  }
  WALLETInitialClaimableRewards: WALLETInitialClaimableRewardsType[]
  tokenList: object
  humanizerInfo: HumanizerInfoType
}

export interface UseFetchConstantsReturnType {
  constants: ConstantsType | null
  isLoading: boolean
}
