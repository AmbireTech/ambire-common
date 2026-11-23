import { Contract, JsonRpcProvider, Provider } from 'ethers'
import { maxUint256 } from 'viem'

import DeFiPositionsDeploylessCode from '../../../../../contracts/compiled/DeFiAAVEPosition.json'
import { Network } from '../../../../interfaces/network'
import { withTimeout } from '../../../../utils/with-timeout'
import { fromDescriptor } from '../../../deployless/deployless'
import { AssetType, Position, PositionAsset, PositionsByProvider } from '../../types'
import { AAVE_STATIC_CALL_TIMEOUT_MS } from '../aaveV3/aaveV3'
import { RpcDefiProvider } from '../types'

/** Compared with the names in the API response case-insensitively (see `getProviderId`) */
export const AAVE_V2_PROVIDER_NAME = 'AAVE v2'

const AAVE_V2_SITE_URL = 'https://app.aave.com/'

/**
 * The lending pools of the main Aave v2 markets, by chain id. Taken from the Aave address book
 * (https://github.com/bgd-labs/aave-address-book, `src/ts/AaveV2<Network>.ts`)
 */
export const AAVE_V2_POOLS: { [chainId: string]: string } = {
  // Ethereum
  '1': '0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9',
  // Polygon
  '137': '0x8dFf5E27EA6b7AC08EbFdf9eB090F32ee9a30fcf',
  // Avalanche
  '43114': '0x4F01AeD16D97E3aB5ab2B501154DC9bb0F1A5A2C'
}

/** The reserves read per call, like for Aave v3 */
const AAVE_V2_RESERVES_PAGE_SIZE = 15

/**
 * A reserve as returned by `DeFiAAVEPosition.getAAVEPosition`. The contract reads the Aave v3
 * pools too, and it reads the pools of Aave v2 in the format of the Aave v2 forks (`Ironclad`).
 */
export type AaveV2ReserveResult = {
  addr: string
  symbol: string
  name: string
  decimals: number
  balance: bigint
  borrowAssetBalance: bigint
  stableBorrowAssetBalance: bigint
  /** Scaled by 1e27 (a ray) */
  currentLiquidityRate: bigint
  currentVariableBorrowRate: bigint
  currentStableBorrowRate: bigint
  aaveAddr: string
  aaveSymbol: string
  aaveName: string
  aaveDecimals: number
  aaveSDebtAddr: string
  aaveSDebtSymbol: string
  aaveSDebtName: string
  aaveSDebtDecimals: number
  aaveVDebtAddr: string
  aaveVDebtSymbol: string
  aaveVDebtName: string
  aaveVDebtDecimals: number
}

/** A yearly rate in percent, from a rate per year scaled by 1e27 (a ray) */
const getApy = (rayRate: bigint): number => Number(rayRate) / 10 ** 25

/**
 * The assets of a reserve: what the account supplied and borrowed (at a variable or stable rate).
 * Each links the token that represents it in the wallet (the aToken or a debt token), so its value
 * isn't counted twice. They aren't priced here, as the oracle of Aave v2 prices in ETH on some
 * networks. The token prices service prices them instead (see `updatePositionsByProviderAssetPrices`)
 */
const getReserveAssets = (reserve: AaveV2ReserveResult): PositionAsset[] => {
  const reserveToken = {
    address: reserve.addr,
    symbol: reserve.symbol,
    name: reserve.name,
    decimals: reserve.decimals,
    iconUrl: ''
  }
  const holdings = [
    {
      amount: reserve.balance,
      type: AssetType.Collateral,
      rate: reserve.currentLiquidityRate,
      protocolAsset: {
        address: reserve.aaveAddr,
        symbol: reserve.aaveSymbol,
        name: reserve.aaveName,
        decimals: reserve.aaveDecimals
      }
    },
    {
      amount: reserve.borrowAssetBalance,
      type: AssetType.Borrow,
      rate: reserve.currentVariableBorrowRate,
      protocolAsset: {
        address: reserve.aaveVDebtAddr,
        symbol: reserve.aaveVDebtSymbol,
        name: reserve.aaveVDebtName,
        decimals: reserve.aaveVDebtDecimals
      }
    },
    {
      amount: reserve.stableBorrowAssetBalance,
      type: AssetType.Borrow,
      rate: reserve.currentStableBorrowRate,
      protocolAsset: {
        address: reserve.aaveSDebtAddr,
        symbol: reserve.aaveSDebtSymbol,
        name: reserve.aaveSDebtName,
        decimals: reserve.aaveSDebtDecimals
      }
    }
  ]

  return holdings
    .filter(({ amount }) => amount > 0n)
    .map(({ amount, type, rate, protocolAsset }) => ({
      ...reserveToken,
      amount,
      type,
      additionalData: { APY: getApy(rate) },
      protocolAsset
    }))
}

