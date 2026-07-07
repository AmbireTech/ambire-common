import { ZeroAddress } from 'ethers'
import { getAddress } from 'viem'

import BalanceGetter from '../../../contracts/compiled/BalanceGetter.json'
import NFTGetter from '../../../contracts/compiled/NFTGetter.json'
import gasTankFeeTokens from '../../consts/gasTankFeeTokens'
import { PINNED_TOKENS } from '../../consts/pinnedTokens'
import { Fetch } from '../../interfaces/fetch'
import { Network } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import { Deployless, fromDescriptor } from '../deployless/deployless'
import batcher from './batcher'
import { isBlacklistedAsset, prepareBlacklistPatterns, STATIC_BLACKLIST } from './blacklist'
import { portfolioDebugLog } from './debug'
import { geckoRequestBatcher, geckoResponseIdentifier } from './gecko'
import { getNFTs, getTokens } from './getOnchainBalances'
import {
  convertApiTokenDataToTokenDataCache,
  formatExternalHintsAPIResponse,
  getHardcodedCitreaPrices,
  mergeERC721s,
  tokenFilter
} from './helpers'
import {
  CollectionResult,
  ExternalHintsAPIResponse,
  GetOptions,
  Hints,
  Limits,
  LimitsOptions,
  PortfolioLibGetResult,
  TokenDataCache,
  TokenDataCacheValue,
  TokenError,
  TokenResult
} from './interfaces'
import { flattenResults, paginate } from './pagination'

export const LIMITS: Limits = {
  // we have to be conservative with erc721Tokens because if we pass 30x20 (worst case) tokenIds, that's 30x20 extra words which is 19kb
  // proxy mode input is limited to 24kb
  deploylessProxyMode: {
    erc20: 66,
    erc20Simulation: 50,
    erc721: 30,
    erc721TokensInput: 20,
    erc721Tokens: 50
  },
  // theoretical capacity is 1666/450
  deploylessStateOverrideMode: {
    erc20: 230,
    erc20Simulation: 50,
    erc721: 70,
    erc721TokensInput: 70,
    erc721Tokens: 70
  }
}

// @TODO: Move this somewhere else
export const PORTFOLIO_LIB_ERROR_NAMES = {
  /** External hints API (Velcro) request failed but fallback is sufficient */
  NonCriticalApiHintsError: 'NonCriticalApiHintsError',
  /** External API (Velcro) hints are older than X minutes */
  StaleApiHintsError: 'StaleApiHintsError',
  /** No external API (Velcro) hints are available- the request failed without fallback */
  NoApiHintsError: 'NoApiHintsError',
  /** One or more cena request has failed */
  PriceFetchError: 'PriceFetchError',
  /** Defi discovery failed */
  DefiDiscoveryError: 'DefiDiscoveryError'
}

export const getEmptyHints = (): Hints => ({
  erc20s: [],
  erc721s: {},
  externalApi: undefined
})

const defaultOptions: GetOptions = {
  baseCurrency: 'usd',
  blockTag: 'latest',
  tokenDataRecency: 0,
  fetchPinned: true,
  tokenDataRecencyOnFailure: 1 * 60 * 60 * 1000 // 1 hour
}

export class Portfolio {
  network: Network

  provider: RPCProvider

  private batchedVelcroDiscovery: Function

  private batchedGecko: Function

  private deploylessTokens: Deployless

  private deploylessNfts: Deployless

  constructor(
    fetch: Fetch,
    provider: RPCProvider,
    network: Network,
    velcroUrl?: string,
    customBatcher?: Function
  ) {
    if (customBatcher) {
      this.batchedVelcroDiscovery = customBatcher
    } else {
      this.batchedVelcroDiscovery = batcher(
        fetch,
        (queue) => {
          const baseCurrencies = [...new Set(queue.map((x) => x.data.baseCurrency))]
          return baseCurrencies.map((baseCurrency) => {
            const queueSegment = queue.filter((x) => x.data.baseCurrency === baseCurrency)
            const url = `${velcroUrl}/multi-hints?networks=${queueSegment
              .map((x) => x.data.chainId)
              .join(',')}&accounts=${queueSegment
              .map((x) => x.data.accountAddr)
              .join(',')}&baseCurrency=${baseCurrency}`
            return { queueSegment, url }
          })
        },
        {
          timeoutSettings: {
            timeoutAfter: 3000,
            timeoutErrorMessage: `Velcro discovery timed out on ${network.name}`
          },
          dedupeByKeys: ['chainId', 'accountAddr']
        }
      )
    }
    this.batchedGecko = batcher(fetch, geckoRequestBatcher, {
      timeoutSettings: {
        timeoutAfter: 3000,
        timeoutErrorMessage: `Cena request timed out on ${network.name}`
      }
    })
    this.provider = provider
    this.network = network
    this.deploylessTokens = fromDescriptor(provider, BalanceGetter, !network.rpcNoStateOverride)
    this.deploylessNfts = fromDescriptor(provider, NFTGetter, !network.rpcNoStateOverride)
  }

