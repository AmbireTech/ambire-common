import { getAddress as getEthersAddress, ZeroAddress } from 'ethers'

import { describe, expect, it } from '@jest/globals'

import { COWSWAP_BUY_NATIVE_TOKEN_ADDRESS } from './constants'
import {
  getNetworkCostSlippageBps,
  getPriceSlippageBps,
  normalizeBuyTokenAddress,
  normalizeCowSwapToken,
  parseSmartSlippageBps
} from './helper'

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'

const tokenListEntry = (address: string) => ({
  address,
  chainId: 1,
  decimals: 6,
  name: 'USD Coin',
  symbol: 'USDC',
  logoURI: 'https://example.com/usdc.png'
})

describe('CoW Swap helpers', () => {
  describe('normalizeCowSwapToken', () => {
    it('checksums a lowercase address the same way ethers does', () => {
      const token = normalizeCowSwapToken(tokenListEntry(USDC.toLowerCase()))

      expect(token.address).toBe(USDC)
      expect(token.address).toBe(getEthersAddress(USDC.toLowerCase()))
    })

    it('keeps an already checksummed address', () => {
      expect(normalizeCowSwapToken(tokenListEntry(USDC)).address).toBe(USDC)
    })

    it('corrects an address whose checksum is wrong, where ethers would reject it', () => {
      // The bytes are the same address, so one badly cased entry must not fail the whole list
      const wrongChecksum = `0xa${USDC.slice(3)}`

      expect(() => getEthersAddress(wrongChecksum)).toThrow()
      expect(normalizeCowSwapToken(tokenListEntry(wrongChecksum)).address).toBe(USDC)
    })

    it('rejects something that is not an address', () => {
      expect(() => normalizeCowSwapToken(tokenListEntry('0x1234'))).toThrow()
    })
  })

  describe('normalizeBuyTokenAddress', () => {
    it('maps the zero address to the native buy token', () => {
      expect(normalizeBuyTokenAddress(ZeroAddress)).toBe(COWSWAP_BUY_NATIVE_TOKEN_ADDRESS)
    })

    it('checksums any other address', () => {
      expect(normalizeBuyTokenAddress(USDC.toLowerCase())).toBe(USDC)
    })
  })

  describe('parseSmartSlippageBps', () => {
    it('reads a positive whole slippage', () => {
      expect(parseSmartSlippageBps({ slippageBps: 45 })).toBe(45)
    })

    it.each([
      ['zero, which means no market data', { slippageBps: 0 }],
      ['a negative slippage', { slippageBps: -1 }],
      ['a fractional slippage', { slippageBps: 0.5 }],
      ['a slippage sent as text', { slippageBps: '45' }],
      ['an infinite slippage', { slippageBps: Infinity }],
      ['a slippage too big to be exact', { slippageBps: Number.MAX_SAFE_INTEGER + 1 }],
      ['a missing slippage', {}],
      ['null', null],
      ['a string', 'slippageBps']
    ])('ignores %s', (_, body) => {
      expect(parseSmartSlippageBps(body)).toBeNull()
    })
  })

  describe('getPriceSlippageBps', () => {
    it('uses the fixed slippage without a smart one', () => {
      expect(
        getPriceSlippageBps({ smartSlippageBps: null, fixedSlippageBps: 50, fromAmountInUsd: 10 })
      ).toBe(50)
    })

    it('never uses less than 1 bps, even when the fixed slippage rounds to 0', () => {
      expect(
        getPriceSlippageBps({ smartSlippageBps: null, fixedSlippageBps: 0, fromAmountInUsd: 5e6 })
      ).toBe(1)
      expect(
        getPriceSlippageBps({ smartSlippageBps: 45, fixedSlippageBps: 0, fromAmountInUsd: 5e6 })
      ).toBe(1)
    })

    it('uses the smart slippage of a small trade up to 1%', () => {
      expect(
        getPriceSlippageBps({ smartSlippageBps: 73, fixedSlippageBps: 50, fromAmountInUsd: 399 })
      ).toBe(73)
      expect(
        getPriceSlippageBps({ smartSlippageBps: 101, fixedSlippageBps: 50, fromAmountInUsd: 399 })
      ).toBe(100)
    })

    it('lets the smart slippage only lower the fixed one from $400 up', () => {
      expect(
        getPriceSlippageBps({ smartSlippageBps: 73, fixedSlippageBps: 50, fromAmountInUsd: 400 })
      ).toBe(50)
      expect(
        getPriceSlippageBps({ smartSlippageBps: 2, fixedSlippageBps: 10, fromAmountInUsd: 1e6 })
      ).toBe(2)
    })

    it.each([0, -1, NaN, Infinity])(
      'lets the smart slippage only lower the fixed one for a trade worth %s USD',
      (fromAmountInUsd) => {
        expect(
          getPriceSlippageBps({ smartSlippageBps: 73, fixedSlippageBps: 50, fromAmountInUsd })
        ).toBe(50)
        expect(
          getPriceSlippageBps({ smartSlippageBps: 20, fixedSlippageBps: 50, fromAmountInUsd })
        ).toBe(20)
      }
    )
  })

  describe('getNetworkCostSlippageBps', () => {
    it('leaves room for half of the network cost', () => {
      // half of a 2% network cost is 1% of the amount sold
      expect(
        getNetworkCostSlippageBps({ networkFee: 200n, sellAmountAfterNetworkCost: 10_000n })
      ).toBe(100)
    })

    it('rounds up, so that the room is never smaller than half of the network cost', () => {
      // half of a 0.01% network cost is 0.5 bps
      expect(
        getNetworkCostSlippageBps({ networkFee: 1n, sellAmountAfterNetworkCost: 10_000n })
      ).toBe(1)
      expect(
        getNetworkCostSlippageBps({ networkFee: 10_000n, sellAmountAfterNetworkCost: 990_000n })
      ).toBe(51)
    })

    it('needs no room without a network cost', () => {
      expect(getNetworkCostSlippageBps({ networkFee: 0n, sellAmountAfterNetworkCost: 1000n })).toBe(
        0
      )
    })

    it('needs no room for an invalid amount instead of dividing by zero', () => {
      expect(getNetworkCostSlippageBps({ networkFee: 10n, sellAmountAfterNetworkCost: 0n })).toBe(0)
      expect(
        getNetworkCostSlippageBps({ networkFee: -10n, sellAmountAfterNetworkCost: 100n })
      ).toBe(0)
    })
  })
})
