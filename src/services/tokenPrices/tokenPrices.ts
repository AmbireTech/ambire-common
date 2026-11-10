import { geckoIdMapper } from '../../consts/coingecko'
import { AMBIRE_API_TIMEOUT } from '../../consts/portfolio'
import { getPrivacyPoolsChainConfig } from '../../consts/privacyPools'
import { Fetch } from '../../interfaces/fetch'
import { Network } from '../../interfaces/network'
import {
  convertApiTokenDataToTokenDataCache,
  getTokenDataCacheKey
} from '../../libs/portfolio/helpers'
import {
  ExternalAPITokenMarketDataResponse,
  TokenDataCache,
  TokenDataCacheValue
} from '../../libs/portfolio/interfaces'
import { fetchWithTimeout } from '../../utils/fetch'
import { paginate } from '../../utils/paginate'

const CENA_API_URL = 'https://cena.ambire.com'
// max tokens per request; we seem to have faster results when it's lower
const BATCH_LIMIT = 40

/**
 * The feature a token list comes from. Each feature's latest list is remembered per
 * account and network, and every request for that account and network carries all of them.
 */
export type TokenPriceSource = 'portfolio' | 'defi'

export type GetTokenDataParams = {
  network: Network
  tokenAddresses: string[]
  /**
   * The account the tokens belong to. A request carries every token remembered for this
   * account, never tokens of another account. Left out for lookups that belong to no
   * account, in which case only the requested tokens and the Privacy Pools assets are sent.
   */
  accountAddr?: string
  /** Remembers `tokenAddresses` as this feature's token list for the account */
  source?: TokenPriceSource
  /** Cached prices younger than this are used instead of requesting them again */
  maxAgeMs: number
  /** When the request fails, cached prices younger than this are returned instead */
  maxAgeOnFailureMs?: number
  /** Requests the prices even if all of them are cached */
  ignoreCache?: boolean
  baseCurrency?: string
}

export type GetTokenDataResult = {
  /** Keyed by the lowercased token address. Tokens without a known price are left out. */
  tokenData: Map<string, TokenDataCacheValue>
  error: Error | null
}

/** A single cena request and the tokens (in their original casing) it asks for */
export type TokenPriceRequest = { url: string; tokenAddresses: string[] }

/**
 * Lowercases, deduplicates and sorts the addresses, keeping the casing they were first
 * passed with, as some token ids are mapped by their checksummed address (see `geckoIdMapper`).
 * Sorting makes a request for the same tokens always split into the same pages.
 */
const getUniqueSortedAddresses = (addresses: string[]): string[] => {
  const addressByKey = new Map<string, string>()

  addresses.forEach((address) => {
    const key = getTokenDataCacheKey(address)
    if (!addressByKey.has(key)) addressByKey.set(key, address)
  })

  return [...addressByKey.entries()]
    .sort(([keyA], [keyB]) => (keyA < keyB ? -1 : 1))
    .map(([, address]) => address)
}

/**
 * Splits the tokens into cena requests: native (and a few aliased) tokens are looked up by
 * their CoinGecko coin id, the rest by contract address on the network's CoinGecko platform,
 * in pages of BATCH_LIMIT.
 */
export const getTokenPriceRequests = (
  network: Network,
  tokenAddresses: string[],
  baseCurrency: string
): TokenPriceRequest[] => {
  const tokensWithCoinId: string[] = []
  const tokensWithContractAddress: string[] = []

  tokenAddresses.forEach((address) => {
    if (geckoIdMapper(address, network)) tokensWithCoinId.push(address)
    else tokensWithContractAddress.push(address)
  })

  // The ids are joined by a literal comma, never the pre-encoded %2C. Mobile puts the url
  // through a percent-encoding pass when it carries characters that are invalid in a url, and
  // that turns %2C into %252C - cena then reads the list as one malformed id and answers `{}`
  // with a 200, so the request looks successful and every id in it comes back unpriced.
  const coinIdRequests = paginate(tokensWithCoinId, BATCH_LIMIT).map((page) => {
    const coinIds = [...new Set(page.map((address) => geckoIdMapper(address, network)!))]

    return {
      url: `${CENA_API_URL}/api/v3/simple/price?ids=${coinIds.join(
        ','
      )}&vs_currencies=${baseCurrency}`,
      tokenAddresses: page
    }
  })

  const contractRequests = network.platformId
    ? paginate(tokensWithContractAddress, BATCH_LIMIT).map((page) => ({
        url: `${CENA_API_URL}/api/v3/simple/token_price/${
          network.platformId
        }?contract_addresses=${page
          .map(getTokenDataCacheKey)
          .join(',')}&vs_currencies=${baseCurrency}`,
        tokenAddresses: page
      }))
    : []

  return [...coinIdRequests, ...contractRequests]
}

