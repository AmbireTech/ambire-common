/* eslint-disable import/no-cycle */
/* eslint-disable no-restricted-syntax */
import { JsonRpcProvider, Provider, ZeroAddress } from 'ethers'
/* eslint-disable guard-for-in */
import { getAddress } from 'viem'

import BalanceGetter from '../../../contracts/compiled/BalanceGetter.json'
import NFTGetter from '../../../contracts/compiled/NFTGetter.json'
import gasTankFeeTokens from '../../consts/gasTankFeeTokens'
import { PINNED_TOKENS } from '../../consts/pinnedTokens'
import { Fetch } from '../../interfaces/fetch'
import { Network } from '../../interfaces/network'
import { Deployless, fromDescriptor } from '../deployless/deployless'
import batcher from './batcher'
import { geckoRequestBatcher, geckoResponseIdentifier } from './gecko'
import { getNFTs, getTokens } from './getOnchainBalances'
import {
  stripExternalHintsAPIResponse,
  stripExternalHintsAPIResponseAndEnsureNotCached,
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
  PriceCache,
  StrippedExternalHintsAPIResponse,
  TokenError,
  TokenResult
} from './interfaces'
import { flattenResults, paginate } from './pagination'

export const LIMITS: Limits = {
  // we have to be conservative with erc721Tokens because if we pass 30x20 (worst case) tokenIds, that's 30x20 extra words which is 19kb
  // proxy mode input is limited to 24kb
  deploylessProxyMode: { erc20: 66, erc721: 30, erc721TokensInput: 20, erc721Tokens: 50 },
  // theoretical capacity is 1666/450
  deploylessStateOverrideMode: {
    erc20: 230,
    erc721: 70,
    erc721TokensInput: 70,
    erc721Tokens: 70
  }
}

export const PORTFOLIO_LIB_ERROR_NAMES = {
  /** External hints API (Velcro) request failed but fallback is sufficient */
  NonCriticalApiHintsError: 'NonCriticalApiHintsError',
  /** External API (Velcro) hints are older than X minutes */
  StaleApiHintsError: 'StaleApiHintsError',
  /** No external API (Velcro) hints are available- the request failed without fallback */
  NoApiHintsError: 'NoApiHintsError',
  /** One or more cena request has failed */
  PriceFetchError: 'PriceFetchError'
}

export const getEmptyHints = (): Hints => ({
  erc20s: [],
  erc721s: {},
  externalApi: undefined
})

const defaultOptions: GetOptions = {
  baseCurrency: 'usd',
  blockTag: 'latest',
  priceRecency: 0,
  previousHintsFromExternalAPI: null,
  fetchPinned: true,
  priceRecencyOnFailure: 1 * 60 * 60 * 1000 // 1 hour
}

export class Portfolio {
  network: Network

  private batchedVelcroDiscovery: Function

  private batchedGecko: Function

  private deploylessTokens: Deployless

  private deploylessNfts: Deployless

