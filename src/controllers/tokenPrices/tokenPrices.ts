import { geckoIdMapper } from '../../consts/coingecko'
import { AMBIRE_API_TIMEOUT } from '../../consts/portfolio'
import { getPrivacyPoolsChainConfig } from '../../consts/privacyPools'
import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter'
import { Fetch, RequestInitWithCustomHeaders } from '../../interfaces/fetch'
import { Network } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import {
  convertApiTokenDataToTokenDataCache,
  getTokenDataCacheKey
} from '../../libs/portfolio/helpers'
import {
  ExternalAPITokenMarketDataResponse,
  TokenDataCache,
  TokenDataCacheValue
} from '../../libs/portfolio/interfaces'
import { canGetRpcTokenPrices, getRpcTokenPrices } from '../../libs/tokenPrices/rpcTokenPrices'
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

/**
 * Where token prices come from: our price API (cena), or the network's RPC alone when the user
 * opted out of the price API
 */
export type TokenPriceSource = 'cena' | 'rpc'

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

/**
 * The only place that asks for token prices, and the cache they are kept in. They come from our
 * price API (cena), or, when the user opted out of it, from the network's RPC alone (see
 * `getRpcTokenPrices`).
 *
 * The cache belongs to no account: every token keeps the time it was last answered at, and a
 * token answered (with a price or with "no price") within TOKEN_PRICE_MAX_AGE_MS is read from
 * the cache, whichever account or feature asked for it. Only the tokens missing from the cache
 * are requested. A call never adds its tokens to the request of another call, so a request
 * never carries the tokens of two accounts. Every request also carries the Privacy Pools assets
 * that aren't fresh in the cache, which are the same for every user, so that pricing them
 * reveals nothing and the Privacy Pools lookups are answered from the cache.
 *
 * Features read the prices through `getTokenData`, and the portfolio keeps them on its tokens.
 * The prices that come with Velcro's discovery response are cached too (`setTokenData`), with
 * the same 5-minute age, so they aren't requested again; NFT collection prices come only from
 * there and are read without ever being requested (`getCachedTokenData`).
 *
 * When the user switches the source (opts out of the price API or back in), the cache is
 * emptied and the answers of the requests made before the switch are dropped, so that what the
 * setting changed shows right away: no market data from the price API after opting out, and no
 * gaps left by the RPC after opting back in. While opted out of the price API, nothing new is
 * requested from it, and requests to the RPC carry no Privacy Pools assets, as the RPC already
 * sees the Privacy Pools calls.
 */
export class TokenPricesController extends EventEmitter {
  #fetch: Fetch

  #isTokenPricesEnabled: () => boolean

  #timeoutMs: number

  #addsPrivacyPoolsAssets: boolean

  #getProvider?: (chainId: bigint) => RPCProvider | undefined | Promise<RPCProvider | undefined>

  /** chainId -> token data cache */
  #cacheByChainId = new Map<string, TokenDataCache>()

  /** `${chainId}:${lowercased address}` -> the request in flight that asks for the token */
  #requestsInFlight = new Map<string, Promise<void>>()

  /** The source the cache holds answers of. Null until the first call. */
  #cacheSource: TokenPriceSource | null = null

  /**
   * Increased each time the cache is emptied, so that a request made before can tell that its
   * answers are no longer wanted
   */
  #cacheVersion = 0

