import { Contract, Wallet } from 'ethers'
import { isAddress, maxUint256 } from 'viem'

import { afterEach, describe, expect, jest, test } from '@jest/globals'

import { networks } from '../../../../consts/networks'
import { Network } from '../../../../interfaces/network'
import { getRpcProvider } from '../../../../services/provider'
import { Deployless } from '../../../deployless/deployless'
import { AssetType } from '../../types'
import {
  AAVE_V2_POOLS,
  AAVE_V2_PROVIDER_NAME,
  AaveV2ReserveResult,
  getAaveV2Position,
  getAaveV2Positions
} from './aaveV2'

const ethereum = networks.find(({ chainId }) => chainId === 1n)!
const POOL = AAVE_V2_POOLS['1']!
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const A_USDC = '0xBcca60bB61934080951369a648Fb03DF4F96263C'
const VARIABLE_DEBT_USDC = '0x619beb58998eD2278e08620f97007e1116D5D25b'
const STABLE_DEBT_USDC = '0xE4922afAB0BbaDd8ab2a88E0C79d884Ad337fcA6'
const RAY = 10n ** 27n

const reserve = (overrides: Partial<AaveV2ReserveResult> = {}): AaveV2ReserveResult => ({
  addr: USDC,
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 6,
  balance: 0n,
  borrowAssetBalance: 0n,
  stableBorrowAssetBalance: 0n,
  // 3%, 5% and 8% a year
  currentLiquidityRate: (3n * RAY) / 100n,
  currentVariableBorrowRate: (5n * RAY) / 100n,
  currentStableBorrowRate: (8n * RAY) / 100n,
  aaveAddr: A_USDC,
  aaveSymbol: 'aUSDC',
  aaveName: 'Aave interest bearing USDC',
  aaveDecimals: 6,
  aaveSDebtAddr: STABLE_DEBT_USDC,
  aaveSDebtSymbol: 'stableDebtUSDC',
  aaveSDebtName: 'Aave stable debt bearing USDC',
  aaveSDebtDecimals: 6,
  aaveVDebtAddr: VARIABLE_DEBT_USDC,
  aaveVDebtSymbol: 'variableDebtUSDC',
  aaveVDebtName: 'Aave variable debt bearing USDC',
  aaveVDebtDecimals: 6,
  ...overrides
})

