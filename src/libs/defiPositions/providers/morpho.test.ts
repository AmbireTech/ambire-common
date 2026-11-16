import { isAddress, isHex } from 'viem'

import { describe, expect, test } from '@jest/globals'

import { networks } from '../../../consts/networks'
import { Network } from '../../../interfaces/network'
import { getRpcProvider } from '../../../services/provider'
import { MORPHO } from '../defiAddresses'
import { AssetType } from '../types'
import {
  getMorphoApys,
  getMorphoBorrowAssets,
  getMorphoHealthRate,
  getMorphoMarketTotalsWithAccruedInterest,
  getMorphoSupplyAssets,
  MorphoMarketTotals
} from './helpers/morphoMath'
import { MORPHO_LISTED_MARKET_IDS, MORPHO_LISTED_VAULT_ADDRS } from '../morphoListed'
import {
  getMorphoMarketPosition,
  getMorphoPositions,
  getMorphoPositionsCallArgs,
  getMorphoVaultPosition,
  MORPHO_PROVIDER_NAME,
  MorphoMarketPositionResult,
  MorphoVaultPositionResult
} from './morpho'

const WAD = 10n ** 18n

const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const BASE_CBBTC = '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf'
/** cbBTC / USDC on Base, the largest Morpho market there */
const BASE_CBBTC_USDC_MARKET = '0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836'
/** Steakhouse USDC, a MetaMorpho vault created by the legacy (v1.0) factory */
const BASE_STEAKHOUSE_USDC_VAULT = '0xbeeF010f9cb27031ad51e3333f9aF9C6B1228183'

const market = (overrides: Partial<MorphoMarketTotals> = {}): MorphoMarketTotals => ({
  totalSupplyAssets: 2n * 10n ** 12n,
  totalSupplyShares: 2n * 10n ** 18n,
  totalBorrowAssets: 10n ** 12n,
  totalBorrowShares: 10n ** 18n,
  lastUpdate: 1000n,
  fee: 0n,
  ...overrides
})

const tokenInfo = (symbol: string, decimals: number) => ({
  symbol,
  name: symbol,
  decimals,
  hasDecimals: true
})

const marketResult = (
  overrides: Partial<MorphoMarketPositionResult> = {}
): MorphoMarketPositionResult => ({
  id: BASE_CBBTC_USDC_MARKET,
  params: {
    loanToken: BASE_USDC,
    collateralToken: BASE_CBBTC,
    oracle: '0x663BECd10daE6C4A3Dcd89F1d76c1174199639B9',
    irm: '0x46415998764C29aB2a25CbeA6254146D50D22687',
    lltv: 86n * 10n ** 16n
  },
  market: market({ lastUpdate: 1000n }),
  supplyShares: 0n,
  borrowShares: 3n * 10n ** 16n, // 30 000 USDC
  collateral: 10n ** 8n, // 1 cbBTC
  borrowRate: 0n,
  hasBorrowRate: true,
  // 1 cbBTC = 60 000 USDC, in loan token units per collateral token unit, scaled by 1e36
  oraclePrice: 6n * 10n ** 38n,
  hasOraclePrice: true,
  loanToken: tokenInfo('USDC', 6),
  collateralToken: tokenInfo('cbBTC', 8),
  ...overrides
})

const vaultResult = (
  overrides: Partial<MorphoVaultPositionResult> = {}
): MorphoVaultPositionResult => ({
  vault: BASE_STEAKHOUSE_USDC_VAULT,
  shares: 10n ** 18n,
  assets: 1_100_000n,
  hasAssets: true,
  vaultToken: { symbol: 'steakUSDC', name: 'Steakhouse USDC', decimals: 18, hasDecimals: true },
  asset: BASE_USDC,
  assetToken: tokenInfo('USDC', 6),
  ...overrides
})