  /**
   * Fetch the hints from the external API (Velcro).
   * Main return cases:
   * - hints with `externalApi` property set if the hints are coming from the external API (and not from storage)
   * - empty hints if the hints are static and were learned less than X minutes ago. The goal is to reduce
   * unnecessary requests to deployless. Once every X minutes we make a call to Velcro, get the static hints and
   * learn the tokens with amount. In subsequent calls, we return empty hints and the portfolio lib uses the previously learned tokens.
   */
  protected async externalHintsAPIDiscovery(options?: {
    disableAutoDiscovery?: boolean
    chainId: bigint
    accountAddr: string
    baseCurrency: string
  }): Promise<{
    hints: Hints
    error?: PortfolioLibGetResult['errors'][number]
  }> {
    const { disableAutoDiscovery = false, chainId, accountAddr, baseCurrency } = options || {}
    let hints: Hints = getEmptyHints()

    try {
      // Fetch the latest hints from the external API (Velcro)
      if (!disableAutoDiscovery) {
        const hintsFromExternalAPI: ExternalHintsAPIResponse = await this.batchedVelcroDiscovery({
          chainId,
          accountAddr,
          baseCurrency
        })

        if (hintsFromExternalAPI) {
          const formatted = formatExternalHintsAPIResponse(hintsFromExternalAPI)

          if (formatted) {
            hints = formatted
            // Attach the property as the hints are coming from the external API
            hints.externalApi = {
              lastUpdate: Date.now(),
              prices: hintsFromExternalAPI.prices,
              hasHints: !!hintsFromExternalAPI.hasHints
            }
          }
        }
      }

      return {
        hints
      }
    } catch (error: any) {
      console.error('Portfolio.externalHintsAPIDiscovery error:', error)
      return {
        hints,
        error: {
          name: PORTFOLIO_LIB_ERROR_NAMES.NoApiHintsError,
          message: error?.message || 'Unknown error',
          level: 'warning'
        }
      }
    }
  }