describe('Aave v2 positions', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('getAaveV2Position', () => {
    test('has what the account supplied and borrowed, at a variable and a stable rate', () => {
      const position = getAaveV2Position(
        [
          reserve({
            balance: 1000n * 10n ** 6n,
            borrowAssetBalance: 200n * 10n ** 6n,
            stableBorrowAssetBalance: 100n * 10n ** 6n
          })
        ],
        2n * 10n ** 18n,
        POOL
      )!

      expect(position.assets.map(({ type, amount }) => [type, amount])).toEqual([
        [AssetType.Collateral, 1000n * 10n ** 6n],
        [AssetType.Borrow, 200n * 10n ** 6n],
        [AssetType.Borrow, 100n * 10n ** 6n]
      ])
      expect(position.assets.map(({ additionalData }) => additionalData!.APY)).toEqual([3, 5, 8])
      expect(position.additionalData.healthRate).toBe(2)
    })
    test('links each asset to the token that represents it in the wallet', () => {
      const position = getAaveV2Position(
        [
          reserve({
            balance: 1n,
            borrowAssetBalance: 1n,
            stableBorrowAssetBalance: 1n
          })
        ],
        2n * 10n ** 18n,
        POOL
      )!

      expect(position.assets.map(({ protocolAsset }) => protocolAsset!.address)).toEqual([
        A_USDC,
        VARIABLE_DEBT_USDC,
        STABLE_DEBT_USDC
      ])
    })
    test('is not priced, as the oracle of Aave v2 prices in ETH on some networks', () => {
      const position = getAaveV2Position([reserve({ balance: 1n })], maxUint256, POOL)!

      expect(position.assets[0]!.priceIn).toBeUndefined()
      expect(position.additionalData.positionInUSD).toBeUndefined()
    })
    test('has no health rate without debt', () => {
      const position = getAaveV2Position([reserve({ balance: 1n })], maxUint256, POOL)!

      expect(position.additionalData.healthRate).toBeNull()
    })
    test('is identified by the pool', () => {
      const position = getAaveV2Position([reserve({ balance: 1n })], maxUint256, POOL)!

      expect(position.id).toBe(POOL.toLowerCase())
      expect(position.additionalData.positionIndex).toBe(POOL.toLowerCase())
      expect(position.additionalData.name).toBe('Lending')
    })
    test('leaves out the reserves whose token could not be read', () => {
      expect(
        getAaveV2Position([reserve({ balance: 1n, symbol: 'error' })], maxUint256, POOL)
      ).toBeNull()
    })
    test('returns null when the account has nothing in the pool', () => {
      expect(getAaveV2Position([reserve()], maxUint256, POOL)).toBeNull()
    })
  })

  describe('getAaveV2Positions', () => {
    const provider = getRpcProvider(['https://invictus.ambire.com/ethereum'], 1n)
    const account = Wallet.createRandom().address

    const mockPool = (reservesCount: number) => {
      jest.spyOn(Contract.prototype, 'getFunction').mockReturnValue({
        staticCall: async () => Array.from({ length: reservesCount }, () => USDC)
      } as unknown as ReturnType<Contract['getFunction']>)

      return jest.spyOn(Deployless.prototype, 'call').mockResolvedValue({
        userBalance: [reserve({ balance: 1n })],
        accountData: { healthFactor: maxUint256 }
      })
    }

    test('reads every reserve of the pool, 15 per call', async () => {
      const callSpy = mockPool(37)

      const result = await getAaveV2Positions(account, provider, ethereum)

      expect(callSpy.mock.calls.map(([, args]) => (args as number[]).slice(2))).toEqual([
        [0, 15],
        [15, 30],
        [30, 45]
      ])
      expect(result!.providerName).toBe(AAVE_V2_PROVIDER_NAME)
      expect(result!.source).toBe('custom')
      expect(result!.type).toBe('lending')
      expect(result!.positions).toHaveLength(1)
    })
    test('reads nothing on networks without Aave v2', async () => {
      const callSpy = jest.spyOn(Deployless.prototype, 'call')
      const networkWithoutAaveV2: Network = { ...ethereum, chainId: 8453n }

      expect(await getAaveV2Positions(account, provider, networkWithoutAaveV2)).toBeNull()
      expect(callSpy).not.toHaveBeenCalled()
    })
  })

  describe('pools', () => {
    test('has a well-formed address for every network', () => {
      Object.values(AAVE_V2_POOLS).forEach((pool) => expect(isAddress(pool)).toBe(true))
    })
  })

  describe('reading positions on-chain (Ethereum)', () => {
    const provider = getRpcProvider(['https://invictus.ambire.com/ethereum'], 1n)
    /** The treasury of the Aave v2 market on Ethereum, which holds aTokens */
    const AAVE_V2_COLLECTOR = '0x464C71f6c2F760DdA6093dCB91C24c39e5d6e18c'

    test('finds what an account supplied', async () => {
      const result = await getAaveV2Positions(AAVE_V2_COLLECTOR, provider, ethereum)
      const [position] = result!.positions

      expect(position!.assets.length).toBeGreaterThan(0)
      expect(position!.assets.every(({ type }) => type === AssetType.Collateral)).toBe(true)
      expect(position!.assets.every(({ protocolAsset }) => isAddress(protocolAsset!.address))).toBe(
        true
      )
    })
    test('returns null for an account without positions', async () => {
      expect(await getAaveV2Positions(Wallet.createRandom().address, provider, ethereum)).toBeNull()
    })
  })
})
