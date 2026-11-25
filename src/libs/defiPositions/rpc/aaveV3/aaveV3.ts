import { Contract, JsonRpcProvider, Provider } from 'ethers'

import DeFiPositionsDeploylessCode from '../../../../../contracts/compiled/DeFiAAVEPosition.json'
import { Network } from '../../../../interfaces/network'
import { generateUuid } from '../../../../utils/uuid'
import { withTimeout } from '../../../../utils/with-timeout'
import { fromDescriptor } from '../../../deployless/deployless'
import { getAssetValue } from '../../helpers'
import { AssetType, Position, PositionAsset, PositionsByProvider } from '../../types'
import { RpcDefiProvider } from '../types'
import { AAVE_V3 } from './addresses'

export const AAVE_V3_PROVIDER_NAME = 'AAVE v3'

const AAVE_NO_HEALTH_FACTOR_MAGIC_NUMBER =
  115792089237316195423570985008687907853269984665640564039457584007913129639935n

export const AAVE_STATIC_CALL_TIMEOUT_MS = 15 * 1000

/** The reserves read per call */
const AAVE_RESERVES_PAGE_SIZE = 15

/**
 * How long the number of reserves of a pool is cached. The reads find the reserves listed after
 * it was cached anyway (see `getAAVEReservesPageCount`), so this only limits how long a wrong
 * number returned by the RPC is kept.
 */
export const AAVE_RESERVES_COUNT_MAX_AGE_MS = 24 * 60 * 60 * 1000

/**
 * The number of reserves of each pool, by RPC provider. It's the same for every account, and a
 * pool lists new reserves rarely, so it isn't requested on every read. Kept per provider, so a
 * new one (e.g. after the user changes the RPC of the network) requests it again, and the cache
 * is dropped together with the provider.
 */
const reservesCountCache = new WeakMap<
  Provider | JsonRpcProvider,
  Map<string, { reservesCount: number; cachedAt: number }>
>()

const getCachedReservesCount = (
  provider: Provider | JsonRpcProvider,
  poolAddr: string
): number | undefined => {
  const cached = reservesCountCache.get(provider)?.get(poolAddr)
  if (!cached || Date.now() - cached.cachedAt >= AAVE_RESERVES_COUNT_MAX_AGE_MS) return undefined

  return cached.reservesCount
}

const fetchAndCacheReservesCount = async (
  provider: Provider | JsonRpcProvider,
  network: Network,
  poolAddr: string
): Promise<number> => {
  const poolContract = new Contract(
    poolAddr,
    ['function getReservesCount() view returns (uint256)'],
    provider
  )
  // Raw ethers staticCall has no timeout; without this, a hung RPC can pin DeFi/portfolio updates.
  const reservesCount = Number(
    await withTimeout(() => poolContract.getFunction('getReservesCount').staticCall(), {
      timeoutMs: AAVE_STATIC_CALL_TIMEOUT_MS,
      message: `Fetching AAVE positions on ${network.name} took too long`
    })
  )
  const providerCache = reservesCountCache.get(provider) || new Map()

  providerCache.set(poolAddr, { reservesCount, cachedAt: Date.now() })
  reservesCountCache.set(provider, providerCache)

  return reservesCount
}

/**
 * The number of calls (pages) that read every reserve. They always read at least one reserve
 * past `reservesCount` (the contract skips those that don't exist), so a full last page means
 * the pool listed new reserves since the count was cached.
 */
const getAAVEReservesPageCount = (reservesCount: number) =>
  Math.floor(reservesCount / AAVE_RESERVES_PAGE_SIZE) + 1