  constructor(
    fetch: Fetch,
    provider: Provider | JsonRpcProvider,
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
   * - hints from `previousHintsFromExternalAPI` if the request fails and previousHintsFromExternalAPI is set
   */
  protected async externalHintsAPIDiscovery(options?: {
    previousHintsFromExternalAPI: StrippedExternalHintsAPIResponse | null
    disableAutoDiscovery?: boolean
    chainId: bigint
    accountAddr: string
    baseCurrency: string
  }): Promise<{
    hints: Hints

    error?: PortfolioLibGetResult['errors'][number]
  }> {
    const {
      previousHintsFromExternalAPI,
      disableAutoDiscovery = false,
      chainId,
      accountAddr,
      baseCurrency
    } = options || {}
    let hints: Hints = getEmptyHints()

    try {
      // Fetch the latest hints from the external API (Velcro)
      if (!disableAutoDiscovery) {
        let hintsFromExternalAPI: ExternalHintsAPIResponse = await this.batchedVelcroDiscovery({
          chainId,
          accountAddr,
          baseCurrency
        })

        if (hintsFromExternalAPI) {
          // If the db is temporarily unavailable, the server falls back to static hints, even
          // for networks where hints are dynamic (coming from the db). In this case, we don't
          // want to override the saved hints, because they are more relevant to the user.
          if (hintsFromExternalAPI.skipOverrideSavedHints && previousHintsFromExternalAPI) {
            hintsFromExternalAPI = {
              ...hintsFromExternalAPI,
              erc20s: previousHintsFromExternalAPI.erc20s,
              erc721s: previousHintsFromExternalAPI.erc721s,
              // Spread it just in case we have saved a false value before
              skipOverrideSavedHints: true
            }
          }

          const stripped = stripExternalHintsAPIResponse(hintsFromExternalAPI)

          if (stripped) {
            hints = stripped
            // Attach the property as the hints are coming from the external API
            hints.externalApi = {
              lastUpdate: Date.now(),
              prices: hintsFromExternalAPI.prices,
              hasHints: !!hintsFromExternalAPI.hasHints,
              skipOverrideSavedHints: hintsFromExternalAPI.skipOverrideSavedHints
            }
          }
        }

        return {
          hints
        }
      }

      // Read the hints from storage (if they exist)
      if (previousHintsFromExternalAPI) {
        hints = { ...previousHintsFromExternalAPI }
      }

      return {
        hints
      }
    } catch (error: any) {
      const errorMesssage = `Failed to fetch hints from Velcro for chainId (${chainId}): ${error.message}`

      // It's important for DX to see this error
      // eslint-disable-next-line no-console
      console.error(errorMesssage)

      if (!previousHintsFromExternalAPI) {
        return {
          hints,
          error: {
            name: PORTFOLIO_LIB_ERROR_NAMES.NoApiHintsError,
            message: errorMesssage,
            level: 'critical'
          }
        }
      }

      const TEN_MINUTES = 10 * 60 * 1000
      const lastUpdate = previousHintsFromExternalAPI.lastUpdate
      const isLastUpdateTooOld = Date.now() - lastUpdate > TEN_MINUTES

      return {
        hints: { ...previousHintsFromExternalAPI },
        error: {
          name: isLastUpdateTooOld
            ? PORTFOLIO_LIB_ERROR_NAMES.StaleApiHintsError
            : PORTFOLIO_LIB_ERROR_NAMES.NonCriticalApiHintsError,
          message: errorMesssage,
          level: isLastUpdateTooOld ? 'critical' : 'silent'
        }
      }
    }
  }

  async get(accountAddr: string, opts: Partial<GetOptions> = {}): Promise<PortfolioLibGetResult> {
    const errors: PortfolioLibGetResult['errors'] = []
    const {
      simulation,
      previousHintsFromExternalAPI,
      disableAutoDiscovery = false,
      baseCurrency,
      fetchPinned,
      additionalErc20Hints,
      additionalErc721Hints,
      specialErc20Hints,
      blockTag,
      priceRecencyOnFailure,
      priceCache: paramsPriceCache,
      priceRecency
    } = { ...defaultOptions, ...opts }
    const toBeLearned: PortfolioLibGetResult['toBeLearned'] = {
      erc20s: [],
      erc721s: {}
    }
    if (simulation && simulation.account.addr !== accountAddr)
      throw new Error('wrong account passed')

    const start = Date.now()
    const chainId = this.network.chainId

    const { hints, error: hintsError } = await this.externalHintsAPIDiscovery({
      previousHintsFromExternalAPI: previousHintsFromExternalAPI ?? null,
      disableAutoDiscovery,
      chainId,
      accountAddr,
      baseCurrency
    })
    // Clone the hints as we are modifying them below and the original
    // result is needed in the return value.
    const originalApiHints = structuredClone(hints)

    if (hintsError) errors.push(hintsError)

    // Please note 2 things:
    // 1. Velcro hints data takes advantage over previous hints because, in most cases, Velcro data is more up-to-date than the previously cached hints.
    // 2. There is only one use-case where the previous hints data is more recent, and that is when we find an NFT token via a pending simulation.
    // In order to support it, we have to apply a complex deep merging algorithm (which may become problematic if the Velcro API changes)
    // and also have to introduce an algorithm for self-cleaning outdated/previous NFT tokens.
    // However, we have chosen to keep it as simple as possible and disregard this rare case.
    if (additionalErc721Hints) {
      hints.erc721s = { ...additionalErc721Hints, ...hints.erc721s }
    }

    if (additionalErc20Hints) {
      hints.erc20s = [...hints.erc20s, ...additionalErc20Hints]
    }

    if (fetchPinned) {
      hints.erc20s = [...hints.erc20s, ...PINNED_TOKENS.map((x) => x.address)]
    }

    // add the fee tokens
    hints.erc20s = [
      ...hints.erc20s,
      ...Object.keys(specialErc20Hints || {}),
      ...(additionalErc20Hints || []),
      ...(fetchPinned ? PINNED_TOKENS.map((x) => x.address) : []),
      ...gasTankFeeTokens.filter((x) => x.chainId === this.network.chainId).map((x) => x.address)
    ]

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

    // Remove duplicates and always add ZeroAddress
    hints.erc20s = [...new Set(checksummedErc20Hints.concat(ZeroAddress))]

    // This also allows getting prices, this is used for more exotic tokens that cannot be retrieved via Coingecko
    const priceCache: PriceCache = paramsPriceCache || new Map()
    for (const addr in hints.externalApi?.prices || {}) {
      const priceHint = hints.externalApi?.prices[addr]
      // eslint-disable-next-line no-continue
      if (!priceHint) continue
      // @TODO consider validating the external response here, before doing the .set; or validating the whole velcro response
      priceCache.set(addr, [start, Array.isArray(priceHint) ? priceHint : [priceHint]])
    }
    const discoveryDone = Date.now()

    // .isLimitedAt24kbData should be the same for both instances; @TODO more elegant check?
    const limits: LimitsOptions = this.deploylessTokens.isLimitedAt24kbData
      ? LIMITS.deploylessProxyMode
      : LIMITS.deploylessStateOverrideMode
    const collectionsHints = Object.entries(hints.erc721s)
    const [tokensWithErr, collectionsWithErr] = await Promise.all([
      flattenResults(
        paginate(hints.erc20s, limits.erc20).map((page, index) =>
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
    const getPriceFromCache = (address: string, _priceRecency: number = priceRecency) => {
      const cached = priceCache.get(address)
      if (!cached) return null
      const [timestamp, entry] = cached
      const eligible = entry.filter((x) => x.baseCurrency === baseCurrency)
      // by using `start` instead of `Date.now()`, we make sure that prices updated from Velcro will not be updated again
      // even if priceRecency is 0
      const isStale = start - timestamp > _priceRecency
      return isStale ? null : eligible
    }

    const nativeToken = tokensWithErrResult.find(
      ([, result]) => result.address === ZeroAddress
    )?.[1]

    const isValidToken = (error: TokenError, token: TokenResult): boolean =>
      error === '0x' && !!token.symbol

    const tokensWithoutPrices = tokensWithErrResult
      .filter((_tokensWithErrResult: [TokenError, TokenResult]) => {
        if (!isValidToken(_tokensWithErrResult[0], _tokensWithErrResult[1])) return false

        // Don't filter by balance/custom/hidden etc. if this param isn't passed
        // The portfolio lib is used outside the controller, in which case we want to
        // fetch all tokens regardless of their balance or type
        if (!specialErc20Hints) return true

        const isToBeLearned = specialErc20Hints[_tokensWithErrResult[1].address] === 'learn'

        return tokenFilter(
          _tokensWithErrResult[1],
          this.network,
          isToBeLearned,
          !!fetchPinned,
          nativeToken
        )
      })
      .map(([, result]) => {
        // Filter out hints of zero-balance tokens
        if (
          result.amount === 0n &&
          originalApiHints.externalApi?.hasHints === false &&
          originalApiHints.erc20s.includes(result.address)
        ) {
          console.log('Filtering out zero-balance token', result.address)
          originalApiHints.erc20s = originalApiHints.erc20s.filter(
            (x) => x.toLowerCase() !== result.address.toLowerCase()
          )
        }

        if (
          !result.amount ||
          result.flags.isCustom ||
          result.flags.isHidden ||
          toBeLearned.erc20s.includes(result.address)
        ) {
          return result
        }

        // Add tokens proposed by the controller to toBeLearned
        if (
          specialErc20Hints &&
          specialErc20Hints[result.address] &&
          specialErc20Hints[result.address] === 'learn'
        ) {
          toBeLearned.erc20s.push(result.address)
          // Add tokens proposed by the external API to toBeLearned
          // if the response API is static. That is because the static
          // response may change and the user may stop seeing the token
        } else if (
          hints.externalApi &&
          !hints.externalApi.hasHints &&
          !hints.externalApi.skipOverrideSavedHints
        ) {
          toBeLearned.erc20s.push(result.address)
        }

        return result
      })

    const unfilteredCollections = collectionsWithErrResult.map(([error, x], i) => {
      const address = collectionsHints[i][0] as unknown as string
      return [
        error,
        {
          ...x,
          address,
          priceIn: getPriceFromCache(address) || []
        }
      ] as [string, CollectionResult]
    })

    const collections = unfilteredCollections
      .filter((preFilterCollection) => isValidToken(preFilterCollection[0], preFilterCollection[1]))
      .map(([, collection]) => collection)

    const oracleCallDone = Date.now()

    // Update prices and set the priceIn for each token by reference,
    // updating the final tokens array as a result
    const tokensWithPrices: TokenResult[] = await Promise.all(
      tokensWithoutPrices.map(async (token: { address: string }) => {
        let priceIn: TokenResult['priceIn'] = []
        const cachedPriceIn = getPriceFromCache(token.address)

        if (cachedPriceIn && cachedPriceIn !== null) {
          priceIn = cachedPriceIn

          return {
            ...(token as TokenResult),
            priceIn
          }
        }

        if (!this.network.platformId) {
          return {
            ...(token as TokenResult),
            priceIn
          }
        }

        try {
          const priceData = await this.batchedGecko({
            ...token,
            network: this.network,
            baseCurrency,
            // this is what to look for in the coingecko response object
            responseIdentifier: geckoResponseIdentifier(token.address, this.network)
          })

          priceIn = Object.entries(priceData || {}).map(([baseCurr, price]) => ({
            baseCurrency: baseCurr,
            price: price as number
          }))
          priceCache.set(token.address, [Date.now(), priceIn])
        } catch (error: any) {
          const errorMessage = error?.message || 'Unknown error'

          priceIn = getPriceFromCache(token.address, priceRecencyOnFailure) || []

          if (
            // Avoid duplicate errors, because this.bachedGecko is called for each token and if
            // there is an error it will most likely be the same for all tokens
            !errors.find(
              (x) =>
                x.name === PORTFOLIO_LIB_ERROR_NAMES.PriceFetchError && x.message === errorMessage
            ) &&
            // Don't display an error if there is a cached price
            !priceIn.length
          ) {
            errors.push({
              name: PORTFOLIO_LIB_ERROR_NAMES.PriceFetchError,
              message: errorMessage,
              level: 'warning'
            })
          }
        }

        return {
          ...(token as TokenResult),
          priceIn
        }
      })
    )

    const priceUpdateDone = Date.now()

    return {
      toBeLearned,
      hintsFromExternalAPI: stripExternalHintsAPIResponseAndEnsureNotCached(originalApiHints),
      errors,
      updateStarted: start,
      discoveryTime: discoveryDone - start,
      oracleCallTime: oracleCallDone - discoveryDone,
      priceUpdateTime: priceUpdateDone - oracleCallDone,
      priceCache,
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
        .filter(([error, result]: [string, TokenResult]) => error !== '0x' || result.symbol === '')
        .map(([error, result]: [string, TokenResult]) => ({ error, address: result.address })),
      collections
    }
  }
}
