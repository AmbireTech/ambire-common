import { JsonRpcProvider, Provider } from 'ethers'
import { isAddress } from 'viem'

import DeFiMorphoPositionsCode from '../../../../contracts/compiled/DeFiMorphoPositions.json'
import { Network } from '../../../interfaces/network'
import { fromDescriptor } from '../../deployless/deployless'
import { MORPHO } from '../defiAddresses'
import { paginate } from '../../../utils/paginate'
import { MORPHO_LISTED_MARKET_IDS, MORPHO_LISTED_VAULT_ADDRS } from '../morphoListed'
import { AssetType, Position, PositionAsset, PositionsByProvider } from '../types'
import {
  getMorphoApys,
  getMorphoBorrowAssets,
  getMorphoCollateralInLoanToken,
  getMorphoHealthRate,
  getMorphoMarketTotalsWithAccruedInterest,
  getMorphoSupplyAssets,
  MorphoMarketTotals
} from './helpers/morphoMath'

/** The name Debank uses, so the positions are named the same whichever source they come from */
export const MORPHO_PROVIDER_NAME = 'Morpho'

const MORPHO_SITE_URL = 'https://app.morpho.org'

/**
 * The markets checked per call on RPCs without state override, which take the contract's code
 * (~7kb) in the call data, limited to 24kb. 300 market ids take ~10kb, well below the limit
 */
const MARKETS_PER_PROXY_CALL = 300

/**
 * The vaults checked per call on RPCs without state override (see `MARKETS_PER_PROXY_CALL`).
 * 200 addresses take ~6.5kb
 */
const VAULTS_PER_PROXY_CALL = 200

type MorphoTokenInfo = {
  symbol: string
  name: string
  decimals: number
  hasDecimals: boolean
}

/** A market position, as returned by `DeFiMorphoPositions.getMorphoPositions` */
export type MorphoMarketPositionResult = {
  id: `0x${string}`
  params: {
    loanToken: string
    collateralToken: string
    oracle: string
    irm: string
    lltv: bigint
  }
  market: MorphoMarketTotals
  supplyShares: bigint
  borrowShares: bigint
  collateral: bigint
  borrowRate: bigint
  hasBorrowRate: boolean
  oraclePrice: bigint
  hasOraclePrice: boolean
  loanToken: MorphoTokenInfo
  collateralToken: MorphoTokenInfo
}

/** A vault position, as returned by `DeFiMorphoPositions.getMorphoPositions` */
export type MorphoVaultPositionResult = {
  vault: string
  shares: bigint
  assets: bigint
  hasAssets: boolean
  vaultToken: MorphoTokenInfo
  asset: string
  assetToken: MorphoTokenInfo
}

type MorphoPositionsResult = {
  blockTimestamp: bigint
  markets: readonly MorphoMarketPositionResult[]
  vaults: readonly MorphoVaultPositionResult[]
}

/** Unique and valid addresses only, as a malformed one would fail the whole call */
const getUniqueVaultCandidates = (tokenAddresses: string[]): string[] =>
  Array.from(
    new Set(
      tokenAddresses
        .filter((address) => isAddress(address, { strict: false }))
        .map((address) => address.toLowerCase())
    )
  )

/**
 * Builds the position of a lending market. Returns null if the position holds nothing, or
 * a part of it can't be displayed (a token didn't return its decimals).
 */
const getMorphoMarketPosition = (
  result: MorphoMarketPositionResult,
  blockTimestamp: bigint
): Position | null => {
  const { params, loanToken, collateralToken } = result
  const market = getMorphoMarketTotalsWithAccruedInterest(
    result.market,
    result.hasBorrowRate ? result.borrowRate : null,
    blockTimestamp
  )
  const supplyAssets = getMorphoSupplyAssets(result.supplyShares, market)
  const borrowAssets = getMorphoBorrowAssets(result.borrowShares, market)
  const hasLoanTokenAmounts = supplyAssets > 0n || borrowAssets > 0n
  // Showing only a part of a position would misstate its value (e.g. collateral without the debt)
  if (result.collateral > 0n && !collateralToken.hasDecimals) return null
  if (hasLoanTokenAmounts && !loanToken.hasDecimals) return null

  const apys = result.hasBorrowRate ? getMorphoApys(result.borrowRate, market) : null
  const assets: PositionAsset[] = []

  if (result.collateral > 0n) {
    // Collateral is often a token without a price of its own (e.g. a Pendle PT). Without one,
    // the debt alone would make the position's value negative
    const canValueInLoanToken = result.hasOraclePrice && loanToken.hasDecimals

    assets.push({
      address: params.collateralToken,
      symbol: collateralToken.symbol,
      name: collateralToken.name,
      decimals: collateralToken.decimals,
      amount: result.collateral,
      iconUrl: '',
      type: AssetType.Collateral,
      ...(canValueInLoanToken && {
        priceFallback: {
          address: params.loanToken,
          decimals: loanToken.decimals,
          amount: getMorphoCollateralInLoanToken(result.collateral, result.oraclePrice)
        }
      })
    })
  }

  if (supplyAssets > 0n) {
    assets.push({
      address: params.loanToken,
      symbol: loanToken.symbol,
      name: loanToken.name,
      decimals: loanToken.decimals,
      amount: supplyAssets,
      iconUrl: '',
      type: AssetType.Collateral,
      ...(apys && { additionalData: { APY: apys.supplyApy } })
    })
  }

  if (borrowAssets > 0n) {
    assets.push({
      address: params.loanToken,
      symbol: loanToken.symbol,
      name: loanToken.name,
      decimals: loanToken.decimals,
      amount: borrowAssets,
      iconUrl: '',
      type: AssetType.Borrow,
      ...(apys && { additionalData: { APY: apys.borrowApy } })
    })
  }

  if (!assets.length) return null

  const healthRate = result.hasOraclePrice
    ? getMorphoHealthRate({
        collateral: result.collateral,
        borrowAssets,
        oraclePrice: result.oraclePrice,
        lltv: params.lltv
      })
    : null
  const hasMarketName = !!collateralToken.symbol && !!loanToken.symbol

  return {
    id: result.id.toLowerCase(),
    assets,
    additionalData: {
      name: 'Lending',
      positionIndex: result.id.toLowerCase(),
      ...(hasMarketName && { description: `${collateralToken.symbol} / ${loanToken.symbol}` }),
      healthRate
    }
  }
}

