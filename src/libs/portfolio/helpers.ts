import { Contract, formatUnits, ZeroAddress } from 'ethers'
import { getAddress } from 'viem'

import IERC20 from '../../../contracts/compiled/IERC20.json'
import { PINNED_TOKENS } from '../../consts/pinnedTokens'
import { Price } from '../../interfaces/assets'
import { Network } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import { AssetType } from '../defiPositions/types'
import { CustomToken, TokenPreference } from './customToken'
import { PORTFOLIO_LIB_ERROR_NAMES } from './errorNames'
import {
  AccountState,
  ERC721s,
  ExtendedErrorWithLevel,
  ExternalAPITokenMarketDataResponse,
  ExternalHintsAPIResponse,
  FormattedExternalHintsAPIResponse,
  GetOptions,
  Hints,
  NetworkState,
  PortfolioGasTankResult,
  PortfolioNetworkResult,
  ToBeLearnedAssets,
  TokenDataCacheValue,
  TokenResult,
  TokenValidationResult,
  Total
} from './interfaces'

const usdcEMapping: { [key: string]: string } = {
  '43114': '0xa7d7079b0fead91f3e65f86e8915cb59c1a4c664',
  '1285': '0x748134b5f553f2bcbd78c6826de99a70274bdeb3',
  '42161': '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
  '137': '0x2791bca1f2de4661ed88a30c99a7a9449aa84174',
  '10': '0x7f5c764cbc14f9669b88837ca1490cca17c31607'
}

export function overrideSymbol(address: string, chainId: bigint, symbol: string) {
  // Since deployless lib calls contract and USDC.e is returned as USDC, we need to override the symbol
  if (
    usdcEMapping[chainId.toString()] &&
    usdcEMapping[chainId.toString()]!.toLowerCase() === address.toLowerCase()
  ) {
    return 'USDC.E'
  }

  return symbol
}

export function mergeERC721s(sources: ERC721s[]): ERC721s {
  const result: ERC721s = {}

  // Get all unique addresses
  const addresses = new Set(sources.flatMap((source) => Object.keys(source)))

  addresses.forEach((address) => {
    try {
      const checksummed = getAddress(address)

      const hasEnumerableHint = sources.some(
        (source) => source[address] && source[address].length === 0
      )

      if (hasEnumerableHint) {
        result[checksummed] = []
        return
      }

      // Merge arrays and remove duplicates
      const merged: bigint[] = Array.from(
        new Set(sources.flatMap((source) => source[checksummed] || []))
      )

      result[checksummed] = merged
    } catch (e: any) {
      console.error('Error checksumming ERC-721 collection address', e)
    }
  })

  return result
}

/**
 * Determines whether an error is related to network connectivity issues rather than validation failures.
 *
 * This function helps distinguish between temporary network problems (which should allow retries)
 * and actual token validation errors (which indicate the token is genuinely invalid).
 *
 */
const isNetworkError = (error: any): boolean => {
  if (!error) return false

  const message = error.message?.toLowerCase() || ''
  const errorCode = error.code

  // Common network error patterns
  const networkErrorPatterns = [
    'network error',
    'network request failed',
    'fetch failed',
    'connection refused',
    'timeout',
    'econnrefused',
    'enotfound',
    'etimedout',
    'socket hang up',
    'request timeout',
    'failed to fetch',
    'networkerror'
  ]

  // Common network error codes
  const networkErrorCodes = ['NETWORK_ERROR', 'TIMEOUT', 'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT']

  return (
    networkErrorPatterns.some((pattern) => message.includes(pattern)) ||
    networkErrorCodes.includes(errorCode)
  )
}

/**
 * Executes async functions with limited concurrency to prevent overwhelming RPC providers
 */
const limitConcurrency = async <T>(
  items: T[],
  asyncFn: (item: T) => Promise<any>,
  limit: number = 5
): Promise<any[]> => {
  const results: any[] = []

  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit)
    const batchPromises = batch.map(asyncFn)

    const batchResults = await Promise.allSettled(batchPromises)

    results.push(
      ...batchResults.map((result) => (result.status === 'fulfilled' ? result.value : null))
    )
  }

  return results
}

