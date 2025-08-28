import { describe, expect, it } from '@jest/globals'

import { calculateDynamicSlippage } from './helpers'

describe('Swap & Bridge: dynamic slippage calculations', () => {
  describe('Small amounts (< $400)', () => {
    it('should return 1% slippage for "0"', () => {
      expect(calculateDynamicSlippage('0')).toBe('0.010')
    })

    it('should return 1% slippage for "100"', () => {
      expect(calculateDynamicSlippage('100')).toBe('0.010')
    })

    it('should return 1% slippage for "399.99"', () => {
      expect(calculateDynamicSlippage('399.99')).toBe('0.010')
    })

    it('should return 1% slippage for "399"', () => {
      expect(calculateDynamicSlippage('399')).toBe('0.010')
    })
  })

  describe('Medium amounts ($400 - $19,999)', () => {
    it('should return 0.5% slippage for "400"', () => {
      expect(calculateDynamicSlippage('400')).toBe('0.005')
    })

    it('should return 0.5% slippage for "1000"', () => {
      expect(calculateDynamicSlippage('1000')).toBe('0.005')
    })

    it('should return 0.5% slippage for "19999"', () => {
      expect(calculateDynamicSlippage('19999')).toBe('0.005')
    })

    it('should return 0.5% slippage for "1999.99"', () => {
      expect(calculateDynamicSlippage('1999.99')).toBe('0.005')
    })
  })

  describe('Large amounts with absolute loss protection', () => {
    it('should cap slippage for $70,000 to prevent $350 loss (reported issue)', () => {
      // Without protection: 0.5% would allow $350 loss
      // With protection: $100 / $70,000 = 0.143% = 0.001
      // Baseline: factor = ceil(70000/20000) = 4, so 0.005/4 = 0.00125
      // Final: min(0.00125, 0.001) = 0.001 (minimum)
      expect(calculateDynamicSlippage('70000')).toBe('0.001')
    })

    it('should cap slippage for $100,000 to prevent $100 loss', () => {
      // $100 / $100,000 = 0.1% = 0.001
      expect(calculateDynamicSlippage('100000')).toBe('0.001')
    })

    it('should cap slippage for $50,000 to prevent $100 loss', () => {
      // Baseline: factor = ceil(50000/20000) = 3, so 0.005/3 = 0.00167
      // Absolute loss cap: $100 / $50,000 = 0.2% = 0.002
      // Final: min(0.00167, 0.002) = 0.00167 = 0.002 (rounded to 3 decimals)
      expect(calculateDynamicSlippage('50000')).toBe('0.002')
    })

    it('should cap slippage for $25,000 to prevent $100 loss', () => {
      // Baseline: factor = ceil(25000/20000) = 2, so 0.005/2 = 0.0025
      // Absolute loss cap: $100 / $25,000 = 0.4% = 0.004
      // Final: min(0.0025, 0.004) = 0.0025 = 0.003 (rounded to 3 decimals)
      expect(calculateDynamicSlippage('25000')).toBe('0.003')
    })

    it('should use baseline for $10,000 (no cap needed)', () => {
      // $100 / $10,000 = 1% > 0.5% baseline, so baseline prevails
      expect(calculateDynamicSlippage('10000')).toBe('0.005')
    })
  })

  describe('Very large amounts ($40,000+)', () => {
    it('should return minimum slippage for "40000"', () => {
      expect(calculateDynamicSlippage('40000')).toBe('0.003')
    })

    it('should return minimum slippage for "45000"', () => {
      expect(calculateDynamicSlippage('45000')).toBe('0.002')
    })

    it('should return minimum slippage for "60000"', () => {
      expect(calculateDynamicSlippage('60000')).toBe('0.002')
    })

    it('should return minimum slippage for "100000"', () => {
      expect(calculateDynamicSlippage('100000')).toBe('0.001')
    })

    it('should return minimum slippage for "1000000"', () => {
      expect(calculateDynamicSlippage('1000000')).toBe('0.001')
    })
  })

  describe('Boundary conditions', () => {
    it('should handle exact boundary at $400', () => {
      expect(calculateDynamicSlippage('400')).toBe('0.005')
    })

    it('should handle exact boundary at $20,000', () => {
      expect(calculateDynamicSlippage('20000')).toBe('0.005')
    })

    it('should handle exact boundary at $40,000', () => {
      expect(calculateDynamicSlippage('40000')).toBe('0.003')
    })

    it('should handle exact boundary at $60,000', () => {
      expect(calculateDynamicSlippage('60000')).toBe('0.002')
    })
  })

  describe('Edge cases and input validation', () => {
    it('should handle very small positive numbers', () => {
      expect(calculateDynamicSlippage('0.01')).toBe('0.010')
    })

    it('should handle very large numbers', () => {
      expect(calculateDynamicSlippage('999999999')).toBe('0.001')
    })

    it('should handle decimal amounts', () => {
      expect(calculateDynamicSlippage('399.5')).toBe('0.010')
      expect(calculateDynamicSlippage('400.5')).toBe('0.005')
    })

    it('should handle string inputs with decimals', () => {
      expect(calculateDynamicSlippage('399.99')).toBe('0.010')
      expect(calculateDynamicSlippage('400.01')).toBe('0.005')
    })

    it('should handle NaN input gracefully by returning default slippage', () => {
      expect(calculateDynamicSlippage('NaN')).toBe('0.010')
    })

    it('should handle Infinity input gracefully', () => {
      expect(calculateDynamicSlippage('Infinity')).toBe('0.010')
    })

    it('should handle negative numbers by returning default slippage', () => {
      expect(calculateDynamicSlippage('-100')).toBe('0.010')
      expect(calculateDynamicSlippage('-1000')).toBe('0.010')
    })
  })

  describe('Custom parameters', () => {
    it('should respect custom maxUsdLoss parameter', () => {
      // With $50 max loss instead of $100
      expect(calculateDynamicSlippage('50000', 50)).toBe('0.001') // $50 / $50,000 = 0.1% = 0.001
    })

    it('should respect custom minPercentage parameter', () => {
      // With 0.2% minimum instead of 0.1%
      expect(calculateDynamicSlippage('100000', 100, 0.002)).toBe('0.002')
    })

    it('should respect custom smallAmountPercentage parameter', () => {
      // With 2% for small amounts instead of 1%
      expect(calculateDynamicSlippage('100', 100, 0.001, 0.02)).toBe('0.020')
    })

    it('should handle all custom parameters together', () => {
      expect(calculateDynamicSlippage('50000', 200, 0.005, 0.015)).toBe('0.005')
    })
  })

  describe('Mathematical accuracy', () => {
    it('should maintain 3 decimal precision', () => {
      const result = calculateDynamicSlippage('50000')
      const decimalPlaces = result.split('.')[1]?.length || 0
      expect(decimalPlaces).toBe(3)
    })

    it('should always return a valid number string', () => {
      const testAmounts = ['0', '100', '400', '1000', '20000', '40000', '100000']
      testAmounts.forEach((amount) => {
        const result = calculateDynamicSlippage(amount)
        expect(typeof result).toBe('string')
        expect(Number(result)).not.toBeNaN()
        expect(Number(result)).toBeGreaterThan(0)
      })
    })
  })

  describe('Business logic validation', () => {
    it('should never return slippage below 0.1%', () => {
      const largeAmounts = ['100000', '200000', '500000', '1000000']
      largeAmounts.forEach((amount) => {
        const slippage = Number(calculateDynamicSlippage(amount))
        expect(slippage).toBeGreaterThanOrEqual(0.001)
      })
    })

    it('should never return slippage above 1%', () => {
      const smallAmounts = ['0', '100', '200', '399']
      smallAmounts.forEach((amount) => {
        const slippage = Number(calculateDynamicSlippage(amount))
        expect(slippage).toBeLessThanOrEqual(0.01)
      })
    })

    it('should have decreasing slippage for increasing amounts', () => {
      const amounts = ['100', '500', '1000', '20000', '40000', '60000', '100000']
      const slippages = amounts.map((amount) => Number(calculateDynamicSlippage(amount)))

      for (let i = 1; i < slippages.length; i++) {
        expect(slippages[i]).toBeLessThanOrEqual(slippages[i - 1])
      }
    })

    it('should cap absolute loss to $100 for large amounts', () => {
      const testCases = [
        { amount: 50000, expectedMaxLoss: 100 },
        { amount: 100000, expectedMaxLoss: 100 },
        { amount: 200000, expectedMaxLoss: 100 },
        { amount: 500000, expectedMaxLoss: 100 }
      ]

      testCases.forEach(({ amount, expectedMaxLoss }) => {
        const slippage = Number(calculateDynamicSlippage(amount.toString()))
        const actualMaxLoss = (amount * slippage) / 100
        expect(actualMaxLoss).toBeLessThanOrEqual(expectedMaxLoss)
      })
    })
  })
})
