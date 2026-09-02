import { Contract, formatUnits, ZeroAddress } from 'ethers'
import { getAddress } from 'viem'

import IERC20 from '../../../contracts/compiled/IERC20.json'
import IERC721 from '../../../contracts/compiled/IERC721.json'
import { PINNED_TOKENS } from '../../consts/pinnedTokens'
import { Price } from '../../interfaces/assets'
import { Network } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import { AssetType } from '../defiPositions/types'
import { CustomToken, TokenPreference } from './customToken'
import { PORTFOLIO_LIB_ERROR_NAMES } from './errorNames'
import {
  AccountState,
  AssetMetadataFetchPlan,
  AssetValidationReason,
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

const ERC721_INTERFACE_ID = '0x80ac58cd'
const ERC1155_INTERFACE_ID = '0xd9b67a26'

// Not available in the compiled IERC721 ABI
const ERC721_METADATA_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function supportsInterface(bytes4 interfaceId) view returns (bool)'
]

/**
 * Merges every source of ERC-721 hints for a network.
 *
 * An entry without ids marks a collection as enumerable and overrides the exact
 * ids of the other sources, so such an entry is only used for collections no
 * other source knows:
 * - the hidden hints are left out entirely, as hidden collections are already
 * discovered by the other sources
 * - the ids of a custom collection are always requested, as the account may hold
 * a collectible no other source knows about
 * - a custom collection with no ids falls back to being enumerated, but only when
 * the API and the learned assets have no ids for it
 */
export const mergeCollectionHints = ({
  additionalHints,
  apiHints,
  specialHints
}: {
  additionalHints?: ERC721s
  apiHints: ERC721s
  specialHints?: GetOptions['specialErc721Hints']
}): ERC721s => {
  const merged = mergeERC721s([additionalHints || {}, apiHints, specialHints?.learn || {}])
  const custom = specialHints?.custom || {}

  Object.keys(custom).forEach((address) => {
    let checksummed = address

    try {
      checksummed = getAddress(address)
    } catch {
      // Not an address, so it can't be a collection
      return
    }

    const customIds = custom[address] || []

    if (!customIds.length) {
      // Requests the whole collection, unless another source already named ids
      if (!merged[checksummed]?.length) merged[checksummed] = []

      return
    }

    const knownIds = merged[checksummed]

    // The enumerable marker already requests every collectible
    if (knownIds && !knownIds.length) return

    merged[checksummed] = [...new Set([...(knownIds || []), ...customIds])]
  })

  return merged
}

/**
 * The collectibles of a collection that the account should see.
 *
 * A collection added by the user shows only the collectibles they added, so the
 * rest of it doesn't come along with them. Collections added before the ids
 * were recorded have none, which means the whole collection.
 */
export const getVisibleCollectibles = ({
  collectibles,
  customIds,
  hiddenIds
}: {
  collectibles: bigint[]
  customIds?: bigint[]
  hiddenIds?: bigint[]
}) => {
  const added = customIds?.length
    ? collectibles.filter((id) => customIds.includes(id))
    : collectibles

  if (!hiddenIds?.length) return added

  return added.filter((id) => !hiddenIds.includes(id))
}

/**
 * Addresses reach the validation caches from user input, from dApps and from the
 * portfolio, so they are normalized to always resolve to the same entry.
 */
export const normalizeAssetAddress = (address: string) => {
  try {
    return getAddress(address)
  } catch {
    // Not an address, so the raw value is the best key we have
    return address
  }
}

/** Key of a token or a collection in the validation cache */
export const getAssetCacheKey = (address: string, chainId: bigint) =>
  `${normalizeAssetAddress(address)}-${chainId}`

/** Key of a single collectible in the validation cache */
export const getCollectibleCacheKey = (address: string, chainId: bigint, tokenId: bigint) =>
  `${getAssetCacheKey(address, chainId)}-${tokenId}`

