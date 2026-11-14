import { formatUnits, ZeroAddress } from 'ethers'

import PriceGetter from '../../../contracts/compiled/PriceGetter.json'
import { getPrivacyPoolsChainConfig } from '../../consts/privacyPools'
import { getRpcTokenPriceConfig, RpcTokenPriceConfig } from '../../consts/rpcTokenPrices'
import { Network } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import isSameAddr from '../../utils/isSameAddr'
import { paginate } from '../../utils/paginate'
import { fromDescriptor } from '../deployless/deployless'
import { getTokenDataCacheKey } from '../portfolio/helpers'
import { getFeeToken } from '../portfolio/tokenProcessing'

/** Pools with less liquidity than this percentage of the token's most liquid pool are left out */
const LIQUIDITY_THRESHOLD_PERCENT = 10n
/** The most tokens asked for in one call. The contract stops earlier when the call runs low on gas. */
const TOKENS_PER_CALL = 20
/** The aggregator's rate is scaled by 1e18, and by 1e18 over the token's decimals */
const RATE_DECIMALS = 36
/**
 * A token whose deepest pool holds less than this much, in USD, of the wrapped native token or of
 * a stablecoin has no price, unless it's one of our curated tokens (see `isCuratedToken`). A pool
 * that small is cheap to set up with any price, which is how scam tokens show a convincing value:
 * e.g. a drained pool left with $0.02 of ETH on each side of a made-up ratio, or a narrow Uniswap
 * v3 position with a few dollars in it.
 *
 * Only the pools of the network's main DEXes are looked up (see `SpotPriceConfig.poolFactories`),
 * so a token that trades only elsewhere (e.g. Uniswap v4, Balancer, or Curve pools older than its
 * "ng" factories) needs to be curated to have a price.
 */
export const MIN_POOL_DEPTH_USD = 1000
/** The native token of every network with a config has 18 decimals */
const NATIVE_DECIMALS = 18
/** The contract scales the stablecoin reserves to 18 decimals */
const STABLE_RESERVE_DECIMALS = 18

/** The USD price of each token, keyed like the price cache (`getTokenDataCacheKey`). Null when it has no price. */
export type RpcTokenPrices = Map<string, number | null>

export type RpcTokenPricesResult = {
  /**
   * The tokens that were answered, with a price or with "no price". Tokens in a call that failed
   * are left out, so that they aren't taken as having no price. A token that needs more gas than
   * the RPC gives a call has no price, as it never will on that RPC.
   */
  prices: RpcTokenPrices
  /** Why some tokens were left out, if any were */
  error: Error | null
}

type NativeUsdPrice = { answer: bigint; decimals: number }

/** A token's rate as the contract returns it, decoded */
type TokenRate = {
  /** The rate to the native token, 0 when the token has no price */
  rateToNative: bigint
  decimals: number
  /** How much of the wrapped native token (in wei) the token's deepest pool against it holds */
  nativeReserve: bigint
  /** How many stablecoins (scaled to 18 decimals) the token's deepest pool against one holds */
  stableReserve: bigint
  /** Whether the token is the native token or wraps it, which leaves the reserves unknown */
  isNative: boolean
}

type GetPricesResult = {
  nativeUsdPrice: NativeUsdPrice
  /** Each checked token's rate, in the order the tokens were passed */
  rates: TokenRate[]
}

/** The rate of a token that wasn't priced */
const NO_RATE: TokenRate = {
  rateToNative: 0n,
  decimals: 0,
  nativeReserve: 0n,
  stableReserve: 0n,
  isNative: false
}

/** What a page of tokens read */
type PageRates = {
  nativeUsdPrice: NativeUsdPrice
  /** The rate of each token that was checked, by its address */
  rateByAddress: Map<string, TokenRate>
  /** Why some of the page's tokens weren't checked, if any weren't */
  error: Error | null
}

const toError = (error: unknown, network: Network): Error =>
  error instanceof Error ? error : new Error(`Failed to read some token prices on ${network.name}`)

/**
 * Whether the token is on one of the short lists of liquid tokens we keep for the chain: the Gas
 * Tank fee tokens, and the assets the Privacy Pools accept
 */
const isCuratedToken = (address: string, chainId: bigint): boolean =>
  !!getFeeToken(address, chainId) ||
  !!getPrivacyPoolsChainConfig(chainId)?.assets.some((asset) => isSameAddr(asset.address, address))

/** The native token and its wrapped version, both priced by the native token's feed */
const isNativeOrWrappedNative = (address: string, wrappedNative: string | undefined): boolean =>
  isSameAddr(address, ZeroAddress) || (!!wrappedNative && isSameAddr(address, wrappedNative))

/** What the contract returns, as decoded */
type PriceGetterResult = readonly [
  { answer: bigint; decimals: number; updatedAt: bigint },
  readonly TokenRate[],
  bigint
]

