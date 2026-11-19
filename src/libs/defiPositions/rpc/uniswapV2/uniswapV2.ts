import { JsonRpcProvider, Provider } from 'ethers'
import { isAddress } from 'viem'

import DeFiUniswapV2PositionsCode from '../../../../../contracts/compiled/DeFiUniswapV2Positions.json'
import { Network } from '../../../../interfaces/network'
import { paginate } from '../../../../utils/paginate'
import { fromDescriptor } from '../../../deployless/deployless'
import { AssetType, Position, PositionAsset, PositionsByProvider } from '../../types'
import { RpcDefiProvider } from '../types'
import { UNISWAP_V2_FACTORIES } from './addresses'

/** Compared with the names in the API response case-insensitively (see `getProviderId`) */
export const UNISWAP_V2_PROVIDER_NAME = 'Uniswap V2'

const UNISWAP_V2_SITE_URL = 'https://app.uniswap.org/positions'

/**
 * The tokens checked per call. Most of them aren't pairs and cost little, but an account can
 * hold hundreds of tokens, so a call stays well below the gas limit of the RPCs and, without
 * state override, the 24kb call data limit
 */
const UNISWAP_V2_CANDIDATES_PER_CALL = 100

type UniswapV2TokenInfo = {
  symbol: string
  name: string
  decimals: number
  hasDecimals: boolean
}

/** A pair position as returned by `DeFiUniswapV2Positions.getUniswapV2Positions` */
export type UniswapV2PairResult = {
  pair: string
  /** The liquidity tokens of the account */
  balance: bigint
  totalSupply: bigint
  token0: string
  token1: string
  reserve0: bigint
  reserve1: bigint
  token0Info: UniswapV2TokenInfo
  token1Info: UniswapV2TokenInfo
}

/** Unique and valid addresses only, as a malformed one would fail the whole call */
const getUniqueCandidates = (tokenAddresses: string[]): string[] =>
  Array.from(
    new Set(
      tokenAddresses
        .filter((address) => isAddress(address, { strict: false }))
        .map((address) => address.toLowerCase())
    )
  )

/**
 * Builds the position of a pair: the account's share of each of its tokens. Returns null if the
 * share is worth nothing, or a token of the pair can't be displayed (it didn't return its
 * decimals).
 */
const getUniswapV2Position = (result: UniswapV2PairResult): Position | null => {
  if (!result.totalSupply || !result.token0Info.hasDecimals || !result.token1Info.hasDecimals)
    return null

  const pairTokens = [
    [result.token0, result.token0Info, result.reserve0],
    [result.token1, result.token1Info, result.reserve1]
  ] as const
  const assets: PositionAsset[] = pairTokens.map(([address, info, reserve]) => ({
    address,
    symbol: info.symbol,
    name: info.name,
    decimals: info.decimals,
    amount: (reserve * result.balance) / result.totalSupply,
    iconUrl: '',
    type: AssetType.Liquidity
  }))
  if (assets.every(({ amount }) => amount === 0n)) return null

  const pairAddress = result.pair.toLowerCase()
  const hasPairName = !!result.token0Info.symbol && !!result.token1Info.symbol

  return {
    id: pairAddress,
    assets,
    additionalData: {
      name: 'Liquidity Pool',
      positionIndex: pairAddress,
      ...(hasPairName && {
        description: `${result.token0Info.symbol} / ${result.token1Info.symbol}`
      }),
      // The controller links the pair's liquidity token, which the account holds, to this
      // position, so its value isn't counted twice. Not a `protocolAsset`, as the liquidity token
      // would get the price of one of the pair's tokens
      pool: { id: pairAddress, controller: result.pair }
    }
  }
}

/**
 * Reads the Uniswap V2 positions of an account on-chain. A position is the liquidity token of a
 * pair, so the tokens the account holds are checked, and only those that the Uniswap V2 factory
 * deployed are read as pairs. Returns null on networks without Uniswap V2 and when the account
 * has no positions.
 */
async function getUniswapV2Positions(
  userAddr: string,
  provider: Provider | JsonRpcProvider,
  network: Network,
  tokenAddresses: string[]
): Promise<PositionsByProvider | null> {
  const factory = UNISWAP_V2_FACTORIES[network.chainId.toString()]
  if (!factory) return null

  const candidates = getUniqueCandidates(tokenAddresses)
  if (!candidates.length) return null

  const deploylessUniswapV2Positions = fromDescriptor(
    provider,
    DeFiUniswapV2PositionsCode,
    !network.rpcNoStateOverride
  )
  const pages: (readonly UniswapV2PairResult[])[] = await Promise.all(
    paginate(candidates, UNISWAP_V2_CANDIDATES_PER_CALL).map((page) =>
      // A single return value is returned as it is, not in an array
      deploylessUniswapV2Positions.call('getUniswapV2Positions', [userAddr, factory, page])
    )
  )

  const positions = pages
    .flat()
    .map(getUniswapV2Position)
    .filter((position): position is Position => !!position)
  if (!positions.length) return null

  return {
    providerName: UNISWAP_V2_PROVIDER_NAME,
    chainId: network.chainId,
    source: 'custom',
    iconUrl: '',
    siteUrl: UNISWAP_V2_SITE_URL,
    type: 'common',
    positions
  }
}

/**
 * Debank returns the Uniswap V2 positions, so they are read from the chain only when auto
 * discovery is off
 */
const uniswapV2DefiProvider: RpcDefiProvider = {
  name: UNISWAP_V2_PROVIDER_NAME,
  fetchPositions: ({ accountAddr, provider, network, heldTokenAddresses }) =>
    getUniswapV2Positions(accountAddr, provider, network, heldTokenAddresses)
}

export { getUniswapV2Position, getUniswapV2Positions, uniswapV2DefiProvider }