describe('Morpho math', () => {
  test('returns the market as it is when no time has passed', () => {
    const totals = market()

    expect(getMorphoMarketTotalsWithAccruedInterest(totals, 10n ** 9n, 1000n)).toBe(totals)
  })

  test('returns the market as it is without a borrow rate or borrows', () => {
    const totals = market()

    expect(getMorphoMarketTotalsWithAccruedInterest(totals, null, 5000n)).toBe(totals)

    const withoutBorrows = market({ totalBorrowAssets: 0n })
    expect(getMorphoMarketTotalsWithAccruedInterest(withoutBorrows, 10n ** 9n, 5000n)).toBe(
      withoutBorrows
    )
  })

  test('accrues the interest to both the supply and the borrows', () => {
    // 1e9 per second for 1000 seconds on 1M USDC of borrows is ~1 USDC of interest
    const accrued = getMorphoMarketTotalsWithAccruedInterest(market(), 10n ** 9n, 2000n)

    expect(accrued.totalBorrowAssets).toBe(10n ** 12n + 1_000_000n)
    expect(accrued.totalSupplyAssets).toBe(2n * 10n ** 12n + 1_000_000n)
    expect(accrued.totalSupplyShares).toBe(2n * 10n ** 18n)
    expect(accrued.lastUpdate).toBe(2000n)
  })

  test('mints supply shares to the fee recipient for its part of the interest', () => {
    const accrued = getMorphoMarketTotalsWithAccruedInterest(
      market({ fee: WAD / 10n }),
      10n ** 9n,
      2000n
    )

    // 10% of the interest (0.1 USDC) worth of shares, like Morpho.accrueInterest
    expect(accrued.totalSupplyShares).toBe(2n * 10n ** 18n + 99_999_955_000n)
  })

  test('rounds supplied assets down and borrowed assets up, in favor of the protocol', () => {
    const totals = market({ totalSupplyAssets: 10n ** 6n, totalSupplyShares: 10n ** 12n })

    expect(getMorphoSupplyAssets(10n ** 12n, totals)).toBe(10n ** 6n)
    expect(getMorphoSupplyAssets(1n, totals)).toBe(0n)
    expect(
      getMorphoBorrowAssets(1n, {
        ...totals,
        totalBorrowAssets: 10n ** 6n,
        totalBorrowShares: 10n ** 12n
      })
    ).toBe(1n)
  })

  test('calculates the health rate from the oracle price and the liquidation LTV', () => {
    expect(
      getMorphoHealthRate({
        collateral: 10n ** 8n,
        borrowAssets: 30_000n * 10n ** 6n,
        oraclePrice: 6n * 10n ** 38n,
        lltv: 86n * 10n ** 16n
      })
    ).toBe(1.72)
  })

  test('has no health rate without debt', () => {
    expect(
      getMorphoHealthRate({
        collateral: 10n ** 8n,
        borrowAssets: 0n,
        oraclePrice: 6n * 10n ** 38n,
        lltv: 86n * 10n ** 16n
      })
    ).toBeNull()
  })

  test('the supply APY is the borrow APY scaled by the utilization and the fee', () => {
    const { borrowApy, supplyApy } = getMorphoApys(1_619_761_987n, market({ fee: WAD / 10n }))

    expect(borrowApy).toBeCloseTo(5.2408, 3)
    // 50% utilization, 10% fee
    expect(supplyApy).toBeCloseTo(borrowApy * 0.5 * 0.9, 6)
  })

  test('the supply APY is 0 for an empty market', () => {
    const { supplyApy } = getMorphoApys(10n ** 9n, market({ totalSupplyAssets: 0n }))

    expect(supplyApy).toBe(0)
  })
})