const getNativeUsdPrice = (
  { answer, decimals, updatedAt }: PriceGetterResult[0],
  config: RpcTokenPriceConfig,
  network: Network
): NativeUsdPrice => {
  const ageSeconds = Date.now() / 1000 - Number(updatedAt)

  if (answer <= 0n) throw new Error(`The price feed of ${network.name} reported no price`)
  if (ageSeconds > config.nativeUsdFeedMaxAgeSeconds)
    throw new Error(`The price feed of ${network.name} hasn't been updated recently`)

  return { answer, decimals }
}

/**
 * Asks for the rates of the tokens, again for those the contract didn't get to before the call
 * ran low on gas, until every token was checked. A token that needs more gas than the RPC gives
 * a call gets no rate, so that it doesn't hold up the rest. Throws if nothing could be read; when
 * a later call fails, what the earlier ones read is kept and the error is returned along with it.
 */
const getRates = async (
  call: (tokens: string[]) => Promise<[GetPricesResult, number]>,
  tokens: string[],
  network: Network
): Promise<PageRates> => {
  const rateByAddress = new Map<string, TokenRate>()
  let nativeUsdPrice: NativeUsdPrice | null = null
  let error: Error | null = null
  let remainingTokens = tokens
  // A call that checks no token means either that its first token needs more gas than the RPC
  // gives a call, or that the RPC gives too little gas for any token. The token is set aside
  // until the next call tells which.
  let tokenNeedingMoreGas: string | null = null

  const setAsOverGasLimit = (address: string) => {
    // Reported as having no price rather than as an error: it would be the same on every update,
    // so the balance would always show a price warning for one odd token. It's asked for again
    // once its "no price" expires from the cache.
    console.warn(`rpcTokenPrices: ${address} needs more gas than the RPC of ${network.name} allows`)
    rateByAddress.set(address, NO_RATE)
  }
  const notEnoughGasError = new Error(`Not enough gas to read some token prices on ${network.name}`)

  do {
    let result: GetPricesResult
    let checkedCount: number
    try {
      ;[result, checkedCount] = await call(remainingTokens)
    } catch (callError) {
      if (!nativeUsdPrice) throw callError

      error = toError(callError, network)
      break
    }

    nativeUsdPrice = result.nativeUsdPrice

    const [firstToken] = remainingTokens
    if (!checkedCount && firstToken) {
      // Two calls in a row checked nothing, so it's the RPC: the tokens are left out, as with a
      // failed call, rather than all taken as having no price
      if (tokenNeedingMoreGas) {
        error = notEnoughGasError
        break
      }

      tokenNeedingMoreGas = firstToken
      remainingTokens = remainingTokens.slice(1)
    } else {
      // Another token fit in a call, so the one set aside is the one that needs more gas
      if (tokenNeedingMoreGas) setAsOverGasLimit(tokenNeedingMoreGas)
      tokenNeedingMoreGas = null

      remainingTokens
        .slice(0, checkedCount)
        .forEach((address, index) => rateByAddress.set(address, result.rates[index]!))
      remainingTokens = remainingTokens.slice(checkedCount)
    }
  } while (remainingTokens.length)

  // The page's last token was set aside, so no later call can tell: it's the token's fault only
  // if another of the page's tokens fit in a call
  if (tokenNeedingMoreGas && !error) {
    if (rateByAddress.size) setAsOverGasLimit(tokenNeedingMoreGas)
    else error = notEnoughGasError
  }

  return { nativeUsdPrice, rateByAddress, error }
}

/**
 * Reads the USD prices of the tokens from the network's RPC alone, without our price API: the
 * native token's price from its Chainlink feed, and every other token's price in the native
 * token from 1inch's spot price aggregator, which averages the token's DEX pools by liquidity.
 * A token that trades in no pool, or whose deepest pool on the network's main DEXes holds less
 * than MIN_POOL_DEPTH_USD of the wrapped native token or of a stablecoin (unless it's one of our
 * curated tokens), has no price. Pools far smaller than the token's most liquid one are left out
 * of its price. A token the config prices as another token
 * (e.g. stkWALLET as WALLET) takes that token's price.
 *
 * There is no market data (e.g. the 24h change), and only USD prices. The tokens are read in
 * pages, and a page that fails doesn't cost the others their prices: its tokens are left out and
 * the error is returned along with the rest.
 * Throws if the network can't be priced at all: no config, or every page failed (e.g. the native
 * token's price is missing or outdated).
 */