/**
 * Decides whether a contract is a collection, based on what it exposes.
 * Extracted so the decision can be tested without a provider.
 */
export const getErc721Validity = ({
  supportsERC721,
  supportsERC1155,
  isContract,
  hasDecimals
}: {
  supportsERC721?: boolean
  supportsERC1155?: boolean
  isContract: boolean
  hasDecimals: boolean
}): { isValid: boolean; reason: AssetValidationReason | null } => {
  // Some collections (e.g. vote-escrow NFTs) expose decimals() too, so this has
  // to be trusted over the checks below
  if (supportsERC721 === true) return { isValid: true, reason: null }

  // Multi edition NFTs are a different standard, which the portfolio can't read.
  // Some of them expose ownerOf() too, so they would pass the checks below.
  if (supportsERC1155 === true) return { isValid: false, reason: 'erc1155-unsupported' }

  if (!isContract) return { isValid: false, reason: 'not-a-collection' }

  if (hasDecimals) return { isValid: false, reason: 'is-a-token' }

  // Whether the account owns collectibles of it doesn't matter, the same way a
  // custom token is added regardless of its balance
  return { isValid: true, reason: null }
}

/**
 * Checks whether the account owns the collectible. Used when a collection can't
 * be listed and the user names one of their collectibles explicitly.
 */
export const validateCollectibleOwnership = async (
  collectible: { address: string; tokenId: bigint },
  accountId: string,
  provider: RPCProvider
): Promise<TokenValidationResult> => {
  const erc721 = new Contract(collectible.address, IERC721.abi, provider)
  const invalid = (
    type: 'network' | 'validation',
    reason: AssetValidationReason
  ): TokenValidationResult => ({
    isValid: false,
    standard: 'erc721',
    error: { message: null, type, reason }
  })

  let owner
  try {
    owner = await erc721.ownerOf!(collectible.tokenId)
  } catch (e: any) {
    console.error('Error while checking the owner of a collectible', e)

    if (isNetworkError(e)) return invalid('network', 'network-problem')

    return invalid('validation', 'collectible-not-found')
  }

  if (typeof owner !== 'string' || owner.toLowerCase() !== accountId.toLowerCase())
    return invalid('validation', 'collectible-not-owned')

  return { isValid: true, standard: 'erc721', error: { message: null, type: null } }
}

