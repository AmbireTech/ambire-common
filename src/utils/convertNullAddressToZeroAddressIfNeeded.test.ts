import { describe, expect, test } from '@jest/globals'

import convertNullAddressToZeroAddressIfNeeded from './convertNullAddressToZeroAddressIfNeeded'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'

describe('convertNullAddressToZeroAddressIfNeeded', () => {
  test('converts the checksummed null address to the zero address', () => {
    expect(
      convertNullAddressToZeroAddressIfNeeded('0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE')
    ).toBe(ZERO_ADDRESS)
  })

  test('converts the lowercased null address to the zero address', () => {
    expect(
      convertNullAddressToZeroAddressIfNeeded('0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee')
    ).toBe(ZERO_ADDRESS)
  })

  test('keeps the zero address', () => {
    expect(convertNullAddressToZeroAddressIfNeeded(ZERO_ADDRESS)).toBe(ZERO_ADDRESS)
  })

  test('returns other addresses unchanged, keeping their case', () => {
    expect(convertNullAddressToZeroAddressIfNeeded(USDC)).toBe(USDC)
    expect(convertNullAddressToZeroAddressIfNeeded(USDC.toLowerCase())).toBe(USDC.toLowerCase())
  })

  test('does not throw on a malformed address', () => {
    expect(convertNullAddressToZeroAddressIfNeeded('not-an-address')).toBe('not-an-address')
  })
})
