export const COWSWAP_API_BASE_URL = 'https://api.cow.fi'

export const COWSWAP_SETTLEMENT_ADDRESS = '0x9008D19f58AAbD9eD0D60971565AA8510560ab41'

export const COWSWAP_VAULT_RELAYER_ADDRESS = '0xC92E8bdf79f0507f65a392b0ab4667716BFE0110'

export const COWSWAP_BUY_NATIVE_TOKEN_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

export const COWSWAP_EXPLORER_URL = 'https://explorer.cow.fi'

export const COWSWAP_SUPPORTED_CHAINS: { chainId: number; apiNetwork: string }[] = [
  { chainId: 1, apiNetwork: 'mainnet' },
  { chainId: 56, apiNetwork: 'bnb' },
  { chainId: 100, apiNetwork: 'xdai' },
  { chainId: 137, apiNetwork: 'polygon' },
  { chainId: 8453, apiNetwork: 'base' },
  { chainId: 9745, apiNetwork: 'plasma' },
  { chainId: 42161, apiNetwork: 'arbitrum_one' },
  { chainId: 43114, apiNetwork: 'avalanche' },
  { chainId: 57073, apiNetwork: 'ink' },
  { chainId: 59144, apiNetwork: 'linea' },
  { chainId: 11155111, apiNetwork: 'sepolia' }
]

export const COWSWAP_ORDER_VALIDITY_SECONDS = 30 * 60

export const COWSWAP_APP_DATA_VERSION = '1.4.0'

export const COWSWAP_APP_CODE = 'Ambire'