/** An ERC-20 token is rejected too, as it also exposes name() and balanceOf() */
export const validateERC721Token = async (
  collection: { address: string; chainId: bigint },
  accountId: string,
  provider: RPCProvider
): Promise<TokenValidationResult> => {
  const metadata = new Contract(collection.address, ERC721_METADATA_ABI, provider)
  const erc20 = new Contract(collection.address, IERC20.abi, provider)

  let hasNetworkError = false
  const handleError = (e: any, operation: string) => {
    console.error('Error during ERC721 validation operation:', operation, e)

    if (isNetworkError(e)) hasNetworkError = true

    return undefined
  }

  const [code, supportsERC721, supportsERC1155, decimals, name, symbol] = await Promise.all([
    provider.getCode(collection.address).catch((e: any) => handleError(e, 'code')),
    metadata.supportsInterface!(ERC721_INTERFACE_ID).catch((e: any) =>
      handleError(e, 'supportsInterface')
    ),
    metadata.supportsInterface!(ERC1155_INTERFACE_ID).catch(() => undefined),
    // Reverting is the expected outcome for a collection, so this isn't an error
    erc20.decimals!().catch(() => undefined),
    // Optional, used for the preview
    metadata.name!().catch(() => undefined),
    metadata.symbol!().catch(() => undefined)
  ])

  if (hasNetworkError)
    return {
      isValid: false,
      standard: 'erc721',
      error: { message: null, type: 'network', reason: 'network-problem' }
    }

  const { isValid, reason } = getErc721Validity({
    supportsERC721,
    supportsERC1155,
    isContract: typeof code === 'string' && code !== '0x',
    hasDecimals: typeof decimals !== 'undefined'
  })

  if (!isValid)
    return {
      isValid: false,
      standard: 'erc721',
      error: { message: null, type: 'validation', reason }
    }

  return {
    isValid: true,
    standard: 'erc721',
    error: { message: null, type: null },
    collection: {
      name: typeof name === 'string' ? name : null,
      symbol: typeof symbol === 'string' ? symbol : null
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

  // A collectible is requested by its id, while an entry without one requests
  // every collectible of the collection (an empty array of ids)
  const addCollectionHint = (
    hints: ERC721s,
    { address, tokenId }: { address: string; tokenId?: bigint }
  ) => {
    if (typeof tokenId !== 'bigint') {
      hints[address] = []
      return
    }

    if (hints[address]?.length === 0) return

    hints[address] = [...(hints[address] || []), tokenId]
  }

  customTokens.forEach((token) => {
    if (token.chainId !== chainId) return

    if (token.standard === 'ERC20') {
      specialErc20Hints.custom.push(token.address)
      return
    }

    if (token.standard === 'ERC721') addCollectionHint(specialErc721Hints.custom, token)
  })

  tokenPreferences.forEach((token) => {
    if (token.chainId !== chainId || !token.isHidden) return

    if (token.standard === 'ERC721') {
      addCollectionHint(specialErc721Hints.hidden, token)
      return
    }

    specialErc20Hints.hidden.push(token.address)
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
  // Split once and collect the enumerable collections up front. Checking for an
  // enumerable key while building the hints would mean scanning every key for
  // every key, and an account with many collections brings thousands of them.
  const parsedKeys: [string, string | undefined][] = []
  const enumerableCollections = new Set<string>()

  keys.forEach((key) => {
    const [collectionAddress, tokenId] = key.split(':')

    if (!collectionAddress) return

    parsedKeys.push([collectionAddress, tokenId])

    if (tokenId === 'enumerable') enumerableCollections.add(collectionAddress)
  })

  parsedKeys.forEach(([collectionAddress, tokenId]) => {
    if (tokenId === 'enumerable') {
      hints[collectionAddress] = []

      return
    }
    // The key already exists as an enumerable hint. Example:
    // collectionA:enumerable exists and collectionB:id is attempted to be added
    // (it shouldn't be)
    if (enumerableCollections.has(collectionAddress)) {
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

/**
 * How long stored token metadata is trusted before it is read from the chain again.
 * Symbols and names do change on rare occasions, such as a token rebrand behind an
 * upgradeable proxy.
 */
export const TOKEN_METADATA_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000

/**
 * Whether the chain has to be asked for an asset's metadata (a token's symbol, name
 * and decimals, or a collection's name and symbol). True when nothing is stored for
 * it, or when what is stored has aged out.
 */
export function isAssetMetadataStale(
  entry: { fetchedAt: number } | undefined,
  now: number
): boolean {
  if (!entry) return true

  return now - entry.fetchedAt > TOKEN_METADATA_MAX_AGE_MS
}

/**
 * Splits the passed addresses into the metadata already held for them and the ones
 * whose metadata has to be read on this update. The map is copied, so that an update in
 * flight keeps the metadata it started with even if the caller's store drops entries in
 * the meantime.
 */
export function planAssetMetadata<T extends { fetchedAt: number }>(
  addresses: string[],
  known: Map<string, T> | undefined,
  now: number
): AssetMetadataFetchPlan<T> {
  const plan: AssetMetadataFetchPlan<T> = { known: new Map(), needsMetadata: new Set() }

  addresses.forEach((address) => {
    const entry = known?.get(address)

    if (!entry || isAssetMetadataStale(entry, now)) {
      plan.needsMetadata.add(address)
      return
    }

    plan.known.set(address, entry)
  })

  return plan
}
