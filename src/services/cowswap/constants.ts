export const COWSWAP_API_BASE_URL = 'https://api.cow.fi'

export const COWSWAP_SETTLEMENT_ADDRESS = '0x9008D19f58AAbD9eD0D60971565AA8510560ab41'

export const COWSWAP_VAULT_RELAYER_ADDRESS = '0xC92E8bdf79f0507f65a392b0ab4667716BFE0110'

export const COWSWAP_ETH_FLOW_ADDRESS = '0xbA3cB449bD2B4ADddBc894D8697F5170800EAdeC'

export const COWSWAP_BUY_NATIVE_TOKEN_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

export const COWSWAP_EXPLORER_URL = 'https://explorer.cow.fi'

export const COWSWAP_SUPPORTED_CHAINS: {
  chainId: number
  apiNetwork: string
  wrappedNativeTokenAddress: string
}[] = [
  {
    chainId: 1,
    apiNetwork: 'mainnet',
    wrappedNativeTokenAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
  },
  {
    chainId: 56,
    apiNetwork: 'bnb',
    wrappedNativeTokenAddress: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'
  },
  {
    chainId: 100,
    apiNetwork: 'xdai',
    wrappedNativeTokenAddress: '0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d'
  },
  {
    chainId: 137,
    apiNetwork: 'polygon',
    wrappedNativeTokenAddress: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270'
  },
  {
    chainId: 8453,
    apiNetwork: 'base',
    wrappedNativeTokenAddress: '0x4200000000000000000000000000000000000006'
  },
  {
    chainId: 9745,
    apiNetwork: 'plasma',
    wrappedNativeTokenAddress: '0x6100E367285b01F48D07953803A2d8dCA5D19873'
  },
  {
    chainId: 42161,
    apiNetwork: 'arbitrum_one',
    wrappedNativeTokenAddress: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'
  },
  {
    chainId: 43114,
    apiNetwork: 'avalanche',
    wrappedNativeTokenAddress: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7'
  },
  {
    chainId: 57073,
    apiNetwork: 'ink',
    wrappedNativeTokenAddress: '0x4200000000000000000000000000000000000006'
  },
  {
    chainId: 59144,
    apiNetwork: 'linea',
    wrappedNativeTokenAddress: '0xe5D7C2a44FfDDf6b295A15c148167daaAf5Cf34f'
  }
]

export const COWSWAP_ORDER_VALIDITY_SECONDS = 30 * 60

export const COWSWAP_APP_DATA_VERSION = '1.4.0'

export const COWSWAP_APP_CODE = 'Ambire'