  async get(accountAddr: string, opts: Partial<GetOptions> = {}): Promise<PortfolioLibGetResult> {
    const errors: PortfolioLibGetResult['errors'] = []
    const {
      simulation,
      disableAutoDiscovery = false,
      baseCurrency,
      fetchPinned,
      additionalErc20Hints,
      additionalErc721Hints,
      specialErc20Hints,
      specialErc721Hints,
      blockTag,
      tokenDataRecencyOnFailure,
      tokenDataCache: paramsTokenDataCache,
      tokenDataRecency,
      blacklist,
      preventTokenBlacklisting
    } = { ...defaultOptions, ...opts }
    const toBeLearned: PortfolioLibGetResult['toBeLearned'] = {
      erc20s: [],
      erc721s: {}
    }
    if (simulation && simulation.baseAccount.getAccount().addr !== accountAddr)
      throw new Error('wrong account passed')

    const start = Date.now()
    const chainId = this.network.chainId

    const { hints, error: hintsError } = await this.externalHintsAPIDiscovery({
      disableAutoDiscovery,
      chainId,
      accountAddr,
      baseCurrency
    })

    if (hintsError) errors.push(hintsError)

    hints.erc20s = [
      ...hints.erc20s,
      ...Object.values(specialErc20Hints || {}).flat(),
      ...(additionalErc20Hints || []),
      ...(fetchPinned ? PINNED_TOKENS.map((x) => x.address) : []),
      // add the fee tokens
      ...gasTankFeeTokens.filter((x) => x.chainId === this.network.chainId).map((x) => x.address)
    ]

    hints.erc721s = mergeERC721s([
      additionalErc721Hints || {},
      hints.erc721s,
      ...Object.values(specialErc721Hints || {})
    ])

    const checksummedErc20Hints = hints.erc20s
      .map((address) => {
        try {
          // getAddress may throw an error. This will break the portfolio
          // if the error isn't caught
          return getAddress(address)
        } catch {
          return null
        }
      })
      .filter(Boolean) as string[]

    // Merge static and dynamic blacklisted addresses for this chain
    const chainIdStr = this.network.chainId.toString()
    const staticBlacklistedAddrs = STATIC_BLACKLIST.blacklistAddrs[chainIdStr] || []
    const dynamicBlacklistedAddrs = blacklist?.blacklistAddrs[chainIdStr] || []
    const allBlacklistedAddrs = new Set([...staticBlacklistedAddrs, ...dynamicBlacklistedAddrs])
    const filteredChecksummedHints = preventTokenBlacklisting
      ? checksummedErc20Hints
      : checksummedErc20Hints.filter((addr) => !allBlacklistedAddrs.has(addr))

    // Remove duplicates and always add ZeroAddress
    hints.erc20s = [...new Set(filteredChecksummedHints.concat(ZeroAddress))]

    const tokenDataCache: TokenDataCache = paramsTokenDataCache || new Map()
    for (const addr in hints.externalApi?.prices || {}) {
      const tokenDataHint = convertApiTokenDataToTokenDataCache(
        hints.externalApi?.prices[addr] || null
      )

      if (!tokenDataHint) continue

      tokenDataCache.set(addr, [start, tokenDataHint])
    }
    const discoveryDone = Date.now()

    // .isLimitedAt24kbData should be the same for both instances; @TODO more elegant check?
    const limits: LimitsOptions = this.deploylessTokens.isLimitedAt24kbData
      ? LIMITS.deploylessProxyMode
      : LIMITS.deploylessStateOverrideMode
    const collectionsHints = Object.entries(hints.erc721s)
    const [tokensWithErr, collectionsWithErr] = await Promise.all([
      flattenResults(
        paginate(hints.erc20s, opts.simulation ? limits.erc20Simulation : limits.erc20).map(
          (page, index) =>
            getTokens(
              this.network,
              this.deploylessTokens,
              { simulation, blockTag, specialErc20Hints },
              accountAddr,
              page,
              index
            )
        )
      ),
      flattenResults(
        paginate(collectionsHints, limits.erc721).map((page) =>
          getNFTs(
            this.network,
            this.deploylessNfts,
            { simulation, blockTag },
            accountAddr,
            page,
            limits
          )
        )
      )
    ])

    const [tokensWithErrResult, metaData] = tokensWithErr
    const { blockNumber, beforeNonce, afterNonce } = metaData as {
      blockNumber: number
      beforeNonce: bigint
      afterNonce: bigint
    }
    const [collectionsWithErrResult] = collectionsWithErr

    // Re-map/filter into our format
    const getTokenDataFromCache = (
      address: string,
      _tokenDataRecency: number = tokenDataRecency
    ): TokenDataCacheValue | null => {
      // hardcode citrea prices
      if (this.network.chainId === 4114n) {
        const citreaTokenPrice = getHardcodedCitreaPrices(address)
        if (citreaTokenPrice)
          return {
            marketDataIn: [],
            priceIn: [citreaTokenPrice]
          }
      }

      const cached = tokenDataCache.get(address)
      if (!cached) return null
      const [timestamp, entry] = cached
      const eligible = entry.priceIn.find((p) => p.baseCurrency === baseCurrency)

      if (!eligible) return null

      // by using `start` instead of `Date.now()`, we make sure that prices updated from Velcro will not be updated again
      // even if priceRecency is 0
      const isStale = start - timestamp > _tokenDataRecency
      return isStale ? null : entry
    }

    const nativeToken = tokensWithErrResult.find(
      ([, result]) => result.address === ZeroAddress
    )?.[1]

    const isValidToken = (error: TokenError, token: TokenResult): boolean =>
      error === '0x' && !!token.symbol

    const blacklistPatterns = prepareBlacklistPatterns([
      ...STATIC_BLACKLIST.blacklistBySymbols,
      ...(blacklist?.blacklistBySymbols || [])
    ])

    const tokensWithoutPrices = tokensWithErrResult
      .filter((_tokensWithErrResult: [TokenError, TokenResult]) => {
        if (!isValidToken(_tokensWithErrResult[0], _tokensWithErrResult[1])) return false

        // Spam filter: hide tokens whose symbol/name matches a blacklisted
        // pattern. Custom (user-added) tokens are never hidden. We don't run the
        // embedded-domain check here because token names/symbols legitimately contain domains.
        const token = _tokensWithErrResult[1]
        if (
          isBlacklistedAsset({
            symbol: token.symbol,
            name: token.name,
            isCustom: token.flags?.isCustom,
            patterns: blacklistPatterns
          })
        ) {
          portfolioDebugLog(
            `${this.network.chainId.toString()}: Filtered token ${token.symbol}`,
            {
              address: token.address,
              symbol: token.symbol,
              name: token.name
            },
            { flow: 'blacklist' }
          )
          return false
        }

        // Don't filter by balance/custom/hidden etc. if this param isn't passed
        // The portfolio lib is used outside the controller, in which case we want to
        // fetch all tokens regardless of their balance or type
        if (!specialErc20Hints) return true

        // To be learned tokens are never filtered out to ensure that
        // the humanizer, simulation and etc. work even if the account doesn't have amount
        // on either block (latest/pending)
        const isToBeLearned = specialErc20Hints.learn.includes(_tokensWithErrResult[1].address)

        return tokenFilter(
          _tokensWithErrResult[1],
          this.network,
          isToBeLearned,
          !!fetchPinned,
          nativeToken
        )
      })
      .map(([, result]) => {
        if (
          result.amount &&
          !result.flags.isCustom &&
          !result.flags.isHidden &&
          !toBeLearned.erc20s.includes(result.address)
        ) {
          // Add all non-zero tokens to toBeLearned
          toBeLearned.erc20s.push(result.address)
        }

        return result
      })

    const collections = collectionsWithErrResult.reduce<CollectionResult[]>(
      (acc, [error, collection]) => {
        if (!isValidToken(error, collection)) return acc

        // Spam filter: hide collections whose symbol/name matches a blacklisted
        // pattern or embeds a phishing domain. Custom collections are never hidden
        // (even tho we don't support them atm).
        if (
          isBlacklistedAsset({
            symbol: collection.symbol,
            name: collection.name,
            isCustom: collection.flags?.isCustom,
            patterns: blacklistPatterns,
            checkForEmbeddedDomain: true
          })
        ) {
          portfolioDebugLog(
            `${this.network.chainId.toString()}: Filtered collection ${collection.name}`,
            {
              address: collection.address,
              symbol: collection.symbol,
              name: collection.name
            },
            { flow: 'blacklist' }
          )

          return acc
        }

        // Important note: Collections with 0 collectibles are allow to pass through the filter.
        if (!toBeLearned.erc721s[collection.address] && collection.collectibles.length > 0) {
          toBeLearned.erc721s[collection.address] = collection.collectibles
        }

        acc.push({
          ...collection,
          priceIn: getTokenDataFromCache(collection.address)?.priceIn || []
        })
        return acc
      },
      []
    )

    const oracleCallDone = Date.now()

    // Update prices and set the priceIn for each token by reference,
    // updating the final tokens array as a result
    const tokensWithPrices: TokenResult[] = await Promise.all(
      tokensWithoutPrices.map(
        async (token: Omit<TokenResult, 'priceIn' | 'marketDataIn' | 'meta'>) => {
          let hasPrice = false
          const cachedTokenData = getTokenDataFromCache(token.address, tokenDataRecencyOnFailure)

          if (cachedTokenData && cachedTokenData.priceIn && cachedTokenData.priceIn.length > 0) {
            hasPrice = true

            return {
              ...(token as TokenResult),
              ...cachedTokenData
            }
          }

          if (!this.network.platformId) {
            return {
              ...token,
              priceIn: [],
              marketDataIn: []
            }
          }

          try {
            const tokenData = await this.batchedGecko({
              ...token,
              network: this.network,
              baseCurrency,
              // this is what to look for in the coingecko response object
              responseIdentifier: geckoResponseIdentifier(token.address, this.network)
            })

            const formattedTokenData = convertApiTokenDataToTokenDataCache(tokenData)

            if (
              formattedTokenData &&
              formattedTokenData.priceIn &&
              formattedTokenData.priceIn.length > 0
            ) {
              hasPrice = true
            }

            tokenDataCache.set(token.address, [Date.now(), formattedTokenData])

            return {
              ...token,
              ...formattedTokenData
            }
          } catch (error: any) {
            const errorMessage = error?.message || 'Unknown error'

            const olderCachedTokenData = getTokenDataFromCache(
              token.address,
              tokenDataRecencyOnFailure
            )

            if (
              olderCachedTokenData &&
              olderCachedTokenData.priceIn &&
              olderCachedTokenData.priceIn.length > 0
            ) {
              hasPrice = true
            }

            if (
              // Avoid duplicate errors, because this.bachedGecko is called for each token and if
              // there is an error it will most likely be the same for all tokens
              !errors.find(
                (x) =>
                  x.name === PORTFOLIO_LIB_ERROR_NAMES.PriceFetchError && x.message === errorMessage
              ) &&
              // Don't display an error if there is a cached price
              !hasPrice
            ) {
              errors.push({
                name: PORTFOLIO_LIB_ERROR_NAMES.PriceFetchError,
                message: errorMessage,
                level: 'warning'
              })
            }

            return {
              ...token,
              priceIn: olderCachedTokenData?.priceIn || [],
              marketDataIn: olderCachedTokenData?.marketDataIn || []
            }
          }
        }
      )
    )

    const priceUpdateDone = Date.now()

    return {
      toBeLearned,
      errors,
      updateStarted: start,
      discoveryTime: discoveryDone - start,
      oracleCallTime: oracleCallDone - discoveryDone,
      priceUpdateTime: priceUpdateDone - oracleCallDone,
      tokenDataCache,
      tokens: tokensWithPrices,
      feeTokens: tokensWithPrices.filter((t) => {
        // return the native token
        if (t.address === ZeroAddress && t.chainId === this.network.chainId) return true

        return gasTankFeeTokens.find(
          (gasTankT) =>
            gasTankT.address.toLowerCase() === t.address.toLowerCase() &&
            gasTankT.chainId === t.chainId
        )
      }),
      beforeNonce,
      afterNonce,
      blockNumber,
      tokenErrors: tokensWithErrResult
        .filter(([error, result]: [string, TokenResult]) => !isValidToken(error, result))
        .map(([error, result]: [string, TokenResult]) => ({ error, address: result.address })),
      collectionErrors: collectionsWithErrResult
        .filter(([error, result]: [string, CollectionResult]) => !isValidToken(error, result))
        .map(([error, result]: [string, CollectionResult]) => ({ error, address: result.address })),
      collections
    }
  }

