import { parseUnits } from 'ethers'

import { describe, expect, test } from '@jest/globals'
import { Token as LiFiToken } from '@lifi/types'

import { SwapAndBridgeQuote } from '../../interfaces/swapAndBridge'
import { calculateAmountWarnings } from './swapAndBridge'

// Helper function to create a mock route for testing
const createMockRoute = ({
  inputValueInUsd,
  outputValueInUsd,
  fromAmount,
  minAmountOut,
  toTokenDecimals = 6,
  toTokenPriceUSD = 1,
  fromTokenDecimals = 18,
  toTokenSymbol = 'USDC'
}: {
  inputValueInUsd: number
  outputValueInUsd: number
  fromAmount: number // Regular number (e.g., 0.05 for 0.05 ETH)
  minAmountOut: number // Regular number (e.g., 1 for 1 USDC)
  toTokenDecimals?: number
  toTokenPriceUSD?: number
  fromTokenDecimals?: number
  toTokenSymbol?: string
}): SwapAndBridgeQuote['selectedRoute'] => {
  const fromAmountWei = parseUnits(fromAmount.toString(), fromTokenDecimals).toString()
  const minAmountOutWei = parseUnits(minAmountOut.toString(), toTokenDecimals).toString()
  const toTokenPriceUSDStr = toTokenPriceUSD.toString()

  return {
    providerId: 'test-provider',
    routeId: 'test-route-id',
    currentUserTxIndex: 0,
    fromChainId: 1,
    toChainId: 1,
    userAddress: '0x1234567890123456789012345678901234567890',
    isOnlySwapRoute: true,
    fromAmount: fromAmountWei,
    toAmount: 'DOES NOT MATTER',
    userTxs: [
      {
        userTxIndex: 0,
        chainId: 1,
        fromAsset: {
          address: '0x0000000000000000000000000000000000000000',
          chainId: 1,
          decimals: fromTokenDecimals,
          symbol: 'ETH',
          name: 'Ethereum'
        },
        toAsset: {
          address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          chainId: 1,
          decimals: toTokenDecimals,
          symbol: toTokenSymbol,
          name: 'USD Coin'
        },
        fromAmount: fromAmountWei,
        toAmount: 'DOES NOT MATTER',
        minAmountOut: minAmountOutWei,
        swapSlippage: 0.5,
        protocol: {
          displayName: 'Test DEX',
          icon: '',
          name: 'test-dex'
        }
      }
    ],
    steps: [],
    inputValueInUsd,
    outputValueInUsd,
    serviceTime: 30,
    rawRoute: {} as any,
    toToken: {
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      chainId: 1,
      decimals: toTokenDecimals,
      symbol: toTokenSymbol,
      name: 'USD Coin',
      priceUSD: toTokenPriceUSDStr
    } as LiFiToken,
    disabled: false
  }
}

