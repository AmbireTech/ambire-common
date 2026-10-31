import { getAddress as getEthersAddress, ZeroAddress } from 'ethers'

import { describe, expect, it } from '@jest/globals'

import { COWSWAP_BUY_NATIVE_TOKEN_ADDRESS } from './constants'
import { normalizeBuyTokenAddress, normalizeCowSwapToken } from './helper'

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
})