  async getTokensByAddresses(
    accountAddr: string,
    tokenAddrs: string[],
    opts: Pick<GetOptions, 'blockTag' | 'simulation' | 'specialErc20Hints'>
  ): Promise<[TokenError, TokenResult][]> {
    const uniqueTokenAddrs = [...new Set(tokenAddrs)]

    if (!uniqueTokenAddrs.length) return []

    const limits: LimitsOptions = this.deploylessTokens.isLimitedAt24kbData
      ? LIMITS.deploylessProxyMode
      : LIMITS.deploylessStateOverrideMode

    const [tokensWithErrResult] = await flattenResults(
      paginate(uniqueTokenAddrs, limits.erc20).map((page, index) =>
        getTokens(this.network, this.deploylessTokens, opts, accountAddr, page, index)
      )
    )

    return tokensWithErrResult.map(([error, token]) => [
      error,
      {
        ...token,
        priceIn: token.priceIn || [],
        marketDataIn: token.marketDataIn || []
      }
    ])
  }

  async getTokenPrice(
    address: string,
    {
      baseCurrency = 'usd',
      tokenDataCache = new Map(),
      tokenDataRecency = 0
    }: {
      baseCurrency?: string
      tokenDataCache?: TokenDataCache
      tokenDataRecency?: number
    } = {}
  ): Promise<number | undefined> {
    const cachedTokenData = [...tokenDataCache.entries()].find(
      ([cachedAddress]) => cachedAddress.toLowerCase() === address.toLowerCase()
    )?.[1]

    if (cachedTokenData && Date.now() - cachedTokenData[0] <= tokenDataRecency) {
      return cachedTokenData[1].priceIn.find((price) => price.baseCurrency === baseCurrency)?.price
    }

    if (!this.network.platformId) return undefined

    const tokenData = await this.batchedGecko({
      address,
      network: this.network,
      baseCurrency,
      responseIdentifier: geckoResponseIdentifier(address, this.network)
    })
    const formattedTokenData = convertApiTokenDataToTokenDataCache(tokenData)

    tokenDataCache.set(address, [Date.now(), formattedTokenData])

    return formattedTokenData.priceIn.find((price) => price.baseCurrency === baseCurrency)?.price
  }
}
