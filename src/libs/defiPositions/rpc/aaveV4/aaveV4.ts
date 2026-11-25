import { JsonRpcProvider, Provider } from 'ethers'
import { maxUint256 } from 'viem'

import DeFiAaveV4PositionsCode from '../../../../../contracts/compiled/DeFiAaveV4Positions.json'
import { Price } from '../../../../interfaces/assets'
import { Network } from '../../../../interfaces/network'
import { fromDescriptor } from '../../../deployless/deployless'
import { getAssetValue } from '../../helpers'
import { AssetType, Position, PositionAsset, PositionsByProvider } from '../../types'
import { RpcDefiProvider } from '../types'
import { AAVE_V4_SPOKES, AaveV4Spoke } from './addresses'

/** Compared with the names in the API response case-insensitively (see `getProviderId`) */
export const AAVE_V4_PROVIDER_NAME = 'AAVE v4'

const AAVE_V4_SITE_URL = 'https://app.aave.com/'

/** A reserve the account supplied to or borrowed from, as returned by `DeFiAaveV4Positions` */
export type AaveV4ReserveResult = {
  reserveId: bigint
  underlying: string
  decimals: number
  symbol: string
  name: string
  suppliedAssets: bigint
  /** The debt drawn and the premium on it */
  debt: bigint
  isUsingAsCollateral: boolean
  /** The USD price of 1 token, with `AaveV4SpokeResult.priceDecimals` decimals */
  price: bigint
  hasPrice: boolean
}

/** A spoke the account has a position in, as returned by `DeFiAaveV4Positions` */
export type AaveV4SpokeResult = {
  spoke: string
  reserves: readonly AaveV4ReserveResult[]
  /** Scaled by 1e18. The largest uint256 when the account has no debt */
  accountData: { healthFactor: bigint }
  hasAccountData: boolean
  priceDecimals: number
  hasPriceDecimals: boolean
}

const getUsdPriceIn = (
  reserve: AaveV4ReserveResult,
  { hasPriceDecimals, priceDecimals }: AaveV4SpokeResult
): Price | undefined => {
  if (!reserve.hasPrice || !hasPriceDecimals) return undefined

  return { baseCurrency: 'usd', price: Number(reserve.price) / 10 ** priceDecimals }
}

const getReserveAsset = (
  reserve: AaveV4ReserveResult,
  type: AssetType,
  amount: bigint,
  priceIn: Price | undefined
): PositionAsset => ({
  address: reserve.underlying,
  symbol: reserve.symbol,
  name: reserve.name,
  decimals: reserve.decimals,
  amount,
  iconUrl: '',
  type,
  // Priced by the spoke's oracle. The token prices service isn't asked for Aave prices (see
  // `updatePositionsByProviderAssetPrices`)
  ...(priceIn && { priceIn, value: getAssetValue(amount, reserve.decimals, [priceIn]) })
})

/**
 * The value an asset adds to its position. A borrowed asset is a debt, so it's subtracted, and
 * an asset without a price adds nothing.
 */
const getValueInPosition = ({ type, value = 0 }: PositionAsset): number =>
  type === AssetType.Borrow ? -value : value

/** Null when the account has no debt in the spoke, or the spoke couldn't calculate it */
const getHealthRate = ({ hasAccountData, accountData }: AaveV4SpokeResult): number | null => {
  if (!hasAccountData || accountData.healthFactor === maxUint256) return null

  return Number(accountData.healthFactor) / 1e18
}

/**
 * Builds the position of a spoke: what the account supplied (as collateral or not) and
 * borrowed. Returns null if it holds nothing (e.g. dust left after a withdrawal).
 */
const getAaveV4SpokePosition = (
  spokeResult: AaveV4SpokeResult,
  spoke: AaveV4Spoke
): Position | null => {
  const assets = spokeResult.reserves.flatMap((reserve) => {
    const priceIn = getUsdPriceIn(reserve, spokeResult)
    const reserveAssets: PositionAsset[] = []

    if (reserve.suppliedAssets > 0n) {
      reserveAssets.push(
        getReserveAsset(reserve, AssetType.Collateral, reserve.suppliedAssets, priceIn)
      )
    }
    if (reserve.debt > 0n) {
      reserveAssets.push(getReserveAsset(reserve, AssetType.Borrow, reserve.debt, priceIn))
    }

    return reserveAssets
  })
  if (!assets.length) return null

  const spokeAddress = spokeResult.spoke.toLowerCase()

  return {
    id: spokeAddress,
    assets,
    additionalData: {
      name: 'Lending',
      positionIndex: spokeAddress,
      description: `${spoke.name} market`,
      healthRate: getHealthRate(spokeResult),
      positionInUSD: assets.reduce((sum, asset) => sum + getValueInPosition(asset), 0)
    }
  }
}

/**
 * Reads the Aave v4 positions of an account on-chain, one per spoke (see `AAVE_V4_SPOKES`).
 * Returns null on networks without Aave v4 and when the account has no positions.
 */
async function getAaveV4Positions(
  userAddr: string,
  provider: Provider | JsonRpcProvider,
  network: Network
): Promise<PositionsByProvider | null> {
  const spokes = AAVE_V4_SPOKES[network.chainId.toString()]
  if (!spokes?.length) return null

  const deploylessAaveV4Positions = fromDescriptor(
    provider,
    DeFiAaveV4PositionsCode,
    !network.rpcNoStateOverride
  )
  // A single return value is returned as it is, not in an array
  const spokeResults: readonly AaveV4SpokeResult[] = await deploylessAaveV4Positions.call(
    'getAaveV4Positions',
    [userAddr, spokes.map(({ address }) => address)]
  )
  const spokesByAddress = new Map(spokes.map((spoke) => [spoke.address.toLowerCase(), spoke]))

  const positions = spokeResults
    .map((spokeResult) => {
      const spoke = spokesByAddress.get(spokeResult.spoke.toLowerCase())

      return spoke ? getAaveV4SpokePosition(spokeResult, spoke) : null
    })
    .filter((position): position is Position => !!position)
  if (!positions.length) return null

  return {
    providerName: AAVE_V4_PROVIDER_NAME,
    chainId: network.chainId,
    source: 'custom',
    iconUrl: '',
    siteUrl: AAVE_V4_SITE_URL,
    type: 'lending',
    positions,
    positionInUSD: positions.reduce(
      (sum, position) => sum + (position.additionalData.positionInUSD || 0),
      0
    )
  }
}

/**
 * Debank returns the Aave v4 positions, so they are read from the chain only when auto
 * discovery is off
 */
const aaveV4DefiProvider: RpcDefiProvider = {
  name: AAVE_V4_PROVIDER_NAME,
  fetchPositions: ({ accountAddr, provider, network }) =>
    getAaveV4Positions(accountAddr, provider, network)
}

export { aaveV4DefiProvider, getAaveV4Positions, getAaveV4SpokePosition }
