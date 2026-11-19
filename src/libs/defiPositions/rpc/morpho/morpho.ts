import { JsonRpcProvider, Provider } from 'ethers'
import { isAddress } from 'viem'

import DeFiMorphoPositionsCode from '../../../../../contracts/compiled/DeFiMorphoPositions.json'
import { Network } from '../../../../interfaces/network'
import { paginate } from '../../../../utils/paginate'
import { fromDescriptor } from '../../../deployless/deployless'
import { AssetType, Position, PositionAsset, PositionsByProvider } from '../../types'
import { RpcDefiProvider } from '../types'
import { MORPHO } from './addresses'
import MORPHO_LISTED_JSON from './listed.json'
import {
  getMorphoApys,
  getMorphoBorrowAssets,
  getMorphoCollateralInLoanToken,
  getMorphoHealthRate,
  getMorphoMarketTotalsWithAccruedInterest,
  getMorphoSupplyAssets,
  MorphoMarketTotals
} from './math'

/** The name Debank uses, so the positions are named the same whichever source they come from */
export const MORPHO_PROVIDER_NAME = 'Morpho'

const MORPHO_SITE_URL = 'https://app.morpho.org'

/**
 * The markets and vaults Morpho lists in its app, by chain id. Regenerated from Morpho's API
 * with `npm run defiPositions:update:morphoListed` before each release, as Morpho lists new
 * markets every day. Markets and vaults it lists after that are not checked.
 */
type MorphoListed = {
  updatedAt: string
  /** Sorted by their supply. Markets that Morpho doesn't list (anyone can create one) are not checked */
  markets: { [chainId: string]: { id: string; name: string }[] }
  vaults: { [chainId: string]: { address: string; name: string }[] }
}

const MORPHO_LISTED: MorphoListed = MORPHO_LISTED_JSON

const getListedMarketIds = (chainId: string): string[] =>
  (MORPHO_LISTED.markets[chainId] || []).map(({ id }) => id)

const getListedVaultAddrs = (chainId: string): string[] =>
  (MORPHO_LISTED.vaults[chainId] || []).map(({ address }) => address)

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
    // the collateral would be left out of the position's value
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
 * - Lending markets: those Morpho lists in its app (see `MORPHO_LISTED`), as Morpho Blue
 * can't list the markets an account is in
 * - Vaults: those Morpho lists in its app (see `MORPHO_LISTED`) and `tokenAddresses`
 * (the tokens the account holds), as a vault's shares are a token. Only the addresses that
 * Morpho's factories deployed are read as vaults
 *
 * Returns null on networks without Morpho and when the account has no positions.
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
    marketIds: getListedMarketIds(chainId),
    vaultCandidates: getUniqueVaultCandidates([...getListedVaultAddrs(chainId), ...tokenAddresses])
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
  if (!positions.length) return null

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

/**
 * Debank returns the Morpho positions fully, so they are read from the chain only when auto
 * discovery is off
 */
const morphoDefiProvider: RpcDefiProvider = {
  name: MORPHO_PROVIDER_NAME,
  fetchPositions: ({ accountAddr, provider, network, heldTokenAddresses }) =>
    getMorphoPositions(accountAddr, provider, network, heldTokenAddresses)
}

export {
  getListedMarketIds,
  getListedVaultAddrs,
  getMorphoMarketPosition,
  getMorphoPositions,
  getMorphoPositionsCallArgs,
  getMorphoVaultPosition,
  morphoDefiProvider,
  MORPHO_LISTED
}
