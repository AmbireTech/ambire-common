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
import { canPriceNetwork } from '../../libs/tokenPrices/canPriceNetwork'
import { getRpcTokenPrices } from '../../libs/tokenPrices/rpcTokenPrices'
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

/**
 * The key a token is tracked under while a request for it is in flight. A token looked up by coin
 * id on cena (e.g. ETH, the native token of many networks) gets the same answer on every network,
 * so it is tracked by its coin id alone and a request for it on one network is waited for on the
 * others. The RPC prices every network on its own, so there the token is tracked per network.
 */
const getRequestInFlightKey = (
  network: Network,
  address: string,
  source: TokenPriceSource
): string => {
  const coinId = source === 'cena' ? geckoIdMapper(address, network) : null
  if (coinId) return `coin:${coinId}`

  return `${network.chainId.toString()}:${getTokenDataCacheKey(address)}`
}

/** The entry of a cached token, if `isUsable` accepts the time it was cached at */
const getUsableEntry = (
  cached: [cachedAt: number, entry: TokenDataCacheValue] | undefined,
  isUsable: (cachedAt: number) => boolean
): TokenDataCacheValue | null => {
  if (!cached) return null

  const [cachedAt, entry] = cached
  return isUsable(cachedAt) ? entry : null
}

/**
 * The only place that asks for token prices, and the cache they are kept in. They come from our
 * price API (cena), or, when the user opted out of it, from the network's RPC alone (see
 * `getRpcTokenPrices`).
 *
 * The cache belongs to no account: every token keeps the time it was last answered at, and a
 * token answered (with a price or with "no price") within TOKEN_PRICE_MAX_AGE_MS is read from
 * the cache, whichever account or feature asked for it. Only the tokens missing from the cache
 * are requested. The tokens cena looks up by coin id (e.g. ETH, the native token of many
 * networks) are cached by it, so they are requested once for all the networks that share them.
 * A call never adds its tokens to the request of another call, so a request never carries the
 * tokens of two accounts. Every request also carries the Privacy Pools assets
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

  /**
   * chainId -> token data cache, for the tokens looked up by contract address and for every
   * token priced by the RPC
   */
  #cacheByChainId = new Map<string, TokenDataCache>()

  /**
   * coin id -> token data, for the tokens cena looks up by coin id, shared by every network, as
   * cena answers a coin id the same on all of them
   */
  #cacheByCoinId: TokenDataCache = new Map()

  /** {@link getRequestInFlightKey} -> the request in flight that asks for the token */
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
      (address) => !this.#getTokenCacheEntry(network, address, isFresh)
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
        getRequestInFlightKey(network, address, source)
      )
      if (requestInFlight) requestsInFlight.add(requestInFlight)
      else addressesToRequest.push(address)
    })

    const requests = [...requestsInFlight]
    if (addressesToRequest.length) {
      requests.push(
        ...this.#requestTokens({
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
   * prices, which only come with Velcro's discovery response). Reads only the entries of the
   * network, so not the tokens cena answered by coin id.
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
      this.#cacheByCoinId.clear()
      this.#requestsInFlight.clear()
      this.#cacheVersion++
    }
    this.#cacheSource = source

    return source
  }

  /** Whether the tokens of the network can be requested from the source */
  #canRequest(network: Network, source: TokenPriceSource, baseCurrency: string): boolean {
    if (!canPriceNetwork(network, source === 'cena')) return false
    if (source === 'cena') return true

    // The RPC prices are only in USD
    return baseCurrency === 'usd' && !!this.#getProvider
  }

  #getOrCreateCache(chainId: bigint): TokenDataCache {
    const chainKey = chainId.toString()
    const existingCache = this.#cacheByChainId.get(chainKey)
    if (existingCache) return existingCache

    const cache: TokenDataCache = new Map()
    this.#cacheByChainId.set(chainKey, cache)
    return cache
  }

  /**
   * The cached entry of a token among the entries of the network, if `isUsable` accepts the time
   * it was cached at
   */
  #getCacheEntry(
    chainId: bigint,
    address: string,
    isUsable: (cachedAt: number) => boolean
  ): TokenDataCacheValue | null {
    return getUsableEntry(
      this.#cacheByChainId.get(chainId.toString())?.get(getTokenDataCacheKey(address)),
      isUsable
    )
  }

  /**
   * The cached entry of a token on the network, if `isUsable` accepts the time it was cached at.
   * A token cena looks up by coin id is found by it, whichever network it was answered on, or else
   * among the entries of the network (set from elsewhere, e.g. Velcro's prices, or by the RPC).
   */
  #getTokenCacheEntry(
    network: Network,
    address: string,
    isUsable: (cachedAt: number) => boolean
  ): TokenDataCacheValue | null {
    const coinId = geckoIdMapper(address, network)
    const coinEntry = coinId ? getUsableEntry(this.#cacheByCoinId.get(coinId), isUsable) : null

    return coinEntry || this.#getCacheEntry(network.chainId, address, isUsable)
  }

  /** Caches cena's answer for a token: by its coin id if it has one, otherwise on the network */
  #setCenaCacheEntry(
    network: Network,
    address: string,
    cached: [cachedAt: number, entry: TokenDataCacheValue]
  ) {
    const coinId = geckoIdMapper(address, network)
    if (coinId) {
      this.#cacheByCoinId.set(coinId, cached)
      return
    }

    this.#getOrCreateCache(network.chainId).set(getTokenDataCacheKey(address), cached)
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
      const entry = this.#getTokenCacheEntry(network, address, isUsable)
      if (!entry || !entry.priceIn.some((price) => price.baseCurrency === baseCurrency)) return

      tokenData.set(getTokenDataCacheKey(address), entry)
    })

    return tokenData
  }

  /**
   * Requests the tokens together with the Privacy Pools assets of the network that are neither
   * fresh in the cache nor already requested, and marks each of them as in flight until its
   * request settles, so that other calls wait for it instead of requesting them again. On cena,
   * each page is tracked on its own, so a call that waits for a token (e.g. ETH, requested on
   * another network) doesn't get the error of a page it didn't need. The RPC is read in a single
   * request. Returns the requests.
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
  }): Promise<void>[] {
    const cacheVersion = this.#cacheVersion

    if (source === 'rpc') {
      const request = this.#readAndCacheRpcTokens(network, tokenAddresses, cacheVersion)
      return [this.#trackInFlight(network, source, tokenAddresses, request)]
    }

    const privacyPoolsAssets = this.#getPrivacyPoolsAssetsToRequest(network, isFresh)
    const allTokens = getUniqueSortedAddresses([...tokenAddresses, ...privacyPoolsAssets])

    return getTokenPriceRequests(network, allTokens, baseCurrency).map((priceRequest) =>
      this.#trackInFlight(
        network,
        source,
        priceRequest.tokenAddresses,
        this.#fetchAndCachePage(network, priceRequest, cacheVersion)
      )
    )
  }

  /** Marks the tokens as in flight until the request settles. Returns the request. */
  #trackInFlight(
    network: Network,
    source: TokenPriceSource,
    tokenAddresses: string[],
    request: Promise<void>
  ): Promise<void> {
    const inFlightKeys = tokenAddresses.map((address) =>
      getRequestInFlightKey(network, address, source)
    )
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
    network: Network,
    isFresh: (cachedAt: number) => boolean
  ): string[] {
    if (!this.#addsPrivacyPoolsAssets) return []

    const assetAddresses =
      getPrivacyPoolsChainConfig(network.chainId)?.assets.map(({ address }) => address) || []

    return assetAddresses.filter(
      (address) =>
        !this.#getTokenCacheEntry(network, address, isFresh) &&
        !this.#requestsInFlight.has(getRequestInFlightKey(network, address, 'cena'))
    )
  }

  /**
   * Requests exactly the tokens of a cena page and caches every answer, including "no price". A
   * page is cached as soon as it succeeds, even if another page of the same call fails.
   * Nothing is cached if the cache was emptied since the request was made (`cacheVersion`).
   */
  async #fetchAndCachePage(
    network: Network,
    { url, tokenAddresses }: TokenPriceRequest,
    cacheVersion: number
  ) {
    const [result] = await Promise.allSettled([this.#fetchPrices(url)])
    // Asked for before the user switched the source, so the answers are no longer wanted
    if (cacheVersion !== this.#cacheVersion) {
      if (result.status === 'rejected') {
        TokenPricesController.#logDroppedRequestError(result.reason, network)
      }
      return
    }
    if (result.status === 'rejected') throw result.reason

    const body = result.value
    const cachedAt = Date.now()

    tokenAddresses.forEach((address) => {
      const tokenData = body[getResponseKey(address, network)] || null
      this.#setCenaCacheEntry(network, address, [
        cachedAt,
        convertApiTokenDataToTokenDataCache(tokenData)
      ])
    })
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
    if (cacheVersion !== this.#cacheVersion) {
      TokenPricesController.#logDroppedRequestError(error, network)
      return
    }

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

  /**
   * Logs why a request whose answers were dropped after a switch of the source failed, if it did.
   * Its callers aren't told: they asked the old source, and the next call asks the new one.
   */
  static #logDroppedRequestError(error: unknown, network: Network) {
    if (!error) return

    console.warn(
      'tokenPrices: a request made before the price source changed failed',
      TokenPricesController.#toPriceRequestError(error, network)
    )
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
