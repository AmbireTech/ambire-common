import { JsonRpcProvider, Provider, ZeroAddress } from 'ethers'

import DeFiUniswapV4PositionsCode from '../../../../../contracts/compiled/DeFiUniswapV4Positions.json'
import { Network } from '../../../../interfaces/network'
import { paginate } from '../../../../utils/paginate'
import { fromDescriptor } from '../../../deployless/deployless'
import { AssetType, Position, PositionAsset, PositionsByProvider } from '../../types'
import { RpcDefiProvider } from '../types'
import { uniV3DataToPortfolioPosition } from '../uniswapV3/math'
import { UNISWAP_V4 } from './addresses'

/** Compared with the names in the API response case-insensitively (see `getProviderId`) */
export const UNISWAP_V4_PROVIDER_NAME = 'Uniswap V4'

const UNISWAP_V4_SITE_URL = 'https://app.uniswap.org/positions'

/**
 * The positions read per call. A closed position keeps its NFT, so an account can hold hundreds.
 * Reading one takes up to ~150k gas (its owner, pool, price and tokens), so a call stays well
 * below the gas limit of the RPCs and, without state override, the 24kb call data limit
 */
const UNISWAP_V4_POSITIONS_PER_CALL = 50

type UniswapV4TokenInfo = {
  symbol: string
  name: string
  decimals: number
  hasDecimals: boolean
}

/** A position as returned by `DeFiUniswapV4Positions.getUniswapV4Positions` */
export type UniswapV4PositionResult = {
  tokenId: bigint
  /** A currency of the zero address is the native token of the network */
  poolKey: { currency0: string; currency1: string }
  poolId: string
  tickLower: number
  tickUpper: number
  liquidity: bigint
  sqrtPriceX96: bigint
  /** Empty for the native token */
  token0: UniswapV4TokenInfo
  token1: UniswapV4TokenInfo
}

/** The symbol, name and decimals of a currency of a pool, which may be the native token */
const getCurrencyInfo = (
  address: string,
  tokenInfo: UniswapV4TokenInfo,
  network: Network
): UniswapV4TokenInfo => {
  if (address !== ZeroAddress) return tokenInfo

  return {
    symbol: network.nativeAssetSymbol,
    name: network.nativeAssetName,
    decimals: 18,
    hasDecimals: true
  }
}

/**
 * Builds a liquidity position from its two tokens, valued like the Uniswap V3 ones read from
 * the chain (see `uniV3DataToPortfolioPosition`). Returns null if a token of it can't be
 * displayed (it didn't return its decimals).
 */
const getUniswapV4Position = (
  result: UniswapV4PositionResult,
  network: Network
): Position | null => {
  const currencies = [
    [result.poolKey.currency0, getCurrencyInfo(result.poolKey.currency0, result.token0, network)],
    [result.poolKey.currency1, getCurrencyInfo(result.poolKey.currency1, result.token1, network)]
  ] as const
  if (currencies.some(([, info]) => !info.hasDecimals)) return null

  const { amount0, amount1, isInRage } = uniV3DataToPortfolioPosition(
    result.liquidity,
    result.sqrtPriceX96,
    BigInt(result.tickLower),
    BigInt(result.tickUpper)
  )
  const assets: PositionAsset[] = currencies.map(([address, info], index) => ({
    address,
    symbol: info.symbol,
    name: info.name,
    decimals: info.decimals,
    amount: BigInt(index === 0 ? amount0 : amount1),
    iconUrl: '',
    type: AssetType.Liquidity
  }))
  const tokenId = result.tokenId.toString()

  return {
    id: tokenId,
    assets,
    additionalData: {
      inRange: isInRage,
      positionIndex: tokenId,
      liquidity: result.liquidity,
      name: 'Liquidity Pool',
      pool: { id: result.poolId }
    }
  }
}

/**
 * Reads the Uniswap v4 positions of an account on-chain. The positions are NFTs that can't be
 * listed by their owner, so only the ones in `heldCollectibles` (those the wallet learned the
 * account holds) are read. Returns null on networks without Uniswap v4 and when the account
 * has no positions.
 */
async function getUniswapV4Positions(
  userAddr: string,
  provider: Provider | JsonRpcProvider,
  network: Network,
  heldCollectibles: { [collectionAddress: string]: bigint[] }
): Promise<PositionsByProvider | null> {
  const uniswapV4 = UNISWAP_V4[network.chainId.toString()]
  if (!uniswapV4) return null

  const tokenIds = [...new Set(heldCollectibles[uniswapV4.positionManagerAddr.toLowerCase()])]
  if (!tokenIds.length) return null

  const deploylessUniswapV4Positions = fromDescriptor(
    provider,
    DeFiUniswapV4PositionsCode,
    !network.rpcNoStateOverride
  )
  const pages: (readonly UniswapV4PositionResult[])[] = await Promise.all(
    paginate(tokenIds, UNISWAP_V4_POSITIONS_PER_CALL).map((page) =>
      // A single return value is returned as it is, not in an array
      deploylessUniswapV4Positions.call('getUniswapV4Positions', [
        userAddr,
        uniswapV4.positionManagerAddr,
        uniswapV4.stateViewAddr,
        page
      ])
    )
  )

  const positions = pages
    .flat()
    .map((result) => getUniswapV4Position(result, network))
    .filter((position): position is Position => !!position)
  if (!positions.length) return null

  return {
    providerName: UNISWAP_V4_PROVIDER_NAME,
    chainId: network.chainId,
    source: 'custom',
    iconUrl: '',
    siteUrl: UNISWAP_V4_SITE_URL,
    type: 'common',
    positions
  }
}

/**
 * Debank returns the Uniswap v4 positions, so they are read from the chain only when auto
 * discovery is off
 */
const uniswapV4DefiProvider: RpcDefiProvider = {
  name: UNISWAP_V4_PROVIDER_NAME,
  fetchPositions: ({ accountAddr, provider, network, heldCollectibles }) =>
    getUniswapV4Positions(accountAddr, provider, network, heldCollectibles)
}

export { getUniswapV4Position, getUniswapV4Positions, uniswapV4DefiProvider }