export async function getAAVEPositions(
  userAddr: string,
  provider: Provider | JsonRpcProvider,
  network: Network
): Promise<PositionsByProvider | null> {
  const { chainId } = network
  if (chainId && !AAVE_V3[chainId.toString() as keyof typeof AAVE_V3]) return null

  const { poolAddr } = AAVE_V3[chainId.toString() as keyof typeof AAVE_V3]

  // Always sent with the call to deploy it (never as a state override, even if the RPC supports
  // it), as the contract deploys its helper contracts in its constructor, which doesn't run when
  // its code is set at an address with a state override
  const deploylessDeFiPositionsGetter = fromDescriptor(provider, DeFiPositionsDeploylessCode, false)
  const readPages = (fromPage: number, toPage: number) =>
    Promise.all(
      // None if the RPC returns fewer reserves than before (e.g. it's behind)
      Array.from({ length: Math.max(toPage - fromPage, 0) }, (_, index) => {
        const from = (fromPage + index) * AAVE_RESERVES_PAGE_SIZE

        return deploylessDeFiPositionsGetter.call(
          'getAAVEPosition',
          [userAddr, poolAddr, from, from + AAVE_RESERVES_PAGE_SIZE],
          {}
        )
      })
    )

  const reservesCount =
    getCachedReservesCount(provider, poolAddr) ??
    (await fetchAndCacheReservesCount(provider, network, poolAddr))
  const results = await readPages(0, getAAVEReservesPageCount(reservesCount))
  const hasNewReserves = results.at(-1)?.userBalance.length === AAVE_RESERVES_PAGE_SIZE

  if (hasNewReserves) {
    const newReservesCount = await fetchAndCacheReservesCount(provider, network, poolAddr)

    results.push(...(await readPages(results.length, getAAVEReservesPageCount(newReservesCount))))
  }

  const accountData = results[0].accountData

  const userAssets = results
    .map((r) => r.userBalance)
    .flat()
    .map(({ addr, ...rest }) => ({
      address: addr,
      aaveAddress: rest.aaveAddr,
      ...rest
    }))
    .filter(
      (t: any) =>
        t.symbol !== 'error' &&
        t.name !== 'error' &&
        (t.balance > 0 || t.borrowAssetBalance > 0 || t.stableBorrowAssetBalance > 0)
    )

  if (accountData.healthFactor === AAVE_NO_HEALTH_FACTOR_MAGIC_NUMBER) {
    accountData.healthFactor = null
  }

  const position: Position = {
    id: generateUuid(),
    additionalData: {
      healthRate: accountData.healthFactor ? Number(accountData.healthFactor) / 1e18 : null,
      positionInUSD: 0,
      deptInUSD: 0,
      collateralInUSD: 0,
      availableBorrowInUSD: Number(accountData.availableBorrowsBase) / 1e8,
      name: 'Lending'
    },
    assets: []
  }

  position.assets = userAssets
    .map((asset: any) => {
      const balance = Number(asset.balance) / 10 ** Number(asset.decimals)
      const price = Number(asset.price) / 1e8
      const borrow = (Number(asset.borrowAssetBalance) / 10 ** Number(asset.decimals)) * -1
      const stableBorrow =
        (Number(asset.stableBorrowAssetBalance) / 10 ** Number(asset.decimals)) * -1

      position.additionalData.positionInUSD =
        (position.additionalData.positionInUSD || 0) + (balance + borrow + stableBorrow) * price
      position.additionalData.debtInUSD =
        (position.additionalData.debtInUSD || 0) + (borrow + stableBorrow) * price
      position.additionalData.collateralInUSD =
        (position.additionalData.collateralInUSD || 0) + balance * price

      const assetsResult = []

      const priceIn = { baseCurrency: 'usd', price }

      if (asset.balance > 0) {
        assetsResult.push({
          address: asset.address,
          symbol: asset.symbol,
          name: asset.name,
          iconUrl: '',
          decimals: Number(asset.decimals),
          amount: asset.balance,
          priceIn,
          value: getAssetValue(asset.balance, Number(asset.decimals), [priceIn]),
          type: AssetType.Collateral,
          additionalData: {
            APY: Number(asset.currentLiquidityRate) / 10 ** 25
          },
          protocolAsset: {
            address: asset.aaveAddress,
            symbol: asset.aaveSymbol,
            name: asset.aaveName,
            decimals: asset.aaveDecimals
          }
        } as PositionAsset)
      }

      if (asset.stableBorrowAssetBalanc > 0) {
        assetsResult.push({
          address: asset.address,
          symbol: asset.symbol,
          name: asset.name,
          iconUrl: '',
          decimals: Number(asset.decimals),
          amount: asset.stableBorrowAssetBalanc,
          priceIn,
          value: getAssetValue(asset.stableBorrowAssetBalanc, Number(asset.decimals), [priceIn]),
          type: AssetType.Borrow,
          additionalData: {
            APY: Number(asset.currentStableBorrowRate) / 10 ** 25
          },
          protocolAsset: {
            address: asset.aaveSDebtAddr,
            symbol: asset.aaveSDebtSymbol,
            name: asset.aaveSDebtName,
            decimals: asset.aaveSDebtDecimals
          }
        } as PositionAsset)
      }

      if (asset.borrowAssetBalance > 0) {
        assetsResult.push({
          address: asset.address,
          symbol: asset.symbol,
          name: asset.name,
          iconUrl: '',
          decimals: Number(asset.decimals),
          amount: asset.borrowAssetBalance,
          priceIn,
          value: getAssetValue(asset.borrowAssetBalance, Number(asset.decimals), [priceIn]),
          type: AssetType.Borrow,
          additionalData: {
            APY: Number(asset.currentVariableBorrowRate) / 10 ** 25
          },
          protocolAsset: {
            address: asset.aaveVDebtAddr,
            symbol: asset.aaveVDebtSymbol,
            name: asset.name,
            decimals: asset.aaveVDebtDecimals
          }
        } as PositionAsset)
      }

      return assetsResult
    })
    .flat()

  if (position.additionalData.positionInUSD === 0 || !position.assets.length) return null

  return {
    providerName: AAVE_V3_PROVIDER_NAME,
    chainId,
    source: 'custom',
    type: 'lending',
    positions: [position],
    iconUrl: '',
    siteUrl: 'https://app.aave.com/',
    positionInUSD: position.additionalData.positionInUSD
  }
}

/**
 * The AAVE positions read from the chain replace the ones returned by the API, as only they
 * point to the right aToken of each asset, which keeps the aTokens in the wallet from being
 * counted twice in the total.
 */
export const aaveV3DefiProvider: RpcDefiProvider = {
  name: AAVE_V3_PROVIDER_NAME,
  fetchPositions: ({ accountAddr, provider, network }) =>
    getAAVEPositions(accountAddr, provider, network)
}