/** The key cena answers a token under: its CoinGecko coin id, or its lowercased address */
const getResponseKey = (address: string, network: Network): string =>
  geckoIdMapper(address, network) || getTokenDataCacheKey(address)

const getRequestKey = (chainId: bigint, accountAddr?: string): string =>
  `${chainId.toString()}:${accountAddr ? accountAddr.toLowerCase() : ''}`

const EMPTY_RESULT = (): GetTokenDataResult => ({ tokenData: new Map(), error: null })

/**
 * The only place that asks our price API (cena) for token prices, and the cache they are kept in.
 *
 * Every request for an account and network carries the account's whole token list (from every
 * feature that priced tokens through it) together with the Privacy Pools assets, so that no
 * request reveals what a single feature or action is about. Requests never carry the tokens of
 * more than one account.
 *
 * Nothing is requested, read or stored while the user has opted out of token prices.
 */
export class TokenPricesService {
  #fetch: Fetch

  #isTokenPricesEnabled: () => boolean

  #timeoutMs: number

  /** chainId -> token data cache, shared by all accounts */
  #cacheByChainId = new Map<string, TokenDataCache>()

  /** `${chainId}:${account}` -> the latest token list of each feature */
  #accountTokensByRequestKey = new Map<string, Map<TokenPriceSource, string[]>>()

  /** `${chainId}:${account}` -> the request in flight, so that an account sends one at a time */
  #requestsInFlight = new Map<string, Promise<void>>()

  constructor({
    fetch,
    isTokenPricesEnabled = () => true,
    timeoutMs = AMBIRE_API_TIMEOUT
  }: {
    fetch: Fetch
    isTokenPricesEnabled?: () => boolean
    timeoutMs?: number
  }) {
    this.#fetch = fetch
    this.#isTokenPricesEnabled = isTokenPricesEnabled
    this.#timeoutMs = timeoutMs
  }