/**
 * Validates whether a token address represents a valid ERC20 token on the specified network.
 * Optionally suggests alternative networks where the token is found if validation fails.
 *
 */
export const validateERC20Token = async (
  token: { address: string; chainId: bigint },
  accountId: string,
  provider: RPCProvider,
  options?: {
    allNetworks?: Network[]
    allProviders?: { [chainId: string]: RPCProvider }
    enableNetworkDetection?: boolean
    maxNetworksToCheck?: number
    concurrencyLimit?: number
  }
): Promise<TokenValidationResult> => {
  const {
    allNetworks,
    allProviders,
    enableNetworkDetection = false,
    maxNetworksToCheck = 10,
    concurrencyLimit = 3
  } = options || {}
  const erc20 = new Contract(token?.address, IERC20.abi, provider)

  let isValid = true
  let hasNetworkError = false
  let message = ''
  let type: 'network' | 'validation' | null = null

  const handleERC20Error = (e: any, operation: string) => {
    console.error('Error during ERC20 validation operation:', operation, e)
    if (isNetworkError(e)) {
      hasNetworkError = true
      isValid = false
      type = 'network'
      message = `Network error validating token: ${
        e.message || `Network error while fetching token ${operation}`
      }`
    } else {
      isValid = false
      type = 'validation'
      message = 'This token type is not supported'
    }
  }

  let balance
  let symbol
  let decimals
  try {
    ;[balance, symbol, decimals] = await Promise.all([
      erc20.balanceOf!(accountId).catch((e) => handleERC20Error(e, 'balance')),
      erc20.symbol!().catch((e) => handleERC20Error(e, 'symbol')),
      erc20.decimals!().catch((e) => handleERC20Error(e, 'decimals'))
    ])
  } catch (e) {
    handleERC20Error(e, 'token validation')
  }

  if (
    typeof balance === 'undefined' ||
    typeof symbol === 'undefined' ||
    typeof decimals === 'undefined'
  ) {
    // Only mark as invalid if it's not a network error
    if (!hasNetworkError) {
      isValid = false
      if (!message) {
        message = 'Token validation failed: unable to fetch required token data'
        type = 'validation'
      }
    }
  } else if (!hasNetworkError) {
    // Reset error state only if validation succeeded AND there was no network error
    isValid = true
    message = ''
    type = null
  }

  // If validation failed and network detection is enabled, check other networks
  if (!isValid && !hasNetworkError && enableNetworkDetection && allNetworks && allProviders) {
    try {
      // Get candidate networks and limit the number to check
      const candidateNetworks = allNetworks
        .filter((network) => allProviders[network.chainId.toString()]?.isWorking !== false)
        .filter((network) => network.chainId !== token.chainId) // Skip the current network
        .slice(0, maxNetworksToCheck) // Limit the number of networks to check

      // Use concurrency-limited validation to prevent overwhelming RPC providers
      const validationFunction = async (network: Network) => {
        try {
          const networkProvider = allProviders[network.chainId.toString()]
          if (!networkProvider) return null

          // Use validateERC20Token without network detection to avoid circular dependency
          const validation = await validateERC20Token(
            { address: token.address, chainId: network.chainId },
            accountId,
            networkProvider,
            { enableNetworkDetection: false }
          )

          return validation.isValid ? network : null
        } catch (error) {
          return null
        }
      }

      const results = await limitConcurrency(
        candidateNetworks,
        validationFunction,
        concurrencyLimit
      )
      const validNetworks = results.filter((network): network is Network => network !== null)

      if (validNetworks.length > 0) {
        const networkNames = validNetworks.map((net) => net.name).join(', ')
        message = `This token is found on ${networkNames}. Is the correct network selected?`
        type = 'validation'
      }
    } catch (networkDetectionError) {
      // Network detection failed, but don't override the original error
      console.warn('Network detection failed:', networkDetectionError)
    }
  }

  return {
    isValid,
    standard: 'erc20',
    error: {
      message: message || null,
      type
    }
  }
}

// fetch the amountPostSimulation for the token if set
// otherwise, the token.amount
export const getTokenAmount = (token: TokenResult, beforeSimulation?: boolean): bigint => {
  if (beforeSimulation) return token.amount

  return typeof token.amountPostSimulation === 'bigint' ? token.amountPostSimulation : token.amount
}

