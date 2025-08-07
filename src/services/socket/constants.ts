import { SwapAndBridgeToToken } from '../../interfaces/swapAndBridge'

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
// Some services (like Socket) use the null token address to represent the
// native token as the ZERO_ADDRESS is not standard for it.
export const NULL_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

export const ETH_ON_OPTIMISM_LEGACY_ADDRESS = '0xdeaddeaddeaddeaddeaddeaddeaddeaddead0000'

/**
 * The % of fee to be cut from the source input token amount.
 * Can be up to three decimal places and cannot be more than 5%.
 */
export const FEE_PERCENT = 0.25

const AMBIRE_WALLET_TOKEN_COMMON_PROPS = {
  name: 'Ambire Wallet',
  symbol: 'WALLET',
  decimals: 18,
  icon: '' // will fallback to get the icon from the same place as the portfolio
}

export const AMBIRE_WALLET_TOKEN_ON_ETHEREUM: SwapAndBridgeToToken = {
  chainId: 1,
  address: '0x88800092fF476844f74dC2FC427974BBee2794Ae',
  ...AMBIRE_WALLET_TOKEN_COMMON_PROPS
}

export const AMBIRE_WALLET_TOKEN_ON_BASE: SwapAndBridgeToToken = {
  chainId: 8453,
  address: '0x0BbbEad62f7647AE8323d2cb243A0DB74B7C2b80',
  ...AMBIRE_WALLET_TOKEN_COMMON_PROPS
}

export const AMBIRE_FEE_TAKER_ADDRESSES: { [chainId: number]: string } = {
  324: '0x942f9CE5D9a33a82F88D233AEb3292E680230348',
  1101: '0x942f9CE5D9a33a82F88D233AEb3292E680230348',
  5000: '0x942f9CE5D9a33a82F88D233AEb3292E680230348',
  34443: '0x942f9CE5D9a33a82F88D233AEb3292E680230348',
  43114: '0x942f9CE5D9a33a82F88D233AEb3292E680230348',
  59144: '0x942f9CE5D9a33a82F88D233AEb3292E680230348',
  534352: '0x942f9CE5D9a33a82F88D233AEb3292E680230348',
  1313161554: '0x942f9CE5D9a33a82F88D233AEb3292E680230348',
  81457: '0x942f9CE5D9a33a82F88D233AEb3292E680230348',
  1: '0xDCe4f65Aa650B3FaFEa9892E807C1770d6e9c618',
  10: '0xDA1c734b7843f18E9B1A25Bb997A45975315C001',
  137: '0xDA1c734b7843f18E9B1A25Bb997A45975315C001',
  8453: '0xDA1c734b7843f18E9B1A25Bb997A45975315C001',
  56: '0xDA1c734b7843f18E9B1A25Bb997A45975315C001',
  42161: '0xDA1c734b7843f18E9B1A25Bb997A45975315C001',
  100: '0xDA1c734b7843f18E9B1A25Bb997A45975315C001',
  7777777: '0xDA1c734b7843f18E9B1A25Bb997A45975315C001'
}
