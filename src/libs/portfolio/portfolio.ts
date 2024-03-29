/* eslint-disable no-restricted-syntax */
/* eslint-disable guard-for-in */

import { getAddress, JsonRpcProvider, Provider, ZeroAddress } from 'ethers'

import BalanceGetter from '../../../contracts/compiled/BalanceGetter.json'
import NFTGetter from '../../../contracts/compiled/NFTGetter.json'
import { PINNED_TOKENS } from '../../consts/pinnedTokens'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { Deployless, fromDescriptor } from '../deployless/deployless'
import batcher from './batcher'
import { geckoRequestBatcher, geckoResponseIdentifier } from './gecko'
import { getNFTs, getTokens } from './getOnchainBalances'
import {
  CollectionResult,
  GetOptions,
  Hints,
  Limits,
  LimitsOptions,
  PortfolioGetResult,
  Price,
  PriceCache,
  TokenResult
} from './interfaces'
import { flattenResults, paginate } from './pagination'

const LIMITS: Limits = {
  // we have to be conservative with erc721Tokens because if we pass 30x20 (worst case) tokenIds, that's 30x20 extra words which is 19kb
  // proxy mode input is limited to 24kb
  deploylessProxyMode: { erc20: 100, erc721: 30, erc721TokensInput: 20, erc721Tokens: 50 },
  // theoretical capacity is 1666/450
  deploylessStateOverrideMode: {
    erc20: 500,
    erc721: 100,
    erc721TokensInput: 100,
    erc721Tokens: 100
  }
}

export const getEmptyHints = (networkId: string, accountAddr: string): Hints => ({
  networkId,
  accountAddr,
  erc20s: [],
  erc721s: {},
  prices: {},
  hasHints: false
})

const defaultOptions: GetOptions = {
  baseCurrency: 'usd',
  blockTag: 'latest',
  priceRecency: 0,
  additionalHints: [],
  fetchPinned: true,
  isEOA: false
}

export class Portfolio {
  network: NetworkDescriptor

  private batchedVelcroDiscovery: Function

  private batchedGecko: Function

  private deploylessTokens: Deployless

  private deploylessNfts: Deployless

  constructor(fetch: Function, provider: Provider | JsonRpcProvider, network: NetworkDescriptor) {
    this.batchedVelcroDiscovery = batcher(fetch, (queue) => {
      const baseCurrencies = [...new Set(queue.map((x) => x.data.baseCurrency))]
      return baseCurrencies.map((baseCurrency) => {
        const queueSegment = queue.filter((x) => x.data.baseCurrency === baseCurrency)
        const url = `https://relayer.ambire.com/velcro-v3/multi-hints?networks=${queueSegment
          .map((x) => x.data.networkId)
          .join(',')}&accounts=${queueSegment
          .map((x) => x.data.accountAddr)
          .join(',')}&baseCurrency=${baseCurrency}`
        return { queueSegment, url }
      })
    })
    this.batchedGecko = batcher(fetch, geckoRequestBatcher)
    this.network = network
    this.deploylessTokens = fromDescriptor(provider, BalanceGetter, !network.rpcNoStateOverride)
    this.deploylessNfts = fromDescriptor(provider, NFTGetter, !network.rpcNoStateOverride)
  }

