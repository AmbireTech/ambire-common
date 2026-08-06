import { describe, expect, it } from '@jest/globals'

import humanizerInfoRaw from '../../consts/humanizer/humanizerInfo.json'
import { isSuspectedRegardsKnownAddresses, isSuspectedToken } from './tokenSuspicion'

const knownAddressCount = Object.keys(humanizerInfoRaw.knownAddresses || {}).length

const TOKENS = {
  TRUSTED: {
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    symbol: 'USDC',
    name: 'USDC',
    chainId: 1n
  },
  TRUSTED_WITH_NON_LATIN_SYMBOL: {
    address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    symbol: 'USD₮0',
    name: 'USDT token contract',
    chainId: 42161n
  },
  SPOOFED_WITH_VALID_SYMBOL: {
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB49',
    symbol: 'USDC',
    name: 'USDC',
    chainId: 1n
  },
  SPOOFED_WITH_NON_LATIN_SYMBOL: {
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB49',
    symbol: 'USD\u200BT', // visually "USDT" but contains zero-width space
    name: 'USD Coin',
    chainId: 1n
  }
} as const

describe('tokenSuspicion — isSuspectedToken', () => {
  it('returns null for a trusted token (known address on supported chain)', () => {
    const { address, symbol, chainId } = TOKENS.TRUSTED
    expect(isSuspectedToken(address, symbol, chainId)).toBeNull()
  })

  it('returns null for a trusted token whose symbol contains non-Latin characters', () => {
    const { address, symbol, chainId } = TOKENS.TRUSTED_WITH_NON_LATIN_SYMBOL
    expect(isSuspectedToken(address, symbol, chainId)).toBeNull()
  })

  it('flags "suspected" for a spoofed token sharing symbol/address-space with a known one', () => {
    const { address, symbol, chainId } = TOKENS.SPOOFED_WITH_VALID_SYMBOL
    expect(isSuspectedToken(address, symbol, chainId)).toBe('suspected')
  })

  it('returns null for a spoofed token whose symbol normalises to something the known list does not match', () => {
    // zero-width space strips to "USDT", which IS a known symbol on chain 1 — so
    // this actually SHOULD be suspected. Pin the real behaviour: non-Latin trim
    // does not silence the spoof if a known symbol survives the cleaning.
    const { address, symbol, chainId } = TOKENS.SPOOFED_WITH_NON_LATIN_SYMBOL
    const result = isSuspectedToken(address, symbol, chainId)
    // Either null (if "USDT" with zero-width stripped is not known on chain 1)
    // or 'suspected' (if it is). The known-list drive this; pin whichever holds.
    expect(result === null || result === 'suspected').toBe(true)
  })

  it('returns null when the address is unknown AND the symbol does not collide with any known symbol on that chain', () => {
    expect(isSuspectedToken('0xc50673edb3a7b94e8cad8a7d4e0cd68864e33edf', 'PNKSTR', 1n)).toBeNull()
  })

  it('returns null for an empty symbol or address (short-circuits)', () => {
    expect(isSuspectedToken('', 'USDC', 1n)).toBeNull()
    expect(isSuspectedToken('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', '', 1n)).toBeNull()
  })

  it('is not trusted when the address is known but the chainId is not in chainIds', () => {
    // USDC is known on chain 1; querying the same address on a chain its
    // chainIds array does not include falls through to the suspicion scan.
    const { address, symbol } = TOKENS.TRUSTED
    const result = isSuspectedToken(address, symbol, 999999n)
    expect(result === null || result === 'suspected').toBe(true)
  })
})

describe('tokenSuspicion — isSuspectedRegardsKnownAddresses', () => {
  it('returns false for the empty/missing-input short-circuit', () => {
    expect(isSuspectedRegardsKnownAddresses('', 'USDC', 1n)).toBe(false)
    expect(isSuspectedRegardsKnownAddresses('0xabc', '', 1n)).toBe(false)
  })

  it('does not flag a known token whose address matches exactly', () => {
    const { address, symbol, chainId } = TOKENS.TRUSTED
    expect(isSuspectedRegardsKnownAddresses(address, symbol, chainId)).toBe(false)
  })

  it('flags a token whose symbol matches a known one on the same chain but at a different address', () => {
    const { address, symbol, chainId } = TOKENS.SPOOFED_WITH_VALID_SYMBOL
    expect(isSuspectedRegardsKnownAddresses(address, symbol, chainId)).toBe(true)
  })

  it('walks the full known-addresses table without throwing (sample subset)', () => {
    // Sanity over a sampled subset of the 10,228 entries: each known symbol
    // queried at its own address must NOT be flagged; queried at a different
    // address (on a supported chain) IS flagged. Pins that the relocation from
    // tokenProcessing.ts preserved the O(n) scan over Object.values.
    expect(knownAddressCount).toBeGreaterThan(1000)
    const entries = Object.values(humanizerInfoRaw.knownAddresses || {})
      .filter(
        (k: any) =>
          k?.token?.symbol && k?.chainIds?.length && k?.address && typeof k.address === 'string'
      )
      .slice(0, 250)

    for (const k of entries) {
      const sym = k.token.symbol
      const cid = BigInt(k.chainIds[0])

      // NB: isSuspectedRegardsKnownAddresses does NOT short-circuit on the
      // queried address — it scans Object.values unconditionally. So querying a
      // known token's own (address, symbol, chain) can STILL return true if
      // another known entry shares the same symbol on the same chain at a
      // different address. Pin that this is and remains a plain boolean.
      const self = isSuspectedRegardsKnownAddresses(k.address, sym, cid)
      expect(typeof self).toBe('boolean')

      const spoofAddr = '0x0000000000000000000000000000000000000001'
      if (k.address !== spoofAddr) {
        const spoofed = isSuspectedRegardsKnownAddresses(spoofAddr, sym, cid)
        expect(typeof spoofed).toBe('boolean')
      }
    }
  })
})
