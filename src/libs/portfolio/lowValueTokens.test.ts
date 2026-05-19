import { describe, expect, it } from '@jest/globals'

import { AssetType } from '../defiPositions/types'
import { TokenResult } from './interfaces'
import {
  getDashboardTokenCount,
  getTokenUnitPriceUSD,
  isLowValueToken,
  partitionLowValueTokens,
  shouldCollapseLowValueTokens,
  shouldExcludeFromLowValueCollapse
} from './lowValueTokens'

const createToken = (overrides: Partial<TokenResult> = {}): TokenResult =>
  ({
    symbol: 'TEST',
    name: 'Test Token',
    decimals: 18,
    address: '0x0000000000000000000000000000000000000001',
    chainId: 1n,
    amount: 1000000000000000000n,
    priceIn: [{ baseCurrency: 'usd', price: 1 }],
    marketDataIn: [],
    flags: {
      onGasTank: false,
      rewardsType: null,
      canTopUpGasTank: false,
      isFeeToken: false
    },
    ...overrides
  }) as TokenResult

describe('lowValueTokens', () => {
  describe('getTokenUnitPriceUSD', () => {
    it('returns null when there is no USD price', () => {
      expect(getTokenUnitPriceUSD(createToken({ priceIn: [] }))).toBeNull()
      expect(
        getTokenUnitPriceUSD(createToken({ priceIn: [{ baseCurrency: 'eur', price: 1 }] }))
      ).toBeNull()
    })

    it('returns the USD unit price when available', () => {
      expect(
        getTokenUnitPriceUSD(createToken({ priceIn: [{ baseCurrency: 'usd', price: 0.5 }] }))
      ).toBe(0.5)
    })
  })

  describe('isLowValueToken', () => {
    it('treats tokens without price as low-value', () => {
      expect(isLowValueToken(createToken({ priceIn: [] }))).toBe(true)
    })

    it('does not treat cheap tokens as low-value when the holding is meaningful', () => {
      expect(
        isLowValueToken(createToken({ priceIn: [{ baseCurrency: 'usd', price: 0.01 }] }))
      ).toBe(false)
      expect(
        isLowValueToken(
          createToken({
            priceIn: [{ baseCurrency: 'usd', price: 0.009 }],
            amount: 100000000000000000000n // 100 tokens ≈ $0.90
          })
        )
      ).toBe(false)
    })

    it('does not treat tokens above $0.01 balance as low-value', () => {
      expect(
        isLowValueToken(createToken({ priceIn: [{ baseCurrency: 'usd', price: 0.011 }] }))
      ).toBe(false)
    })

    it('treats tokens with a balance below $0.01 as low-value even when unit price is higher', () => {
      expect(
        isLowValueToken(
          createToken({
            priceIn: [{ baseCurrency: 'usd', price: 1 }],
            amount: 1000000000000000n // 0.001 tokens
          })
        )
      ).toBe(true)
    })
  })

  describe('shouldCollapseLowValueTokens', () => {
    it('returns false below the threshold and true at or above it', () => {
      expect(shouldCollapseLowValueTokens(99)).toBe(false)
      expect(shouldCollapseLowValueTokens(100)).toBe(true)
      expect(shouldCollapseLowValueTokens(250)).toBe(true)
    })
  })

  describe('shouldExcludeFromLowValueCollapse', () => {
    it('excludes pending simulation and rewards tokens', () => {
      expect(
        shouldExcludeFromLowValueCollapse(createToken({ amount: 1n, amountPostSimulation: 2n }))
      ).toBe(true)
      expect(
        shouldExcludeFromLowValueCollapse(
          createToken({ flags: { ...createToken().flags, rewardsType: 'wallet-rewards' } })
        )
      ).toBe(true)
      expect(shouldExcludeFromLowValueCollapse(createToken())).toBe(false)
    })
  })

  describe('getDashboardTokenCount', () => {
    it('excludes gas tank and borrowed DeFi tokens from the count', () => {
      const tokens = [
        createToken(),
        createToken({ flags: { ...createToken().flags, onGasTank: true } }),
        createToken({
          flags: { ...createToken().flags, defiTokenType: AssetType.Borrow }
        })
      ]

      expect(getDashboardTokenCount(tokens)).toBe(1)
    })
  })

  describe('partitionLowValueTokens', () => {
    it('splits tokens and sums the collapsed USD balance', () => {
      const tokens = [
        createToken({
          address: '0x1',
          priceIn: [{ baseCurrency: 'usd', price: 1 }],
          amount: 2000000000000000000n
        }),
        createToken({
          address: '0x2',
          priceIn: [{ baseCurrency: 'usd', price: 0.01 }],
          amount: 100000000000000000n // 0.1 tokens ≈ $0.001
        }),
        createToken({
          address: '0x4',
          priceIn: [{ baseCurrency: 'usd', price: 0.01 }],
          amount: 1000000000000000000n // 1 token = $0.01, stays visible
        }),
        createToken({
          address: '0x3',
          priceIn: []
        })
      ]

      const { visible, lowValue, lowValueTotalUsd } = partitionLowValueTokens(tokens)

      expect(visible).toHaveLength(2)
      expect(lowValue).toHaveLength(2)
      expect(lowValueTotalUsd).toBeCloseTo(0.001)
    })
  })
})
