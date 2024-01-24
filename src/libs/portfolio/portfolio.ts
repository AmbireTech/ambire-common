import { JsonRpcProvider, Provider } from 'ethers'

import BalanceGetter from '../../../contracts/compiled/BalanceGetter.json'
import NFTGetter from '../../../contracts/compiled/NFTGetter.json'
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
  pinned: []
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
    opts = { ...defaultOptions, ...opts }
    const { baseCurrency, pinned } = opts
    if (opts.simulation && opts.simulation.account.addr !== accountAddr)
      throw new Error('wrong account passed')

    // Get hints (addresses to check on-chain) via Velcro
    const start = Date.now()
    const networkId = this.network.id

    // Make sure portfolio lib still works, even in the case Velcro discovery fails.
    // Because of this, we fall back to Velcro default response.
    let hints: Hints
    try {
      hints = await this.batchedVelcroDiscovery({ networkId, accountAddr, baseCurrency })
    } catch (error: any) {
      hints = {
        ...getEmptyHints(networkId, accountAddr),
        error
      }
    }

    // Enrich hints with the previously found and cached hints, especially in the case the Velcro discovery fails.
    if (opts.previousHints) {
      hints = {
        ...hints,
        // Unique list of previously discovered and currently discovered erc20s
        erc20s: [...new Set([...opts.previousHints.erc20s, ...hints.erc20s])],
        // Please note 2 things:
        // 1. Velcro hints data takes advantage over previous hints because, in most cases, Velcro data is more up-to-date than the previously cached hints.
        // 2. There is only one use-case where the previous hints data is more recent, and that is when we find an NFT token via a pending simulation.
        // In order to support it, we have to apply a complex deep merging algorithm (which may become problematic if the Velcro API changes)
        // and also have to introduce an algorithm for self-cleaning outdated/previous NFT tokens.
        // However, we have chosen to keep it as simple as possible and disregard this rare case.
        erc721s: { ...opts.previousHints.erc721s, ...hints.erc721s }
      }
    }

    // add pinned tokens to the hints and dedup
    // Those will appear in the result even if they're zero amount
    hints.erc20s = [...new Set([...hints.erc20s, ...pinned!])]

    // This also allows getting prices, this is used for more exotic tokens that cannot be retrieved via Coingecko
    const priceCache: PriceCache = opts.priceCache || new Map()
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
          getTokens(this.network, this.deploylessTokens, opts, accountAddr, page)
        )
      ),
      flattenResults(
        paginate(collectionsHints, limits.erc721).map((page) =>
          getNFTs(this.network, this.deploylessNfts, opts, accountAddr, page, limits)
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
      if (start - timestamp <= opts.priceRecency! && eligible.length) return eligible
      return null
    }

    const tokenFilter = ([error, result]: [string, TokenResult]): boolean =>
      (result.amount > 0 || pinned!.includes(result.address)) &&
      error === '0x' &&
      result.symbol !== ''

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

    // Update prices
    await Promise.all(
      tokens.map(async (token) => {
        const cachedPriceIn = getPriceFromCache(token.address)
        if (cachedPriceIn) {
          token.priceIn = cachedPriceIn
          return
        }
        const priceData = await this.batchedGecko({
          ...token,
          networkId,
          baseCurrency,
          // this is what to look for in the coingecko response object
          responseIdentifier: geckoResponseIdentifier(token.address, networkId)
        })
        const priceIn: Price[] = Object.entries(priceData || {}).map(([baseCurrency, price]) => ({
          baseCurrency,
          price: price as number
        }))
        if (priceIn.length) priceCache.set(token.address, [Date.now(), priceIn])
        token.priceIn = priceIn
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
        for (const x of token.priceIn) {
          cur[x.baseCurrency] =
            (cur[x.baseCurrency] || 0) + (Number(token.amount) / 10 ** token.decimals) * x.price
        }
        return cur
      }, {}),
      // Add error field conditionally
      ...(hints.error && { hintsError: hints.error })
    }
  }
}
