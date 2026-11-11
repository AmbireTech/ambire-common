import { geckoIdMapper } from '../../consts/coingecko'
import { AMBIRE_API_TIMEOUT } from '../../consts/portfolio'
import { getPrivacyPoolsChainConfig } from '../../consts/privacyPools'
import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter'
import { Fetch, RequestInitWithCustomHeaders } from '../../interfaces/fetch'
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
import EventEmitter from '../eventEmitter/eventEmitter'

const CENA_API_URL = 'https://cena.ambire.com'
// max tokens per request; we seem to have faster results when it's lower
const BATCH_LIMIT = 40

/** Tokens answered (with a price or with "no price") within this are read from the cache */
export const TOKEN_PRICE_MAX_AGE_MS = 5 * 60 * 1000 // 5 min

/** When a request fails, cached prices younger than this are returned instead */
export const TOKEN_PRICE_MAX_AGE_ON_FAILURE_MS = 60 * 60 * 1000 // 1h

export type GetTokenDataParams = {
  network: Network
  tokenAddresses: string[]
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
 * Deduplicates the addresses regardless of their casing and sorts them, keeping the casing
 * they were first passed with. Sorting makes a request for the same tokens always split into
 * the same pages.
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

const getRequestInFlightKey = (chainId: bigint, address: string): string =>
  `${chainId.toString()}:${getTokenDataCacheKey(address)}`

const EMPTY_RESULT = (): GetTokenDataResult => ({ tokenData: new Map(), error: null })

/**
 * The only place that asks our price API (cena) for token prices, and the cache they are kept in.
 *
 * The cache belongs to no account: every token keeps the time it was last answered at, and a
 * token answered (with a price or with "no price") within TOKEN_PRICE_MAX_AGE_MS is read from
 * the cache, whichever account or feature asked for it. Only the tokens missing from the cache
 * are requested. A call never adds its tokens to the request of another call, so a request
 * never carries the tokens of two accounts. Every request also carries the Privacy Pools assets
 * that aren't fresh in the cache, which are the same for every user, so that pricing them
 * reveals nothing and the Privacy Pools lookups are answered from the cache.
 *
 * The cache is private: features read the prices through `getTokenData`, and the portfolio
 * keeps them on its tokens. Nothing is requested, read or stored while the user has opted out
 * of token prices.
 */
export class TokenPricesController extends EventEmitter {
  #fetch: Fetch

  #isTokenPricesEnabled: () => boolean

  #timeoutMs: number

  #addsPrivacyPoolsAssets: boolean

  /** chainId -> token data cache */
  #cacheByChainId = new Map<string, TokenDataCache>()

  /** `${chainId}:${lowercased address}` -> the request in flight that asks for the token */
  #requestsInFlight = new Map<string, Promise<void>>()

  constructor({
    fetch,
    isTokenPricesEnabled = () => true,
    timeoutMs = AMBIRE_API_TIMEOUT,
    addsPrivacyPoolsAssets = true,
    eventEmitterRegistry
  }: {
    fetch: Fetch
    isTokenPricesEnabled?: () => boolean
    timeoutMs?: number
    /**
     * Whether requests carry the Privacy Pools assets as cover. Off where no Privacy Pools
     * account can exist (e.g. the standalone Benzin), as there is nothing to cover there.
     */
    addsPrivacyPoolsAssets?: boolean
    eventEmitterRegistry?: IEventEmitterRegistryController
  }) {
    super(eventEmitterRegistry)
    this.#fetch = fetch
    this.#isTokenPricesEnabled = isTokenPricesEnabled
    this.#timeoutMs = timeoutMs
    this.#addsPrivacyPoolsAssets = addsPrivacyPoolsAssets
  }

  /**
   * Returns the prices of the given tokens. Tokens answered within TOKEN_PRICE_MAX_AGE_MS come
   * from the cache; the rest are requested (or, if another call is already requesting them,
   * waited for). When a request fails, the cached prices younger than
   * TOKEN_PRICE_MAX_AGE_ON_FAILURE_MS are returned along with the error.
   */
  async getTokenData({
    network,
    tokenAddresses: requestedAddresses,
    baseCurrency = 'usd'
  }: GetTokenDataParams): Promise<GetTokenDataResult> {
    if (!this.#getIsEnabled()) return EMPTY_RESULT()

    const tokenAddresses = getUniqueSortedAddresses(requestedAddresses)
    const callStartedAt = Date.now()
    const isFresh = (cachedAt: number) => callStartedAt - cachedAt <= TOKEN_PRICE_MAX_AGE_MS
    const unansweredAddresses = tokenAddresses.filter(
      (address) => !this.#getCacheEntry(network.chainId, address, isFresh)
    )

    // Without a CoinGecko platform cena has nothing to look the tokens up by
    if (!unansweredAddresses.length || !network.platformId) {
      return {
        tokenData: this.#readTokenData(network, tokenAddresses, baseCurrency, isFresh),
        error: null
      }
    }

    const requestsInFlight = new Set<Promise<void>>()
    const addressesToRequest: string[] = []
    unansweredAddresses.forEach((address) => {
      const requestInFlight = this.#requestsInFlight.get(
        getRequestInFlightKey(network.chainId, address)
      )
      if (requestInFlight) requestsInFlight.add(requestInFlight)
      else addressesToRequest.push(address)
    })

    const requests = [...requestsInFlight]
    if (addressesToRequest.length) {
      requests.push(this.#requestTokens(network, addressesToRequest, baseCurrency, isFresh))
    }

    const failedRequest = (await Promise.allSettled(requests)).find(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    )
    if (!this.#getIsEnabled()) return EMPTY_RESULT()

    const isAnswered = (cachedAt: number) => cachedAt >= callStartedAt

    if (!failedRequest) {
      return {
        tokenData: this.#readTokenData(
          network,
          tokenAddresses,
          baseCurrency,
          (cachedAt) => isAnswered(cachedAt) || isFresh(cachedAt)
        ),
        error: null
      }
    }

    return {
      tokenData: this.#readTokenData(
        network,
        tokenAddresses,
        baseCurrency,
        (cachedAt) =>
          isAnswered(cachedAt) || callStartedAt - cachedAt <= TOKEN_PRICE_MAX_AGE_ON_FAILURE_MS
      ),
      error: TokenPricesController.#toPriceRequestError(failedRequest.reason, network)
    }
  }

  /** Whether prices may be used; drops everything that was stored if not */
  #getIsEnabled(): boolean {
    if (this.#isTokenPricesEnabled()) return true

    this.#cacheByChainId.clear()
    return false
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
   * Requests the tokens together with the Privacy Pools assets of the network that are neither
   * fresh in the cache nor already requested, and marks all of them as in flight until the
   * request settles, so that other calls wait for it instead of requesting them again.
   */
  #requestTokens(
    network: Network,
    tokenAddresses: string[],
    baseCurrency: string,
    isFresh: (cachedAt: number) => boolean
  ): Promise<void> {
    const privacyPoolsAssets = this.#getPrivacyPoolsAssetsToRequest(network.chainId, isFresh)
    const allTokens = getUniqueSortedAddresses([...tokenAddresses, ...privacyPoolsAssets])
    const inFlightKeys = allTokens.map((address) => getRequestInFlightKey(network.chainId, address))

    const request = this.#fetchAndCacheTokens(network, allTokens, baseCurrency)
    inFlightKeys.forEach((key) => this.#requestsInFlight.set(key, request))

    const forgetRequest = () => {
      inFlightKeys.forEach((key) => {
        if (this.#requestsInFlight.get(key) === request) this.#requestsInFlight.delete(key)
      })
    }
    // Its outcome (and error) reaches the callers through `request` itself
    request.then(forgetRequest, forgetRequest)

    return request
  }

  /** The Privacy Pools assets of the network that are neither fresh in the cache nor in flight */
  #getPrivacyPoolsAssetsToRequest(
    chainId: bigint,
    isFresh: (cachedAt: number) => boolean
  ): string[] {
    if (!this.#addsPrivacyPoolsAssets) return []

    const assetAddresses =
      getPrivacyPoolsChainConfig(chainId)?.assets.map(({ address }) => address) || []

    return assetAddresses.filter(
      (address) =>
        !this.#getCacheEntry(chainId, address, isFresh) &&
        !this.#requestsInFlight.has(getRequestInFlightKey(chainId, address))
    )
  }

  /**
   * Requests exactly the given tokens and caches every answer, including "no price". Pages that
   * succeed are cached even if another page fails, after which the first failure is thrown.
   */
  async #fetchAndCacheTokens(network: Network, tokenAddresses: string[], baseCurrency: string) {
    const results = await Promise.allSettled(
      getTokenPriceRequests(network, tokenAddresses, baseCurrency).map(async (request) => ({
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
    // The body is read within the timeout too, as a response can arrive and then stall
    const { response, body } = await fetchWithTimeout(
      async (requestUrl: string, options: RequestInitWithCustomHeaders) => {
        const priceResponse = await this.#fetch(requestUrl, options)
        return { response: priceResponse, body: await priceResponse.json() }
      },
      url,
      {},
      this.#timeoutMs
    )

    const isSuccessful = response.ok ?? response.status === 200
    if (!isSuccessful) throw new Error(`Price request failed with status ${response.status}`)
    if (Object.prototype.hasOwnProperty.call(body, 'message')) throw new Error(String(body.message))
    if (Object.prototype.hasOwnProperty.call(body, 'error')) throw new Error(String(body.error))

    return body
  }
}