/**
 * Builds the position of a vault. Returns null if the account's shares are worth nothing
 * (dust left after a withdrawal) or their value is unknown.
 */
const getMorphoVaultPosition = (result: MorphoVaultPositionResult): Position | null => {
  const { assetToken, vaultToken } = result
  if (!result.hasAssets || result.assets === 0n || !assetToken.hasDecimals) return null

  const vaultAddress = result.vault.toLowerCase()

  return {
    id: vaultAddress,
    assets: [
      {
        address: result.asset,
        symbol: assetToken.symbol,
        name: assetToken.name,
        decimals: assetToken.decimals,
        amount: result.assets,
        iconUrl: '',
        type: AssetType.Collateral
      }
    ],
    additionalData: {
      name: 'Vault',
      positionIndex: vaultAddress,
      ...(vaultToken.name && { description: vaultToken.name }),
      // Like in Debank's Morpho positions. The controller links the vault's share token,
      // which the account holds, to this position, so its value isn't counted twice.
      // Not a `protocolAsset`, as the share token would get the price of the underlying asset
      pool: { id: vaultAddress, controller: result.vault }
    }
  }
}

type MorphoPositionsCallArgs = { marketIds: string[]; vaultCandidates: string[] }

/**
 * Splits the markets and vaults to check into calls. A single call when the RPC supports state
 * override, as the call data isn't limited then.
 */
const getMorphoPositionsCallArgs = (
  network: Network,
  { marketIds, vaultCandidates }: MorphoPositionsCallArgs
): MorphoPositionsCallArgs[] => {
  if (!network.rpcNoStateOverride) return [{ marketIds, vaultCandidates }]

  return [
    ...paginate(marketIds, MARKETS_PER_PROXY_CALL).map((page) => ({
      marketIds: page,
      vaultCandidates: []
    })),
    ...paginate(vaultCandidates, VAULTS_PER_PROXY_CALL).map((page) => ({
      marketIds: [],
      vaultCandidates: page
    }))
  ]
}

/**
 * Reads the Morpho positions of an account on-chain:
 * - Lending markets: those Morpho lists in its app (`MORPHO_LISTED_MARKET_IDS`), as Morpho
 * can't list the markets an account is in
 * - Vaults: those Morpho lists in its app (`MORPHO_LISTED_VAULT_ADDRS`) and `tokenAddresses`
 * (the tokens the account holds), as a vault's shares are a token. Only the addresses that
 * Morpho's factories deployed are read as vaults
 *
 * Returns null on networks without Morpho. Returns a provider without positions when the
 * account has none, so that it replaces outdated Morpho positions from Debank (kept from before
 * auto discovery was turned off), as the chain shows they are closed.
 */
async function getMorphoPositions(
  userAddr: string,
  provider: Provider | JsonRpcProvider,
  network: Network,
  tokenAddresses: string[]
): Promise<PositionsByProvider | null> {
  const chainId = network.chainId.toString()
  const morpho = MORPHO[chainId]
  if (!morpho) return null

  const deploylessMorphoPositions = fromDescriptor(
    provider,
    DeFiMorphoPositionsCode,
    !network.rpcNoStateOverride
  )
  const callArgs = getMorphoPositionsCallArgs(network, {
    marketIds: MORPHO_LISTED_MARKET_IDS[chainId] || [],
    vaultCandidates: getUniqueVaultCandidates([
      ...(MORPHO_LISTED_VAULT_ADDRS[chainId] || []),
      ...tokenAddresses
    ])
  })
  const results: MorphoPositionsResult[] = await Promise.all(
    callArgs.map(({ marketIds, vaultCandidates }) =>
      deploylessMorphoPositions.call('getMorphoPositions', [
        userAddr,
        morpho.morphoAddr,
        marketIds,
        morpho.metaMorphoFactoryAddrs,
        morpho.vaultV2FactoryAddrs,
        vaultCandidates
      ])
    )
  )

  const marketPositions = results
    .flatMap((result) =>
      result.markets.map((market) => getMorphoMarketPosition(market, result.blockTimestamp))
    )
    .filter((position): position is Position => !!position)
  const vaultPositions = results
    .flatMap((result) => result.vaults.map(getMorphoVaultPosition))
    .filter((position): position is Position => !!position)
  const positions = [...marketPositions, ...vaultPositions]

  return {
    providerName: MORPHO_PROVIDER_NAME,
    chainId: network.chainId,
    source: 'custom',
    iconUrl: '',
    siteUrl: MORPHO_SITE_URL,
    type: marketPositions.length ? 'lending' : 'common',
    positions
  }
}

export {
  getMorphoMarketPosition,
  getMorphoPositions,
  getMorphoPositionsCallArgs,
  getMorphoVaultPosition
}