  /**
   * Returns the prices of the given tokens. They come from the cache when all of them were
   * answered (with a price or with "no price") within `maxAgeMs`; otherwise (or with
   * `ignoreCache`) the account's whole token list is requested again and cached.
   */
  async getTokenData(params: GetTokenDataParams): Promise<GetTokenDataResult> {
    const {
      network,
      accountAddr,
      source,
      maxAgeMs,
      maxAgeOnFailureMs = 0,
      ignoreCache = false,
      baseCurrency = 'usd'
    } = params

    if (!this.#getIsEnabled()) return EMPTY_RESULT()

    const tokenAddresses = getUniqueSortedAddresses(params.tokenAddresses)
    const requestKey = getRequestKey(network.chainId, accountAddr)
    const callStartedAt = Date.now()
    const isFresh = (cachedAt: number) => callStartedAt - cachedAt <= maxAgeMs

    if (accountAddr && source) this.#rememberAccountTokens(requestKey, source, tokenAddresses)

    const freshTokenData = this.#readTokenData(network, tokenAddresses, baseCurrency, isFresh)
    // A recent "no price" answer counts as cached too, so that a token cena can't price
    // (e.g. a spam token) doesn't make every call request the whole list again
    const isAllFresh = tokenAddresses.every(
      (address) => !!this.#getCacheEntry(network.chainId, address, isFresh)
    )

    // Without a CoinGecko platform cena has nothing to look the tokens up by
    if ((!ignoreCache && isAllFresh) || !network.platformId) {
      return { tokenData: freshTokenData, error: null }
    }

    const requestInFlight = this.#requestsInFlight.get(requestKey)
    if (requestInFlight && !ignoreCache) {
      // The error of that request is returned to the call that started it
      await requestInFlight.catch(() => {})

      if (!this.#getIsEnabled()) return EMPTY_RESULT()

      const isAnsweredOrFresh = (cachedAt: number) => cachedAt >= callStartedAt || isFresh(cachedAt)
      const hasUnansweredTokens = tokenAddresses.some(
        (address) => !this.#getCacheEntry(network.chainId, address, isAnsweredOrFresh)
      )

      if (!hasUnansweredTokens) {
        return {
          tokenData: this.#readTokenData(network, tokenAddresses, baseCurrency, isAnsweredOrFresh),
          error: null
        }
      }
    }

    const request = this.#requestAccountTokens(network, requestKey, tokenAddresses, baseCurrency)
    this.#requestsInFlight.set(requestKey, request)

    try {
      await request
      if (!this.#getIsEnabled()) return EMPTY_RESULT()

      const isAnsweredOrFresh = (cachedAt: number) => cachedAt >= callStartedAt || isFresh(cachedAt)

      return {
        tokenData: this.#readTokenData(network, tokenAddresses, baseCurrency, isAnsweredOrFresh),
        error: null
      }
    } catch (e: unknown) {
      const error = TokenPricesService.#toPriceRequestError(e, network)
      if (!this.#getIsEnabled()) return EMPTY_RESULT()

      return {
        tokenData: this.#readTokenData(
          network,
          tokenAddresses,
          baseCurrency,
          (cachedAt) => callStartedAt - cachedAt <= maxAgeOnFailureMs
        ),
        error
      }
    } finally {
      if (this.#requestsInFlight.get(requestKey) === request) {
        this.#requestsInFlight.delete(requestKey)
      }
    }
  }

  /** A cached entry younger than `maxAgeMs`, without requesting it (e.g. NFT floor prices) */
  getCachedTokenData(
    chainId: bigint,
    address: string,
    maxAgeMs: number,
    baseCurrency: string = 'usd'
  ): TokenDataCacheValue | null {
    if (!this.#getIsEnabled()) return null

    const now = Date.now()
    const entry = this.#getCacheEntry(chainId, address, (cachedAt) => now - cachedAt <= maxAgeMs)
    if (!entry || !entry.priceIn.some((price) => price.baseCurrency === baseCurrency)) return null

    return entry
  }

  /** Caches token data that came from elsewhere (e.g. Velcro's discovery response) */
  setTokenData(chainId: bigint, entries: [address: string, tokenData: TokenDataCacheValue][]) {
    if (!this.#getIsEnabled()) return

    const cache = this.#getOrCreateCache(chainId)
    const cachedAt = Date.now()

    entries.forEach(([address, tokenData]) => {
      cache.set(getTokenDataCacheKey(address), [cachedAt, tokenData])
    })
  }

  /** Forgets the token lists of a removed account */
  forgetAccount(accountAddr: string) {
    const accountSuffix = `:${accountAddr.toLowerCase()}`

    Array.from(this.#accountTokensByRequestKey.keys()).forEach((requestKey) => {
      if (requestKey.endsWith(accountSuffix)) this.#accountTokensByRequestKey.delete(requestKey)
    })
  }

  /** Whether prices may be used; drops everything that was stored if not */
  #getIsEnabled(): boolean {
    if (this.#isTokenPricesEnabled()) return true

    this.#cacheByChainId.clear()
    this.#accountTokensByRequestKey.clear()
    return false
  }

  #rememberAccountTokens(requestKey: string, source: TokenPriceSource, tokenAddresses: string[]) {
    const accountTokens = this.#accountTokensByRequestKey.get(requestKey) || new Map()
    accountTokens.set(source, tokenAddresses)
    this.#accountTokensByRequestKey.set(requestKey, accountTokens)
  }

  #getOrCreateCache(chainId: bigint): TokenDataCache {
    const chainKey = chainId.toString()
    const existingCache = this.#cacheByChainId.get(chainKey)
    if (existingCache) return existingCache

    const cache: TokenDataCache = new Map()
    this.#cacheByChainId.set(chainKey, cache)
    return cache
  }

  /** The cached entry of a token, if `isUsable` accepts the time it was cached at */
  #getCacheEntry(
    chainId: bigint,
    address: string,
    isUsable: (cachedAt: number) => boolean
  ): TokenDataCacheValue | null {
    const cached = this.#cacheByChainId.get(chainId.toString())?.get(getTokenDataCacheKey(address))
    if (!cached) return null

    const [cachedAt, entry] = cached
    return isUsable(cachedAt) ? entry : null
  }

  /** The usable cached entries of the tokens that have a price in `baseCurrency` */
  #readTokenData(
    network: Network,
    tokenAddresses: string[],
    baseCurrency: string,
    isUsable: (cachedAt: number) => boolean
  ): Map<string, TokenDataCacheValue> {
    const tokenData = new Map<string, TokenDataCacheValue>()

    tokenAddresses.forEach((address) => {
      const entry = this.#getCacheEntry(network.chainId, address, isUsable)
      if (!entry || !entry.priceIn.some((price) => price.baseCurrency === baseCurrency)) return

      tokenData.set(getTokenDataCacheKey(address), entry)
    })

    return tokenData
  }

