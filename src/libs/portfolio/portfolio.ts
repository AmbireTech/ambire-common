import { Provider, JsonRpcProvider } from 'ethers'
import { Deployless } from '../deployless/deployless'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { nftOracle, balanceOracle } from './multiOracle.json'
import lodashMergeWith from 'lodash.mergewith'
import batcher from './batcher'
import { geckoRequestBatcher, geckoResponseIdentifier } from './gecko'
import { flattenResults, paginate } from './pagination'
import {
  TokenResult,
  Price,
  Limits,
  LimitsOptions,
  GetOptionsSimulation,
  PriceCache,
  PortfolioGetResult
} from './interfaces'
import { getNFTs, getTokens } from './getOnchainBalances'

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

export interface GetOptions {
  baseCurrency: string
  blockTag: string | number
  simulation?: GetOptionsSimulation
  priceCache?: PriceCache
  priceRecency: number
  previousHints?: any
}

const defaultOptions: GetOptions = {
  baseCurrency: 'usd',
  blockTag: 'latest',
  priceRecency: 0
}

export class Portfolio {
  private batchedVelcroDiscovery: Function
  private batchedGecko: Function
  private network: NetworkDescriptor
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
    this.deploylessTokens = new Deployless(
      provider,
      balanceOracle.abi,
      balanceOracle.bin,
      network.rpcNoStateOverride ? undefined : balanceOracle.binRuntime
    )
    this.deploylessNfts = new Deployless(
      provider,
      nftOracle.abi,
      nftOracle.bin,
      network.rpcNoStateOverride ? undefined : nftOracle.binRuntime
    )
  }

  async get(accountAddr: string, opts: Partial<GetOptions> = {}): Promise<PortfolioGetResult> {
    opts = { ...defaultOptions, ...opts }
    const { baseCurrency } = opts
    if (opts.simulation && opts.simulation.account.addr !== accountAddr)
      throw new Error('wrong account passed')

    // Get hints (addresses to check on-chain) via Velcro
    const start = Date.now()
    const networkId = this.network.id

    // Make sure portfolio lib still works, even in the case Velcro discovery fails.
    // Because of this, we fall back to Velcro default response.
    let hints
    try {
      hints = await this.batchedVelcroDiscovery({ networkId, accountAddr, baseCurrency })
    } catch (error) {
      hints = {
        networkId: networkId,
        accountAddr: accountAddr,
        erc20s: [],
        erc721s: {},
        prices: {},
        hasHints: false,
        error
      }
    }

    // Enrich hints with the previously found and cached hints, especially in the case the Velcro discovery fails.
    if (opts.previousHints) {
      // Deep nested merge. Here's an example if we merge hints + previousHints:
      // hints: { erc20s: [ "0x83e6f1E41cdd28eAcEB20Cb649155049Fac3D5Aa" ], erc721s: { "0xcF30DEf37DcB65d244F14E075Dc0ce875ccFa065": { isKnown: false, "tokens": [ "2442" ] } } }
      // previousHints: { erc20s: [ "0x83e6f1E41cdd28eAcEB20Cb649155049Fac3D5Aa", "0xEE1CeA7665bA7aa97e982EdeaeCb26B59a04d035" ], erc721s: { "0xcF30DEf37DcB65d244F14E075Dc0ce875ccFa065": { "tokens": [ "1111" ] } } }
      // result:  { erc20s: [ "0x83e6f1E41cdd28eAcEB20Cb649155049Fac3D5Aa", "0xEE1CeA7665bA7aa97e982EdeaeCb26B59a04d035" ], erc721s: { "0xcF30DEf37DcB65d244F14E075Dc0ce875ccFa065": { isKnown: false, "tokens": [ "2442", "1111" ] } } }
      hints = lodashMergeWith(
        hints,
        opts.previousHints,
        (hintValue: any, previousHintValue: any): Array<any> | void => {
          // In case of Array, get the unique set of hint and previousHint items
          if (Array.isArray(hintValue)) {
            return [...new Set([...hintValue, ...previousHintValue])]
          }
        }
      )
    }

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
          getNFTs(this.deploylessNfts, opts, accountAddr, page, limits)
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
      result.amount > 0 && error == '0x' && result.symbol !== ''

    const tokens = tokensWithErr.filter(tokenFilter).map(([_, result]) => result)

    const collections = collectionsWithErr.filter(tokenFilter).map(([_, x], i) => {
      const address = collectionsHints[i][0] as unknown as string
      return {
        ...x,
        address: address,
        priceIn: getPriceFromCache(address) || []
      } as TokenResult
    })

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
      updateStarted: start,
      discoveryTime: discoveryDone - start,
      oracleCallTime: oracleCallDone - discoveryDone,
      priceUpdateTime: priceUpdateDone - oracleCallDone,
      priceCache,
      tokens,
      tokenErrors: tokensWithErr
        .filter(([error, result]) => error !== '0x' || result.symbol === '')
        .map(([error, result]) => ({ error, address: result.address })),
      collections: collections.filter((x) => x.collectables?.length),
      total: tokens.reduce((cur, token) => {
        for (const x of token.priceIn) {
          cur[x.baseCurrency] =
            (cur[x.baseCurrency] || 0) + (Number(token.amount) / 10 ** token.decimals) * x.price
        }
        return cur
      }, {})
    }
  }
}