export const getTokenUsdPrice = (token: TokenResult) =>
  token.priceIn.find(({ baseCurrency }) => baseCurrency === 'usd')?.price || 0

export const getTokenBalanceInUSD = (token: TokenResult) => {
  const amount = getTokenAmount(token)
  const { decimals } = token
  const balance = parseFloat(formatUnits(amount, decimals))
  const price = getTokenUsdPrice(token)

  return balance * price
}

export const getTotal = (
  t: TokenResult[],
  defiState: PortfolioNetworkResult['defiPositions'] | null,
  opts?: {
    includeHiddenTokens?: boolean
    beforeSimulation?: boolean
  }
) => {
  const { includeHiddenTokens = false, beforeSimulation = false } = opts || {}

  const tokensTotal = t.reduce((cur: { [key: string]: number }, token: TokenResult) => {
    const localCur = cur // Add index signature to the type of localCur
    if (token.flags.isHidden && !includeHiddenTokens) return localCur

    for (const x of token.priceIn) {
      const currentAmount = localCur[x.baseCurrency] || 0

      const tokenAmount = Number(getTokenAmount(token, beforeSimulation)) / 10 ** token.decimals
      const total = tokenAmount * x.price

      // Prevents the whole balance of the portfolio becoming NaN if one token has invalid total
      if (typeof total !== 'number' || Number.isNaN(total)) {
        console.error(
          `Invalid total for token ${token.symbol} (${token.address}) on chain ${token.chainId}`,
          'Price:',
          x,
          'Amount:',
          tokenAmount
        )

        continue
      }

      localCur[x.baseCurrency] = currentAmount + total
    }

    return localCur
  }, {})

  let defiTotal: Total = {
    usd: 0
  }

  if (defiState) {
    // The portfolio handles at least one collateral token,
    // thus we must exclude them from the defi total to avoid double counting
    const positionsToExclude: string[] = t
      .filter(
        (token) =>
          token.flags.defiPositionId &&
          token.flags.defiTokenType === AssetType.Collateral &&
          // If the token doesn't have a price we must add the value from the position to the total
          token.priceIn.length > 0
      )
      .map((token) => token.flags.defiPositionId!)

    defiTotal = defiState.positionsByProvider.reduce(
      (cur, position) => {
        const positionsFlat = position.positions.flat()

        positionsFlat.forEach((p) => {
          // stkWallet is an internal position, created from the stkWallet token
          if (positionsToExclude.includes(p.id) || p.id === 'stk-wallet') return

          cur.usd += p.additionalData.positionInUSD || 0
        })

        return cur
      },
      { usd: 0 }
    )
  }

  // In case the user doesn't have any tokens or the function is calculating for the custom
  // network `defiApps` that doesn't have any tokens
  if (!Object.keys(tokensTotal).length && Object.keys(defiTotal).length > 0) {
    return defiTotal
  }

  return Object.keys(tokensTotal).reduce((cur, key) => {
    cur[key] = (tokensTotal[key] || 0) + (defiTotal[key] || 0)

    return cur
  }, {} as Total)
}

export const addHiddenTokenValueToTotal = (
  totalWithoutHiddenTokens: number,
  tokens: TokenResult[]
) => {
  return tokens.reduce((cur: number, token: TokenResult) => {
    if (!token.flags.isHidden) return cur

    return cur + getTokenBalanceInUSD(token)
  }, totalWithoutHiddenTokens)
}

export const getAccountPortfolioTotal = (
  accountPortfolio: AccountState,
  excludeNetworks: string[] = [],
  excludeHiddenTokens = true
) => {
  if (!accountPortfolio) return 0

  return Object.keys(accountPortfolio).reduce((acc, chainId) => {
    if (excludeNetworks.includes(chainId)) return acc

    const networkData = accountPortfolio[chainId]
    const tokenList = networkData?.result?.tokens || []
    let networkTotalAmountUSD = networkData?.result?.total.usd || 0

    if (!excludeHiddenTokens) {
      networkTotalAmountUSD = addHiddenTokenValueToTotal(networkTotalAmountUSD, tokenList)
    }

    return acc + networkTotalAmountUSD
  }, 0)
}