  /**
   * Requests the account's whole token list along with the requested tokens and the Privacy
   * Pools assets, and caches every answer, including "no price". Pages that succeed are cached
   * even if another page fails, after which the first failure is thrown.
   */
  async #requestAccountTokens(
    network: Network,
    requestKey: string,
    tokenAddresses: string[],
    baseCurrency: string
  ): Promise<void> {
    const accountTokens = [...(this.#accountTokensByRequestKey.get(requestKey)?.values() || [])]
    const privacyPoolsAssets =
      getPrivacyPoolsChainConfig(network.chainId)?.assets.map(({ address }) => address) || []
    const allTokens = getUniqueSortedAddresses([
      ...accountTokens.flat(),
      ...tokenAddresses,
      ...privacyPoolsAssets
    ])

    const results = await Promise.allSettled(
      getTokenPriceRequests(network, allTokens, baseCurrency).map(async (request) => ({
        request,
        body: await this.#fetchPrices(request.url)
      }))
    )

    const cache = this.#getOrCreateCache(network.chainId)
    const cachedAt = Date.now()
    let firstError: unknown = null

    results.forEach((result) => {
      if (result.status === 'rejected') {
        firstError = firstError || result.reason
        return
      }

      const { request, body } = result.value
      request.tokenAddresses.forEach((address) => {
        const tokenData = body[getResponseKey(address, network)] || null
        cache.set(getTokenDataCacheKey(address), [
          cachedAt,
          convertApiTokenDataToTokenDataCache(tokenData)
        ])
      })
    })

    if (firstError) throw firstError
  }

  static #toPriceRequestError(error: unknown, network: Network): Error {
    if (!(error instanceof Error))
      return new Error(`Failed to fetch token prices on ${network.name}`)
    if (error.message !== 'request-timeout') return error

    return new Error(`Cena request timed out on ${network.name}`, { cause: error })
  }

  async #fetchPrices(
    url: string
  ): Promise<{ [responseKey: string]: ExternalAPITokenMarketDataResponse | undefined }> {
    const response = await fetchWithTimeout(this.#fetch, url, {}, this.#timeoutMs)
    const body = await response.json()

    const isSuccessful = response.ok ?? response.status === 200
    if (!isSuccessful) throw new Error(`Price request failed with status ${response.status}`)
    if (Object.prototype.hasOwnProperty.call(body, 'message')) throw new Error(String(body.message))
    if (Object.prototype.hasOwnProperty.call(body, 'error')) throw new Error(String(body.error))

    return body
  }
}
