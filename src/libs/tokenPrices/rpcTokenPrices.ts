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
 * A token whose most liquid pool holds less than this much of the native token, in USD, has no
 * price, unless it's one of our curated tokens (see `isCuratedToken`). A pool that small is cheap
 * to set up with any price, which is how scam tokens show a convincing value: e.g. a drained pool
 * left with $0.02 of ETH on each side of a made-up ratio.
 *
 * The depth is exact only for pools paired directly with the native token. For a token that trades
 * mostly against a stablecoin (e.g. USDe), it comes out far too low, which is why the curated
 * tokens skip this check.
 */
export const MIN_POOL_DEPTH_USD = 1000
/** The native token of every network with a config has 18 decimals */
const NATIVE_DECIMALS = 18

/** The USD price of each token, keyed like the price cache (`getTokenDataCacheKey`). Null when it has no price. */
export type RpcTokenPrices = Map<string, number | null>

export type RpcTokenPricesResult = {
  /**
   * The tokens that were answered, with a price or with "no price". Tokens in a call that failed,
   * or that need more gas than the RPC gives a call, are left out, so that they aren't taken as
   * having no price.
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
  /** How much of the native token (in wei) the token's most liquid pool holds */
  poolDepth: bigint
  /** Whether the token is the native token or wraps it, which leaves `poolDepth` unknown */
  isNative: boolean
}

type GetPricesResult = {
  nativeUsdPrice: NativeUsdPrice
  /** Each checked token's rate, in the order the tokens were passed */
  rates: TokenRate[]
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

/** Whether token prices can be read from the network's RPC */
export const canGetRpcTokenPrices = (network: Network): boolean =>
  !!getRpcTokenPriceConfig(network.chainId)

/**
 * Whether the token is on one of the short lists of liquid tokens we keep for the chain: the Gas
 * Tank fee tokens, and the assets the Privacy Pools accept
 */
const isCuratedToken = (address: string, chainId: bigint): boolean =>
  !!getFeeToken(address, chainId) ||
  !!getPrivacyPoolsChainConfig(chainId)?.assets.some((asset) => isSameAddr(asset.address, address))

/** The native token and its wrapped version, both priced by the native token's feed */
const isNativeOrWrappedNative = (address: string, network: Network): boolean =>
  isSameAddr(address, ZeroAddress) ||
  (!!network.wrappedAddr && isSameAddr(address, network.wrappedAddr))

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
 * a call is skipped, so that it doesn't hold up the rest. Throws if nothing could be read; when a
 * later call fails, what the earlier ones read is kept and the error is returned along with it.
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
    remainingTokens
      .slice(0, checkedCount)
      .forEach((address, index) => rateByAddress.set(address, result.rates[index]!))

    if (remainingTokens.length && !checkedCount) {
      // Left out rather than reported as having no price, and the rest are still read
      error = new Error(`Not enough gas to read some token prices on ${network.name}`)
      remainingTokens = remainingTokens.slice(1)
    } else {
      remainingTokens = remainingTokens.slice(checkedCount)
    }
  } while (remainingTokens.length)

  return { nativeUsdPrice, rateByAddress, error }
}

/**
 * Reads the USD prices of the tokens from the network's RPC alone, without our price API: the
 * native token's price from its Chainlink feed, and every other token's price in the native
 * token from 1inch's spot price aggregator, which averages the token's DEX pools by liquidity.
 * A token that trades in no pool, or whose most liquid pool holds less than MIN_POOL_DEPTH_USD of
 * the native token (unless it's one of our curated tokens), has no price. Pools far smaller than the
 * token's most liquid one are left out of its price. A token the config prices as another token
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

  const priceGetter = fromDescriptor(provider, PriceGetter, !network.rpcNoStateOverride)
  // The call has its own timeout (see `Deployless.call`)
  const call = async (tokens: string[]): Promise<[GetPricesResult, number]> => {
    const [nativePrice, rates, checkedCount]: PriceGetterResult = await priceGetter.call(
      'getPrices',
      [
        config.nativeUsdFeed,
        config.spotPriceOracle || ZeroAddress,
        tokens,
        LIQUIDITY_THRESHOLD_PERCENT
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

  const tokensToRate = config.spotPriceOracle
    ? [...new Set(tokenAddresses.map(getPriceSource))].filter(
        (address) => !isNativeOrWrappedNative(address, network)
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
  const hasEnoughLiquidity = (address: string, { poolDepth, isNative }: TokenRate) =>
    isNative ||
    isCuratedToken(address, network.chainId) ||
    Number(formatUnits(poolDepth, NATIVE_DECIMALS)) * nativePrice >= MIN_POOL_DEPTH_USD

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

    if (isNativeOrWrappedNative(priceSource, network)) {
      prices.set(key, nativePrice)
      return
    }
    // Without the aggregator only the native token is priced: the rest have no price
    if (!config.spotPriceOracle) {
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