/**
 * Formats and strips the original velcro response
 */
export const formatExternalHintsAPIResponse = (
  response: Omit<ExternalHintsAPIResponse, 'prices'> | null
): FormattedExternalHintsAPIResponse | null => {
  if (!response) return null

  const { erc20s, erc721s, lastUpdate, hasHints } = response

  // For customAppChain
  if (!erc20s || !erc721s) {
    return null
  }

  const formattedErc721s: Hints['erc721s'] = {}

  Object.entries(erc721s).forEach(([collectionAddress, value]) => {
    if (!('tokens' in value)) {
      formattedErc721s[collectionAddress] = []
      return
    }

    formattedErc721s[collectionAddress] = value.tokens.map((id) => BigInt(id))
  })

  return {
    erc20s,
    erc721s: formattedErc721s,
    lastUpdate,
    hasHints
  }
}

export const getSpecialHints = (
  chainId: Network['chainId'],
  customTokens: CustomToken[],
  tokenPreferences: TokenPreference[],
  toBeLearnedAssets: ToBeLearnedAssets
) => {
  const specialErc20Hints: GetOptions['specialErc20Hints'] = {
    custom: [],
    hidden: [],
    learn: []
  }
  const specialErc721Hints: GetOptions['specialErc721Hints'] = {
    custom: {},
    hidden: {},
    learn: {}
  }
  const networkToBeLearnedTokens: ToBeLearnedAssets['erc20s'][string] =
    toBeLearnedAssets.erc20s?.[chainId.toString()] || []
  const networkToBeLearnedNfts: ToBeLearnedAssets['erc721s'][string] =
    toBeLearnedAssets.erc721s?.[chainId.toString()] || {}

  customTokens.forEach((token) => {
    if (token.chainId === chainId && token.standard === 'ERC20') {
      specialErc20Hints.custom.push(token.address)
    }
  })

  tokenPreferences.forEach((token) => {
    if (token.chainId === chainId && token.isHidden) {
      specialErc20Hints.hidden.push(token.address)
    }
  })

  if (networkToBeLearnedTokens) {
    networkToBeLearnedTokens.forEach((token) => {
      specialErc20Hints.learn.push(token)
    })
  }

  if (networkToBeLearnedNfts) {
    specialErc721Hints.learn = networkToBeLearnedNfts
  }

  return {
    specialErc20Hints,
    specialErc721Hints
  }
}

/**
 * Converts ERC721 hints to keys that can be used for:
 * - comparison of NFTs
 * - storage
 */
export const erc721CollectionToLearnedAssetKeys = (collection: [string, bigint[]]): string[] => {
  const [collectionAddress, tokenIds] = collection

  if (!tokenIds.length) return [`${collectionAddress}:enumerable`]

  return tokenIds.map((id) => `${collectionAddress}:${id}`)
}

/**
 * Converts `LearnedAssets` ERC721 hint keys to
 * `ERC721` hints. For more info, see `LearnedAssets`
 */
export const learnedErc721sToHints = (keys: string[]): ERC721s => {
  const hints: ERC721s = {}

  keys.forEach((key) => {
    const [collectionAddress, tokenId] = key.split(':')

    if (!collectionAddress) return

    if (tokenId === 'enumerable') {
      hints[collectionAddress] = []

      return
    }
    // The key already exists as an enumerable hint. Example:
    // collectionA:enumerable exists and collectionB:id is attempted to be added
    // (it shouldn't be)
    if (keys.includes(`${collectionAddress}:enumerable`)) {
      return
    }

    if (typeof tokenId !== 'string') return

    if (!hints[collectionAddress]) {
      hints[collectionAddress] = []
    }

    hints[collectionAddress].push(BigInt(tokenId))
  })

  return hints
}