  async get(accountAddr: string, opts: Partial<GetOptions> = {}): Promise<PortfolioGetResult> {
    const localOpts = { ...defaultOptions, ...opts }
    const { baseCurrency } = localOpts
    if (localOpts.simulation && localOpts.simulation.account.addr !== accountAddr)
      throw new Error('wrong account passed')

    // Get hints (addresses to check on-chain) via Velcro
    const start = Date.now()
    const networkId = this.network.id

    // Make sure portfolio lib still works, even in the case Velcro discovery fails.
    // Because of this, we fall back to Velcro default response.
    let hints: Hints
    try {
      // if the network doesn't have a relayer, velcro will not work
      // but we should not record an error if such is the case
      hints = this.network.hasRelayer
        ? await this.batchedVelcroDiscovery({ networkId, accountAddr, baseCurrency })
        : getEmptyHints(networkId, accountAddr)
    } catch (error: any) {
      hints = {
        ...getEmptyHints(networkId, accountAddr),
        error
      }
    }

    // Always add 0x00 to hints
    hints.erc20s = [...hints.erc20s, ZeroAddress]

    // Enrich hints with the previously found and cached hints, especially in the case the Velcro discovery fails.
    if (localOpts.previousHints) {
      hints = {
        ...hints,
        // Unique list of previously discovered and currently discovered erc20s
        erc20s: [...localOpts.previousHints.erc20s, ...hints.erc20s],
        // Please note 2 things:
        // 1. Velcro hints data takes advantage over previous hints because, in most cases, Velcro data is more up-to-date than the previously cached hints.
        // 2. There is only one use-case where the previous hints data is more recent, and that is when we find an NFT token via a pending simulation.
        // In order to support it, we have to apply a complex deep merging algorithm (which may become problematic if the Velcro API changes)
        // and also have to introduce an algorithm for self-cleaning outdated/previous NFT tokens.
        // However, we have chosen to keep it as simple as possible and disregard this rare case.
        erc721s: { ...localOpts.previousHints.erc721s, ...hints.erc721s }
      }
    }

    if (localOpts.additionalHints) {
      hints.erc20s = [...hints.erc20s, ...localOpts.additionalHints]
    }

    if (localOpts.fetchPinned) {
      hints.erc20s = [...hints.erc20s, ...PINNED_TOKENS.map((x) => x.address)]
    }

    // Remove duplicates
    hints.erc20s = [...new Set(hints.erc20s.map((erc20) => getAddress(erc20)))]

    // This also allows getting prices, this is used for more exotic tokens that cannot be retrieved via Coingecko
    const priceCache: PriceCache = localOpts.priceCache || new Map()
    for (const addr in hints.prices || {}) {
      const priceHint = hints.prices[addr]
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
        paginate(hints.erc20s, limits.erc20).map((page) =>
          getTokens(this.network, this.deploylessTokens, localOpts, accountAddr, page)
        )
      ),
      flattenResults(
        paginate(collectionsHints, limits.erc721).map((page) =>
          getNFTs(this.network, this.deploylessNfts, localOpts, accountAddr, page, limits)
        )
      )
    ])

    // Re-map/filter into our format
    const getPriceFromCache = (address: string) => {
      const cached = priceCache.get(address)
      if (!cached) return null
      const [timestamp, entry] = cached
      const eligible = entry.filter((x) => x.baseCurrency === baseCurrency)
      // by using `start` instead of `Date.now()`, we make sure that prices updated from Velcro will not be updated again
      // even if priceRecency is 0
      if (start - timestamp <= localOpts.priceRecency! && eligible.length) return eligible
      return null
    }

    const tokenFilter = ([error, result]: [string, TokenResult]): boolean => {
      if (error !== '0x' || result.symbol === '') return false

      if (result.amount > 0) return true

      const isPinned = !!PINNED_TOKENS.find((pinnedToken) => {
        return pinnedToken.networkId === networkId && pinnedToken.address === result.address
      })

      // if the amount is 0
      // return the token if it's pinned and requested
      // or if it's not pinned but under the limit
      const pinnedRequested = isPinned && localOpts.fetchPinned
      const underLimit = !isPinned && tokensWithErr.length <= limits.erc20 / 2
      return pinnedRequested || underLimit
    }

    const tokens = tokensWithErr
      .filter((tokenWithErr) => tokenFilter(tokenWithErr))
      .map(([, result]) => result)

    const unfilteredCollections = collectionsWithErr.map(([error, x], i) => {
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
      .filter((preFilterCollection) => tokenFilter(preFilterCollection))
      .map(([, collection]) => collection)

    const oracleCallDone = Date.now()

    // Update prices and set the priceIn for each token by reference,
    // updating the final tokens array as a result
    await Promise.all(
      tokens.map(async (token) => {
        const cachedPriceIn = getPriceFromCache(token.address)
        if (cachedPriceIn) {
          // reassinging priceIn to the function param is not an ideal
          // solution in this case as it's harder for reading but we're
          // going along with it. Please understand that the final tokens
          // array is updated with the edited token in this scope
          /* eslint-disable-next-line no-param-reassign */
          token.priceIn = cachedPriceIn
          return
        }

        try {
          const priceData = await this.batchedGecko({
            ...token,
            network: this.network,
            baseCurrency,
            // this is what to look for in the coingecko response object
            responseIdentifier: geckoResponseIdentifier(token.address, this.network)
          })
          const priceIn: Price[] = Object.entries(priceData || {}).map(([baseCurr, price]) => ({
            baseCurrency: baseCurr,
            price: price as number
          }))
          if (priceIn.length) priceCache.set(token.address, [Date.now(), priceIn])
          /* eslint-disable-next-line no-param-reassign */
          token.priceIn = priceIn
        } catch {
          /* eslint-disable-next-line no-param-reassign */
          token.priceIn = []
        }
      })
    )
    const priceUpdateDone = Date.now()

    return {
      // Raw hints response
      hints,
      updateStarted: start,
      discoveryTime: discoveryDone - start,
      oracleCallTime: oracleCallDone - discoveryDone,
      priceUpdateTime: priceUpdateDone - oracleCallDone,
      priceCache,
      tokens,
      tokenErrors: tokensWithErr
        .filter(([error, result]) => error !== '0x' || result.symbol === '')
        .map(([error, result]) => ({ error, address: result.address })),
      collections: collections.filter((x) => x.collectibles?.length),
      total: tokens.reduce((cur, token) => {
        const localCur = cur
        for (const x of token.priceIn) {
          localCur[x.baseCurrency] =
            (localCur[x.baseCurrency] || 0) +
            (Number(token.amount) / 10 ** token.decimals) * x.price
        }
        return localCur
      }, {}),
      // Add error field conditionally
      ...(hints.error && { hintsError: hints.error })
    }
  }
}