  constructor({
    fetch,
    isTokenPricesEnabled = () => true,
    timeoutMs = AMBIRE_API_TIMEOUT,
    addsPrivacyPoolsAssets = true,
    getProvider,
    eventEmitterRegistry
  }: {
    fetch: Fetch
    /** Whether the user allows our price API. When not, prices are read from the RPC instead. */
    isTokenPricesEnabled?: () => boolean
    timeoutMs?: number
    /**
     * Whether requests carry the Privacy Pools assets as cover. Off where no Privacy Pools
     * account can exist (e.g. the standalone Benzin), as there is nothing to cover there.
     */
    addsPrivacyPoolsAssets?: boolean
    /**
     * The provider of a network, for reading prices from the RPC, or a promise of it while it's
     * being set up. Without it, no prices are read while the user has opted out of the price API.
     */
    getProvider?: (chainId: bigint) => RPCProvider | undefined | Promise<RPCProvider | undefined>
    eventEmitterRegistry?: IEventEmitterRegistryController
  }) {
    super(eventEmitterRegistry)
    this.#fetch = fetch
    this.#isTokenPricesEnabled = isTokenPricesEnabled
    this.#timeoutMs = timeoutMs
    this.#addsPrivacyPoolsAssets = addsPrivacyPoolsAssets
    this.#getProvider = getProvider
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
    const source = this.#syncSource()
    const tokenAddresses = getUniqueSortedAddresses(requestedAddresses)
    const callStartedAt = Date.now()
    const isFresh = (cachedAt: number) => callStartedAt - cachedAt <= TOKEN_PRICE_MAX_AGE_MS
    const unansweredAddresses = tokenAddresses.filter(
      (address) => !this.#getCacheEntry(network.chainId, address, isFresh)
    )

    if (!unansweredAddresses.length || !this.#canRequest(network, source, baseCurrency)) {
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
      requests.push(
        this.#requestTokens({
          source,
          network,
          tokenAddresses: addressesToRequest,
          baseCurrency,
          isFresh
        })
      )
    }

    const failedRequest = (await Promise.allSettled(requests)).find(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    )
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

  /**
   * A cached entry younger than TOKEN_PRICE_MAX_AGE_MS, without requesting it (e.g. NFT floor
   * prices, which only come with Velcro's discovery response)
   */
  getCachedTokenData(
    chainId: bigint,
    address: string,
    baseCurrency: string = 'usd'
  ): TokenDataCacheValue | null {
    this.#syncSource()
    const now = Date.now()
    const entry = this.#getCacheEntry(
      chainId,
      address,
      (cachedAt) => now - cachedAt <= TOKEN_PRICE_MAX_AGE_MS
    )
    if (!entry || !entry.priceIn.some((price) => price.baseCurrency === baseCurrency)) return null

    return entry
  }

  /**
   * Caches token data that came from an outside service (e.g. Velcro's discovery response).
   * Use it only for data from outside services; cena's answers are cached by `getTokenData`.
   *
   * Only entries with a price are cached. An entry without one would count as a recent
   * "no price" answer, and its token wouldn't be requested for TOKEN_PRICE_MAX_AGE_MS. Cached
   * while the user has opted out of the price API too: e.g. Velcro is called for the token
   * discovery anyway, so keeping the prices it returns sends nothing more.
   */
  setTokenData(chainId: bigint, entries: [address: string, tokenData: TokenDataCacheValue][]) {
    this.#syncSource()
    const pricedEntries = entries.filter(([, tokenData]) => tokenData.priceIn.length > 0)
    if (!pricedEntries.length) return

    const cache = this.#getOrCreateCache(chainId)
    const cachedAt = Date.now()

    pricedEntries.forEach(([address, tokenData]) => {
      cache.set(getTokenDataCacheKey(address), [cachedAt, tokenData])
    })
  }

  /** Where new prices are requested from: cena, or the RPC when the user opted out of cena */
  #getSource(): TokenPriceSource {
    return this.#isTokenPricesEnabled() ? 'cena' : 'rpc'
  }

  /**
   * Returns the current source, emptying the cache first if it changed since the cache was
   * filled. The requests in flight are forgotten, and their answers dropped when they arrive
   * (see `#cacheVersion`), so that the next call asks the new source.
   */
  #syncSource(): TokenPriceSource {
    const source = this.#getSource()
    if (this.#cacheSource !== null && this.#cacheSource !== source) {
      this.#cacheByChainId.clear()
      this.#requestsInFlight.clear()
      this.#cacheVersion++
    }
    this.#cacheSource = source

    return source
  }

  /** Whether the tokens of the network can be requested from the source */
  #canRequest(network: Network, source: TokenPriceSource, baseCurrency: string): boolean {
    // Without a CoinGecko platform cena has nothing to look the tokens up by
    if (source === 'cena') return !!network.platformId

    // The RPC prices are only in USD
    return baseCurrency === 'usd' && !!this.#getProvider && canGetRpcTokenPrices(network)
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
  #requestTokens({
    source,
    network,
    tokenAddresses,
    baseCurrency,
    isFresh
  }: {
    source: TokenPriceSource
    network: Network
    tokenAddresses: string[]
    baseCurrency: string
    isFresh: (cachedAt: number) => boolean
  }): Promise<void> {
    const privacyPoolsAssets =
      source === 'cena' ? this.#getPrivacyPoolsAssetsToRequest(network.chainId, isFresh) : []
    const allTokens = getUniqueSortedAddresses([...tokenAddresses, ...privacyPoolsAssets])
    const inFlightKeys = allTokens.map((address) => getRequestInFlightKey(network.chainId, address))

    const cacheVersion = this.#cacheVersion
    const request =
      source === 'cena'
        ? this.#fetchAndCacheTokens(network, allTokens, baseCurrency, cacheVersion)
        : this.#readAndCacheRpcTokens(network, allTokens, cacheVersion)
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
   * Nothing is cached if the cache was emptied since the request was made (`cacheVersion`).
   */
  async #fetchAndCacheTokens(
    network: Network,
    tokenAddresses: string[],
    baseCurrency: string,
    cacheVersion: number
  ) {
    const results = await Promise.allSettled(
      getTokenPriceRequests(network, tokenAddresses, baseCurrency).map(async (request) => ({
        request,
        body: await this.#fetchPrices(request.url)
      }))
    )
    // Asked for before the user switched the source, so the answers are no longer wanted
    if (cacheVersion !== this.#cacheVersion) return

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

  /**
   * Reads the prices of exactly the given tokens from the network's RPC and caches every answer,
   * including "no price". Pages that succeed are cached even if another page fails, after which
   * its error is thrown, as with cena. Throws, caching nothing, if the network couldn't be priced.
   * Nothing is cached if the cache was emptied since the request was made (`cacheVersion`).
   */
  async #readAndCacheRpcTokens(network: Network, tokenAddresses: string[], cacheVersion: number) {
    const provider = await this.#getProvider?.(network.chainId)
    if (!provider) throw new Error(`Not connected to ${network.name} to read token prices from`)

    const { prices, error } = await getRpcTokenPrices({ provider, network, tokenAddresses })
    // Asked for before the user switched the source, so the answers are no longer wanted
    if (cacheVersion !== this.#cacheVersion) return

    const cache = this.#getOrCreateCache(network.chainId)
    const cachedAt = Date.now()

    tokenAddresses.forEach((address) => {
      const key = getTokenDataCacheKey(address)
      // Left out when its page failed, so that it isn't taken as having no price
      if (!prices.has(key)) return

      const price = prices.get(key) ?? null
      cache.set(key, [
        cachedAt,
        { priceIn: price === null ? [] : [{ baseCurrency: 'usd', price }], marketDataIn: [] }
      ])
    })

    if (error) throw error
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