export const tokenFilter = (
  token: TokenResult,
  network: Network,
  isToBeLearned: boolean,
  shouldIncludePinned: boolean,
  nativeToken?: TokenResult
): boolean => {
  // Never add ERC20 tokens that represent the network's native token.
  // For instance, on Polygon, we have this token: `0x0000000000000000000000000000000000001010`.
  // It mimics the native POL token (same symbol, same amount) and is shown twice in the Dashboard.
  // From a user's perspective, the token is duplicated and counted twice in the balance.
  const isERC20NativeRepresentation =
    !!nativeToken &&
    (token.symbol === nativeToken.symbol ||
      network.oldNativeAssetSymbols?.includes(token.symbol)) &&
    token.amount === nativeToken.amount &&
    token.address !== ZeroAddress

  if (isERC20NativeRepresentation) return false

  // always include tokens added as a preference
  if (token.flags.isHidden || token.flags.isCustom || isToBeLearned) return true

  // always include > 0 amount and native token
  if (token.amount > 0 || token.address === ZeroAddress) return true

  const isPinned = !!PINNED_TOKENS.find((pinnedToken) => {
    return pinnedToken.chainId === network.chainId && pinnedToken.address === token.address
  })

  // if the amount is 0
  // return the token if it's pinned and requested
  const pinnedRequested = isPinned && !!shouldIncludePinned

  return pinnedRequested
}

export const isPortfolioGasTankResult = (
  result: NetworkState['result']
): result is PortfolioGasTankResult => {
  return !!result && 'gasTankTokens' in result && Array.isArray(result.gasTankTokens)
}

export const isNative = (token: TokenResult) =>
  token.address === ZeroAddress && !token.flags.onGasTank

export const getHintsError = (
  errorMessage: string,
  lastExternalApiHintsData: {
    lastUpdate: number
    hasHints: boolean
  } | null
): ExtendedErrorWithLevel => {
  if (!lastExternalApiHintsData) {
    return {
      name: PORTFOLIO_LIB_ERROR_NAMES.NoApiHintsError,
      message: errorMessage,
      level: 'critical'
    }
  }

  const TEN_MINUTES = 10 * 60 * 1000

  const lastUpdate = lastExternalApiHintsData.lastUpdate

  const isLastUpdateTooOld = Date.now() - lastUpdate > TEN_MINUTES

  return {
    name: isLastUpdateTooOld
      ? PORTFOLIO_LIB_ERROR_NAMES.StaleApiHintsError
      : PORTFOLIO_LIB_ERROR_NAMES.NonCriticalApiHintsError,
    message: errorMessage,
    level: isLastUpdateTooOld ? 'critical' : 'silent'
  }
}

export const getHardcodedCitreaPrices = (address: string): Price | null => {
  const stables = [
    '0x8D82c4E3c936C7B5724A382a9c5a4E6Eb7aB6d5D',
    '0xE045e6c36cF77FAA2CfB54466D71A3aEF7bbE839',
    '0x9f3096Bac87e7F03DC09b0B416eB0DF837304dc4'
  ]
  if (stables.indexOf(address) !== -1) {
    return {
      baseCurrency: 'usd',
      price: 1
    }
  }

  return null
}

export const convertApiTokenDataToTokenDataCache = (
  tokenData: ExternalAPITokenMarketDataResponse | null
): TokenDataCacheValue => {
  if (!tokenData) {
    return {
      priceIn: [],
      marketDataIn: []
    }
  }

  const baseCurrency = (tokenData.baseCurrency || 'usd') as 'usd' // stop ts from complaining, we only support usd as base currency for now
  const price = (tokenData.price || tokenData.usd) as number | undefined

  const baseCurrency24hChange = tokenData[`${baseCurrency}_24h_change`]
  const baseCurrency24hVolume = tokenData[`${baseCurrency}_24h_vol`]
  const baseCurrencyMarketCap = tokenData[`${baseCurrency}_market_cap`]
  const fullyDilutedValuation = tokenData[`${baseCurrency}_fully_diluted_valuation`]
  const website = tokenData.homepage ? tokenData.homepage[0] : undefined

  return {
    priceIn: typeof price === 'number' ? [{ baseCurrency, price }] : [],
    marketDataIn: [
      {
        baseCurrency,
        change24h: baseCurrency24hChange,
        volume24h: baseCurrency24hVolume,
        marketCap: baseCurrencyMarketCap,
        fullyDilutedValuation: fullyDilutedValuation,
        totalSupply: tokenData.total_supply
      }
    ],
    meta: {
      exchanges: tokenData.exchanges || [],
      website: website
    }
  }
}