export const getRpcTokenPrices = async ({
  provider,
  network,
  tokenAddresses
}: {
  provider: RPCProvider
  network: Network
  tokenAddresses: string[]
}): Promise<RpcTokenPricesResult> => {
  const config = getRpcTokenPriceConfig(network.chainId)
  if (!config) throw new Error(`Token prices can't be read from the network on ${network.name}`)

  const { spotPrices } = config
  // The config's, as the networks that come from the relayer have no `wrappedAddr`
  const wrappedNative = spotPrices?.wrappedNative || network.wrappedAddr
  const priceGetter = fromDescriptor(provider, PriceGetter, !network.rpcNoStateOverride)
  // Where the contract looks for each token's pools. Empty without the aggregator, as no token
  // other than the native one is asked for.
  const poolSearch = {
    wrappedNative: wrappedNative || ZeroAddress,
    stablecoins: spotPrices?.stablecoins || [],
    factories: (spotPrices?.poolFactories || []).map(({ factory, kind, params }) => ({
      factory,
      kind,
      params: params.map(BigInt)
    }))
  }
  // The call has its own timeout (see `Deployless.call`)
  const call = async (tokens: string[]): Promise<[GetPricesResult, number]> => {
    const [nativePrice, rates, checkedCount]: PriceGetterResult = await priceGetter.call(
      'getPrices',
      [
        config.nativeUsdFeed,
        spotPrices?.oracle || ZeroAddress,
        tokens,
        LIQUIDITY_THRESHOLD_PERCENT,
        poolSearch,
        // The curated tokens skip the liquidity check, so looking up their pools would be wasted
        tokens.map((address) => !isCuratedToken(address, network.chainId))
      ]
    )

    return [
      { nativeUsdPrice: getNativeUsdPrice(nativePrice, config, network), rates: [...rates] },
      Number(checkedCount)
    ]
  }

  /** The token whose price the token takes: itself, unless the config prices it as another */
  const getPriceSource = (address: string): string =>
    config.tokensPricedAs?.find(({ token }) => isSameAddr(token, address))?.pricedAs || address

  const tokensToRate = spotPrices
    ? [...new Set(tokenAddresses.map(getPriceSource))].filter(
        (address) => !isNativeOrWrappedNative(address, wrappedNative)
      )
    : []
  // Every call reads the native token's price; one with no tokens reads only that
  const pages = tokensToRate.length ? paginate(tokensToRate, TOKENS_PER_CALL) : [[]]
  const settledPages = await Promise.allSettled(pages.map((page) => getRates(call, page, network)))
  const firstFailure = settledPages.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected'
  )
  const answeredPages = settledPages.flatMap((settled) =>
    settled.status === 'fulfilled' ? [settled.value] : []
  )
  if (!answeredPages.length) throw firstFailure!.reason

  const { nativeUsdPrice } = answeredPages[0]!
  const nativePrice = Number(formatUnits(nativeUsdPrice.answer, nativeUsdPrice.decimals))
  const getDeepestPoolUsd = ({ nativeReserve, stableReserve }: TokenRate): number =>
    Math.max(
      Number(formatUnits(nativeReserve, NATIVE_DECIMALS)) * nativePrice,
      Number(formatUnits(stableReserve, STABLE_RESERVE_DECIMALS))
    )
  const hasEnoughLiquidity = (address: string, rate: TokenRate) =>
    rate.isNative ||
    isCuratedToken(address, network.chainId) ||
    getDeepestPoolUsd(rate) >= MIN_POOL_DEPTH_USD

  const getPrice = (address: string, rate: TokenRate): number | null => {
    const { rateToNative, decimals } = rate
    if (!rateToNative || !hasEnoughLiquidity(address, rate)) return null

    // The rate times the native price, in a single division so that no precision is lost
    return Number(
      formatUnits(
        rateToNative * 10n ** BigInt(decimals) * nativeUsdPrice.answer,
        RATE_DECIMALS + nativeUsdPrice.decimals
      )
    )
  }

  const rateByKey = new Map<string, TokenRate>()
  answeredPages.forEach(({ rateByAddress }) => {
    rateByAddress.forEach((rate, address) => rateByKey.set(getTokenDataCacheKey(address), rate))
  })

  const prices: RpcTokenPrices = new Map()
  tokenAddresses.forEach((address) => {
    const key = getTokenDataCacheKey(address)
    const priceSource = getPriceSource(address)

    if (isNativeOrWrappedNative(priceSource, wrappedNative)) {
      prices.set(key, nativePrice)
      return
    }
    // Without the aggregator only the native token is priced: the rest have no price
    if (!spotPrices) {
      prices.set(key, null)
      return
    }

    // Missing when its page failed or ran out of gas, so it's left out rather than unpriced
    const rate = rateByKey.get(getTokenDataCacheKey(priceSource))
    if (rate) prices.set(key, getPrice(priceSource, rate))
  })

  const pageError = answeredPages.find((page) => page.error)?.error
  return {
    prices,
    error: firstFailure ? toError(firstFailure.reason, network) : pageError || null
  }
}
