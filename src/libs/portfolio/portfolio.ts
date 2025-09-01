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
import { formatExternalHintsAPIResponse, mergeERC721s, tokenFilter } from './helpers'
import {
  CollectionResult,
  ExternalHintsAPIResponse,
  GetOptions,
  Hints,
  Limits,
  LimitsOptions,
  PortfolioLibGetResult,
  PriceCache,
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
   */
  protected async externalHintsAPIDiscovery(options?: {
    previousHintsFromExternalAPI: PortfolioLibGetResult['hintsFromExternalAPI'] | null
    disableAutoDiscovery?: boolean
    chainId: bigint
    accountAddr: string
    baseCurrency: string
  }): Promise<{
    hints: Hints
    error?: PortfolioLibGetResult['errors'][number]
  }> {
    const {
      disableAutoDiscovery = false,
      previousHintsFromExternalAPI,
      chainId,
      accountAddr,
      baseCurrency
    } = options || {}
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

        return {
          hints
        }
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
        hints,
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
      specialErc721Hints,
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

    if (hintsError) errors.push(hintsError)

    hints.erc20s = [
      ...hints.erc20s,
      ...Object.keys(specialErc20Hints || {}),
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
          // Add non-zero tokens to toBeLearned
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
      .map(([, collection]) => {
        if (!toBeLearned.erc721s[collection.address] && collection.collectibles.length) {
          toBeLearned.erc721s[collection.address] = collection.collectibles
        }

        return collection
      })

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
      hintsFromExternalAPI: hints.externalApi
        ? {
            lastUpdate: hints.externalApi.lastUpdate,
            hasHints: hints.externalApi.hasHints
          }
        : null,
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