describe('Morpho positions', () => {
  describe('getMorphoMarketPosition', () => {
    test('a borrow position has its collateral, debt and health rate', () => {
      const position = getMorphoMarketPosition(marketResult(), 1000n)!

      expect(position.id).toBe(BASE_CBBTC_USDC_MARKET)
      expect(position.additionalData.positionIndex).toBe(BASE_CBBTC_USDC_MARKET)
      expect(position.additionalData.description).toBe('cbBTC / USDC')
      expect(position.additionalData.healthRate).toBe(1.72)
      expect(position.assets).toEqual([
        expect.objectContaining({
          address: BASE_CBBTC,
          amount: 10n ** 8n,
          type: AssetType.Collateral
        }),
        expect.objectContaining({
          address: BASE_USDC,
          amount: 30_000n * 10n ** 6n,
          type: AssetType.Borrow
        })
      ])
      // Priced later through the token prices controller
      expect(position.assets.every(({ priceIn }) => !priceIn)).toBe(true)
    })

    test('a supply position has no health rate', () => {
      const position = getMorphoMarketPosition(
        marketResult({ supplyShares: 2n * 10n ** 16n, borrowShares: 0n, collateral: 0n }),
        1000n
      )!

      expect(position.additionalData.healthRate).toBeNull()
      expect(position.assets).toEqual([
        expect.objectContaining({
          address: BASE_USDC,
          amount: 20_000n * 10n ** 6n,
          type: AssetType.Collateral
        })
      ])
    })

    test('the debt includes the interest accrued since the market was last updated', () => {
      const position = getMorphoMarketPosition(marketResult({ borrowRate: 10n ** 9n }), 2000n)!
      const debt = position.assets.find(({ type }) => type === AssetType.Borrow)!

      // 3% of the borrows, so 3% of the ~1 USDC interest
      expect(debt.amount).toBe(30_000n * 10n ** 6n + 30_000n)
    })

    test('has no health rate when the oracle call failed', () => {
      const position = getMorphoMarketPosition(marketResult({ hasOraclePrice: false }), 1000n)!

      expect(position.additionalData.healthRate).toBeNull()
    })

    test('the collateral can be valued in loan tokens, by the oracle price', () => {
      const position = getMorphoMarketPosition(marketResult(), 1000n)!

      // 1 cbBTC = 60 000 USDC
      expect(position.assets[0]!.priceFallback).toEqual({
        address: BASE_USDC,
        decimals: 6,
        amount: 60_000n * 10n ** 6n
      })
      // The loan tokens have a price of their own
      expect(position.assets[1]!.priceFallback).toBeUndefined()
    })

    test('the collateral has no fallback value without an oracle price', () => {
      const position = getMorphoMarketPosition(marketResult({ hasOraclePrice: false }), 1000n)!

      expect(position.assets[0]!.priceFallback).toBeUndefined()
    })

    test('is not displayed when a part of it is of a token without decimals', () => {
      const tokenWithoutDecimals = { ...tokenInfo('TKN', 0), hasDecimals: false }

      // Collateral without the debt would overstate the value of the position, and the other way around
      expect(
        getMorphoMarketPosition(marketResult({ loanToken: tokenWithoutDecimals }), 1000n)
      ).toBeNull()
      expect(
        getMorphoMarketPosition(marketResult({ collateralToken: tokenWithoutDecimals }), 1000n)
      ).toBeNull()
    })

    test('is displayed when the token without decimals is not a part of it', () => {
      const tokenWithoutDecimals = { ...tokenInfo('TKN', 0), hasDecimals: false }
      // Supplied loan tokens only, no collateral
      const supplyOnly = marketResult({
        supplyShares: 2n * 10n ** 16n,
        borrowShares: 0n,
        collateral: 0n,
        collateralToken: tokenWithoutDecimals
      })

      expect(getMorphoMarketPosition(supplyOnly, 1000n)?.assets.length).toBe(1)
    })

    test('has no description when a token has no symbol', () => {
      const position = getMorphoMarketPosition(
        marketResult({ collateralToken: tokenInfo('', 8) }),
        1000n
      )!

      expect(position.additionalData.description).toBeUndefined()
    })
  })

  describe('getMorphoVaultPosition', () => {
    test('a vault position holds the underlying asset and links the vault token', () => {
      const position = getMorphoVaultPosition(vaultResult())!

      expect(position.additionalData.description).toBe('Steakhouse USDC')
      expect(position.additionalData.pool).toEqual({
        id: BASE_STEAKHOUSE_USDC_VAULT.toLowerCase(),
        controller: BASE_STEAKHOUSE_USDC_VAULT
      })
      expect(position.assets).toEqual([
        expect.objectContaining({ address: BASE_USDC, amount: 1_100_000n, decimals: 6 })
      ])
      // The vault token must not be a protocol asset: it would get the price of the
      // underlying asset, though 1 share isn't worth 1 USDC
      expect(position.assets[0]!.protocolAsset).toBeUndefined()
    })

    test('returns null for shares worth nothing or of unknown value', () => {
      expect(getMorphoVaultPosition(vaultResult({ assets: 0n }))).toBeNull()
      expect(getMorphoVaultPosition(vaultResult({ hasAssets: false, assets: 0n }))).toBeNull()
      expect(
        getMorphoVaultPosition(
          vaultResult({ assetToken: { ...tokenInfo('USDC', 0), hasDecimals: false } })
        )
      ).toBeNull()
    })
  })

  describe('listed markets and vaults', () => {
    test('has markets and vaults for every network with Morpho', () => {
      Object.keys(MORPHO).forEach((chainId) => {
        expect(MORPHO_LISTED_MARKET_IDS[chainId]?.length).toBeGreaterThan(0)
        expect(MORPHO_LISTED_VAULT_ADDRS[chainId]?.length).toBeGreaterThan(0)
      })
    })

    test('has only unique, well-formed market ids', () => {
      Object.values(MORPHO_LISTED_MARKET_IDS).forEach((marketIds) => {
        expect(new Set(marketIds.map((id) => id.toLowerCase())).size).toBe(marketIds.length)
        marketIds.forEach((id) => expect(isHex(id) && id.length === 66).toBe(true))
      })
    })

    test('has only unique, well-formed vault addresses', () => {
      Object.values(MORPHO_LISTED_VAULT_ADDRS).forEach((vaults) => {
        expect(new Set(vaults.map((addr) => addr.toLowerCase())).size).toBe(vaults.length)
        vaults.forEach((addr) => expect(isAddress(addr, { strict: false })).toBe(true))
      })
    })
  })

  describe('getMorphoPositionsCallArgs', () => {
    const marketIds = Array.from({ length: 650 }, (_, i) => `0x${i.toString(16).padStart(64, '0')}`)
    const vaultCandidates = Array.from(
      { length: 250 },
      (_, i) => `0x${i.toString(16).padStart(40, '0')}`
    )
    const ethereum = networks.find(({ chainId }) => chainId === 1n)!

    test('reads everything in a single call when the RPC supports state override', () => {
      expect(
        getMorphoPositionsCallArgs(
          { ...ethereum, rpcNoStateOverride: false },
          { marketIds, vaultCandidates }
        )
      ).toEqual([{ marketIds, vaultCandidates }])
    })

    test('splits the call without state override, so its data stays below the 24kb limit', () => {
      const callArgs = getMorphoPositionsCallArgs(
        { ...ethereum, rpcNoStateOverride: true },
        { marketIds, vaultCandidates }
      )

      expect(callArgs.map((args) => [args.marketIds.length, args.vaultCandidates.length])).toEqual([
        [300, 0],
        [300, 0],
        [50, 0],
        [0, 200],
        [0, 50]
      ])
      // Every market and vault is checked exactly once
      expect(callArgs.flatMap((args) => args.marketIds)).toEqual(marketIds)
      expect(callArgs.flatMap((args) => args.vaultCandidates)).toEqual(vaultCandidates)
    })
  })

  // If these tests fail because the accounts closed their positions, find other ones with
  // https://api.morpho.org/graphql (marketPositions / vaultPositions on chain 8453)
  describe('reading positions on-chain (Base)', () => {
    const borrower = '0x3658D261247Dd37ADff2F3B925153A8401628B61'
    const vaultDepositor = '0xB318c8880950e2058a2f1e11f2657987Ff9f7654'

    const base = networks.find(({ chainId }) => chainId === 8453n)
    if (!base) throw new Error('unable to find base network in consts')

    const providerBase = getRpcProvider(['https://invictus.ambire.com/base'], 8453n)

    test('finds a borrow position in a listed market', async () => {
      const result = await getMorphoPositions(borrower, providerBase, base, [])
      const position = result!.positions.find(({ id }) => id === BASE_CBBTC_USDC_MARKET)!

      expect(result!.providerName).toBe(MORPHO_PROVIDER_NAME)
      expect(result!.source).toBe('custom')
      expect(result!.type).toBe('lending')
      expect(position.additionalData.description).toBe('cbBTC / USDC')
      expect(position.additionalData.healthRate).toBeGreaterThan(1)
      expect(position.assets.map(({ type }) => type)).toEqual([
        AssetType.Collateral,
        AssetType.Borrow
      ])
    })

    test('finds a vault position from the tokens the account holds', async () => {
      const result = await getMorphoPositions(vaultDepositor, providerBase, base, [
        BASE_USDC,
        BASE_STEAKHOUSE_USDC_VAULT
      ])
      const position = result!.positions.find(
        ({ id }) => id === BASE_STEAKHOUSE_USDC_VAULT.toLowerCase()
      )!

      expect(result!.type).toBe('common')
      expect(position.assets[0]!.symbol).toBe('USDC')
      expect(position.assets[0]!.amount).toBeGreaterThan(0n)
      expect(position.additionalData.description).toBe('Steakhouse USDC')
    })

    test('does not read tokens that were not deployed by Morpho as vaults', async () => {
      // USDC and the Morpho contract itself are not vaults, whatever they return
      const notVaults = [BASE_USDC.toLowerCase(), MORPHO['8453']!.morphoAddr.toLowerCase()]
      const result = await getMorphoPositions(vaultDepositor, providerBase, base, notVaults)

      expect(result!.positions.some(({ id }) => notVaults.includes(id))).toBe(false)
    })

    test('ignores malformed and duplicate token addresses', async () => {
      const result = await getMorphoPositions(vaultDepositor, providerBase, base, [
        'not-an-address',
        BASE_STEAKHOUSE_USDC_VAULT,
        BASE_STEAKHOUSE_USDC_VAULT.toLowerCase()
      ])
      const vaultIds = result!.positions.map(({ id }) => id)

      expect(new Set(vaultIds).size).toBe(vaultIds.length)
      expect(vaultIds).toContain(BASE_STEAKHOUSE_USDC_VAULT.toLowerCase())
    })

    test('finds a listed vault position even if the account tokens are unknown', async () => {
      const result = await getMorphoPositions(vaultDepositor, providerBase, base, [])

      expect(MORPHO_LISTED_VAULT_ADDRS['8453']!.map((a) => a.toLowerCase())).toContain(
        BASE_STEAKHOUSE_USDC_VAULT.toLowerCase()
      )
      expect(result!.positions.map(({ id }) => id)).toContain(
        BASE_STEAKHOUSE_USDC_VAULT.toLowerCase()
      )
    })

    test('reads the same positions when the RPC has no state override', async () => {
      const withoutStateOverride: Network = { ...base, rpcNoStateOverride: true }
      const [withOverride, withoutOverride] = await Promise.all([
        getMorphoPositions(borrower, providerBase, base, []),
        getMorphoPositions(borrower, providerBase, withoutStateOverride, [])
      ])

      expect(withoutOverride!.positions.map(({ id }) => id).sort()).toEqual(
        withOverride!.positions.map(({ id }) => id).sort()
      )
    })

    test('returns a provider without positions for an account without any', async () => {
      const result = await getMorphoPositions(
        '0x000000000000000000000000000000000000dEaD',
        providerBase,
        base,
        []
      )

      expect(result!.positions).toEqual([])
    })

    test('returns null on networks without Morpho', async () => {
      const networkWithoutMorpho: Network = { ...base, chainId: 534352n }

      expect(await getMorphoPositions(borrower, providerBase, networkWithoutMorpho, [])).toBeNull()
    })
  })
})