describe('swapAndBridge lib', () => {
  describe('calculateAmountWarnings', () => {
    test('should return null when selectedRoute is not provided', () => {
      const result = calculateAmountWarnings(undefined, '100', '0.05', 18)
      expect(result).toBeNull()
    })

    test('should return null when fromAmountInFiat is invalid', () => {
      const selectedRoute = createMockRoute({
        inputValueInUsd: 100,
        outputValueInUsd: 95,
        fromAmount: 0.05,
        minAmountOut: 95
      })
      const result = calculateAmountWarnings(selectedRoute, 'invalid', '0.05', 18)
      expect(result).toBeNull()
    })

    test('should return null when fromAmountInFiat is 0', () => {
      const selectedRoute = createMockRoute({
        inputValueInUsd: 100,
        outputValueInUsd: 95,
        fromAmount: 0.05,
        minAmountOut: 95
      })
      const result = calculateAmountWarnings(selectedRoute, '0', '0.05', 18)
      expect(result).toBeNull()
    })

    test('should return null when outputValueInUsd > inputValueInUsd (arbitrage)', () => {
      const selectedRoute = createMockRoute({
        inputValueInUsd: 100,
        outputValueInUsd: 105,
        fromAmount: 0.05,
        minAmountOut: 95
      })
      const result = calculateAmountWarnings(selectedRoute, '100', '0.05', 18)
      expect(result).toBeNull()
    })

    test('should return high price impact warning when price difference is = 5%', () => {
      // Input: $100, Output: $95 -> 5% difference (exactly at threshold)
      const selectedRoute = createMockRoute({
        inputValueInUsd: 100,
        outputValueInUsd: 95,
        fromAmount: 0.05,
        minAmountOut: 95
      })
      const result = calculateAmountWarnings(selectedRoute, '100', '0.05', 18)

      expect(result).not.toBeNull()
      expect(result?.type).toBe('highPriceImpact')
      expect(result).toHaveProperty('percentageDiff')
      if (result?.type === 'highPriceImpact') {
        expect(result.percentageDiff).toBe(5)
      }
    })

    test('should return high price impact warning when price difference is > 5%', () => {
      const selectedRoute = createMockRoute({
        inputValueInUsd: 1000,
        outputValueInUsd: 900,
        fromAmount: 0.5,
        minAmountOut: 900
      })
      const result = calculateAmountWarnings(selectedRoute, '1000', '0.5', 18)

      expect(result).not.toBeNull()
      expect(result?.type).toBe('highPriceImpact')
      if (result?.type === 'highPriceImpact') {
        expect(result.percentageDiff).toBe(10)
      }
    })

    test('should return null when price difference is < 5%', () => {
      const selectedRoute = createMockRoute({
        inputValueInUsd: 100,
        outputValueInUsd: 96,
        fromAmount: 0.05,
        minAmountOut: 95
      })
      const result = calculateAmountWarnings(selectedRoute, '100', '0.05', 18)

      expect(result).toBeNull()
    })

    test('should return slippage impact warning for swap < 400 USD with high slippage', () => {
      const selectedRoute = createMockRoute({
        inputValueInUsd: 200,
        outputValueInUsd: 198,
        fromAmount: 0.1,
        minAmountOut: 140
      })
      const result = calculateAmountWarnings(selectedRoute, '200', '0.1', 18)

      expect(result).not.toBeNull()
      expect(result?.type).toBe('slippageImpact')
      if (result?.type !== 'slippageImpact') return

      expect(result.possibleSlippage).toBeGreaterThan(1.05)
      expect(result.minInUsd).toBe(140)
    })

    test('should return slippage impact warning for swap > 400 USD with high slippage', () => {
      // Input: $20000, Output: $19800
      const selectedRoute = createMockRoute({
        inputValueInUsd: 20000,
        outputValueInUsd: 19800,
        fromAmount: 10,
        minAmountOut: 10000
      })
      const result = calculateAmountWarnings(selectedRoute, '20000', '10', 18)

      expect(result).not.toBeNull()
      expect(result?.type).toBe('slippageImpact')
      if (result?.type === 'slippageImpact') {
        expect(result.possibleSlippage).toBeGreaterThan(0.51)
        expect(result.minInUsd).toBe(10000)
        expect(result.symbol).toBe('USDC')
      }
    })

    test('edge case: should return slippage impact warning even if outputValueInUsd > inputValueInUsd when minAmountOut is very low', () => {
      const selectedRoute = createMockRoute({
        inputValueInUsd: 100,
        outputValueInUsd: 110,
        fromAmount: 0.05,
        minAmountOut: 20
      })
      const result = calculateAmountWarnings(selectedRoute, '100', '0.05', 18)

      expect(result).not.toBeNull()
      expect(result?.type).toBe('slippageImpact')
      if (result?.type === 'slippageImpact') {
        expect(result.possibleSlippage).toBeGreaterThan(81.8)
        expect(result.minInUsd).toBe(20)
      }
    })

    test('should not return slippage warning when difference between quote and min amount is <= $50', () => {
      // Input: $200, Output: $195
      // minAmountOut: $150 -> difference = $45 (< $50 threshold)
      const selectedRoute = createMockRoute({
        inputValueInUsd: 200,
        outputValueInUsd: 195,
        fromAmount: 0.1,
        minAmountOut: 150
      })
      const result = calculateAmountWarnings(selectedRoute, '200', '0.1', 18)

      expect(result).toBeNull()
    })

    test('should calculate slippage correctly for very large swaps', () => {
      // Input: $100000, Output: $99500
      const selectedRoute = createMockRoute({
        inputValueInUsd: 100000,
        outputValueInUsd: 99500,
        fromAmount: 50,
        minAmountOut: 50000
      })
      const result = calculateAmountWarnings(selectedRoute, '100000', '50', 18)

      expect(result).not.toBeNull()
      expect(result?.type).toBe('slippageImpact')
      if (result?.type === 'slippageImpact') {
        expect(result.possibleSlippage).toBeGreaterThan(0.11)
        expect(result.minInUsd).toBe(50000)
      }
    })

    test('should handle edge case with minimal amounts', () => {
      // Very small swap: $10, Output: $9.50 -> 5% difference
      const selectedRoute = createMockRoute({
        inputValueInUsd: 10,
        outputValueInUsd: 9.5,
        fromAmount: 0.005,
        minAmountOut: 9.5
      })
      const result = calculateAmountWarnings(selectedRoute, '10', '0.005', 18)

      expect(result).not.toBeNull()
      expect(result?.type).toBe('highPriceImpact')
      if (result?.type === 'highPriceImpact') {
        expect(result.percentageDiff).toBe(5)
      }
    })

    test('should catch errors gracefully and return null', () => {
      // Create a route where price impact is < 5% so it reaches the slippage check
      // But userTxs is empty, which will cause an error when accessing userTxs[length - 1]
      const malformedRoute = createMockRoute({
        inputValueInUsd: 100,
        outputValueInUsd: 97,
        fromAmount: 0.05,
        minAmountOut: 0.95
      })
      if (malformedRoute) {
        malformedRoute.userTxs = [] // Empty userTxs array will cause error in slippage calculation
      }

      const result = calculateAmountWarnings(malformedRoute, '100', '0.05', 18)
      // The function catches errors and returns null
      expect(result).toBeNull()
    })
  })
})