/** Null when the account has no debt (the pool returns the largest number then) */
const getHealthRate = (healthFactor: bigint): number | null =>
  healthFactor === maxUint256 ? null : Number(healthFactor) / 1e18

/**
 * Builds the lending position of an account in a pool from the reserves the contract read.
 * Returns null if the account has nothing in the pool. A reserve whose token couldn't be read
 * (its symbol or name is `error`) is left out, like for Aave v3.
 */
const getAaveV2Position = (
  reserves: readonly AaveV2ReserveResult[],
  healthFactor: bigint,
  poolAddr: string
): Position | null => {
  const assets = reserves
    .filter(({ symbol, name }) => symbol !== 'error' && name !== 'error')
    .flatMap(getReserveAssets)
  if (!assets.length) return null

  const poolId = poolAddr.toLowerCase()

  return {
    id: poolId,
    assets,
    additionalData: {
      name: 'Lending',
      positionIndex: poolId,
      healthRate: getHealthRate(healthFactor)
    }
  }
}

/**
 * Reads the Aave v2 position of an account on-chain. Returns null on networks without Aave v2
 * and when the account has nothing in the pool.
 */
async function getAaveV2Positions(
  userAddr: string,
  provider: Provider | JsonRpcProvider,
  network: Network
): Promise<PositionsByProvider | null> {
  const poolAddr = AAVE_V2_POOLS[network.chainId.toString()]
  if (!poolAddr) return null

  const pool = new Contract(
    poolAddr,
    ['function getReservesList() view returns (address[])'],
    provider
  )
  // Raw ethers staticCall has no timeout; without this, a hung RPC can pin DeFi/portfolio updates.
  // Aave v2 has no `getReservesCount`
  const reserves: string[] = await withTimeout(
    () => pool.getFunction('getReservesList').staticCall(),
    {
      timeoutMs: AAVE_STATIC_CALL_TIMEOUT_MS,
      message: `Fetching AAVE v2 positions on ${network.name} took too long`
    }
  )

  // Always sent with the call to deploy it (never as a state override), as the contract deploys
  // its helper contracts in its constructor (see `getAAVEPositions`)
  const deploylessDeFiPositionsGetter = fromDescriptor(provider, DeFiPositionsDeploylessCode, false)
  const pageCount = Math.max(Math.ceil(reserves.length / AAVE_V2_RESERVES_PAGE_SIZE), 1)
  const pages = await Promise.all(
    Array.from({ length: pageCount }, (_, page) =>
      deploylessDeFiPositionsGetter.call(
        'getAAVEPosition',
        [
          userAddr,
          poolAddr,
          page * AAVE_V2_RESERVES_PAGE_SIZE,
          (page + 1) * AAVE_V2_RESERVES_PAGE_SIZE
        ],
        {}
      )
    )
  )

  const position = getAaveV2Position(
    pages.flatMap(({ userBalance }) => userBalance),
    pages[0].accountData.healthFactor,
    poolAddr
  )
  if (!position) return null

  return {
    providerName: AAVE_V2_PROVIDER_NAME,
    chainId: network.chainId,
    source: 'custom',
    iconUrl: '',
    siteUrl: AAVE_V2_SITE_URL,
    type: 'lending',
    positions: [position]
  }
}

/**
 * Debank returns the Aave v2 positions, so they are read from the chain only when auto discovery
 * is off
 */
const aaveV2DefiProvider: RpcDefiProvider = {
  name: AAVE_V2_PROVIDER_NAME,
  fetchPositions: ({ accountAddr, provider, network }) =>
    getAaveV2Positions(accountAddr, provider, network)
}

export { aaveV2DefiProvider, getAaveV2Position, getAaveV2Positions }
