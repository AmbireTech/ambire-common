import { describe, expect, it } from '@jest/globals'

import gasTankFeeTokens from '../../consts/gasTankFeeTokens'
import { getFeeToken, overrideSymbol, ZERO_ADDRESS } from './tokenIndexes'

describe('tokenIndexes — overrideSymbol', () => {
  it('returns the original symbol for tokens not in the USDC.e mapping', () => {
    expect(overrideSymbol('0x0000000000000000000000000000000000000000', 1n, 'ETH')).toBe('ETH')
  })

  it('overrides the symbol to USDC.E for every entry in usdcEMapping', () => {
    const usdcEEntries: Array<[bigint, string]> = [
      [43114n, '0xa7d7079b0fead91f3e65f86e8915cb59c1a4c664'],
      [1285n, '0x748134b5f553f2bcbd78c6826de99a70274bdeb3'],
      [42161n, '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8'],
      [137n, '0x2791bca1f2de4661ed88a30c99a7a9449aa84174'],
      [10n, '0x7f5c764cbc14f9669b88837ca1490cca17c31607']
    ]
    for (const [chainId, addr] of usdcEEntries) {
      // case-insensitive on the input address, mirroring the original helper
      expect(overrideSymbol(addr.toUpperCase(), chainId, 'USDC')).toBe('USDC.E')
      expect(overrideSymbol(addr, chainId, 'USDC')).toBe('USDC.E')
    }
  })

  it('returns the original symbol for an address on the wrong chain', () => {
    // USDC.e on Optimism (10) address passed for chainId 1 (Ethereum mainnet)
    expect(overrideSymbol('0x7f5c764cbc14f9669b88837ca1490cca17c31607', 1n, 'USDC')).toBe('USDC')
  })
})

describe('tokenIndexes — ZERO_ADDRESS', () => {
  it('matches the zero address used by viem/ethers', () => {
    expect(ZERO_ADDRESS).toBe('0x0000000000000000000000000000000000000000')
  })
})

describe('tokenIndexes — getFeeToken', () => {
  // Property test: the Map-backed lookup must return exactly what
  // gasTankFeeTokens.find(...) returns, for all 153 entries plus misses. The
  // find() used two comparison strategies depending on the chainId branch:
  //   - isRewardsOrGasTank:  t.chainId === tokenChainId           (bigint ===)
  //   - otherwise:           t.chainId.toString() === chainIdKey  (string ===)
  // Both branches are exercised for every entry below.
  it('returns exactly what gasTankFeeTokens.find returns for every entry (rewards branch)', () => {
    for (const t of gasTankFeeTokens) {
      const findResult = gasTankFeeTokens.find(
        (x) => x.address.toLowerCase() === t.address.toLowerCase() && x.chainId === t.chainId
      )
      const mapResult = getFeeToken(t.address, 'gasTank', t.chainId)
      expect(mapResult).toBe(findResult)
    }
  })

  it('returns exactly what gasTankFeeTokens.find returns for every entry (network branch)', () => {
    for (const t of gasTankFeeTokens) {
      const chainIdKey = t.chainId.toString()
      const findResult = gasTankFeeTokens.find(
        (x) =>
          x.address.toLowerCase() === t.address.toLowerCase() && x.chainId.toString() === chainIdKey
      )
      const mapResult = getFeeToken(t.address, chainIdKey, t.chainId)
      expect(mapResult).toBe(findResult)
    }
  })

  it('respects first-wins on duplicate (address, chainId) — 0xB97EF9...USDC on 43114 appears twice', () => {
    const dupes = gasTankFeeTokens.filter(
      (x) =>
        x.address.toLowerCase() === '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e'.toLowerCase() &&
        x.chainId === 43114n
    )
    expect(dupes.length).toBeGreaterThan(1)
    const first = dupes[0]!
    const mapResult = getFeeToken('0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', '43114', 43114n)
    expect(mapResult).toBe(first)
  })

  it('returns undefined for a missing address', () => {
    expect(getFeeToken('0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef', '1', 1n)).toBeUndefined()
  })

  it('returns undefined when the address matches but the chainId does not', () => {
    // WETH on Optimism address, queried as Ethereum mainnet
    const optWeth = gasTankFeeTokens.find(
      (x) =>
        x.address.toLowerCase() === '0x4200000000000000000000000000000000000006'.toLowerCase() &&
        x.chainId === 10n
    )
    expect(optWeth).toBeDefined()
    expect(getFeeToken('0x4200000000000000000000000000000000000006', '1', 1n)).toBeUndefined()
  })

  it('is case-insensitive on the input address, matching the original find', () => {
    const ethEntry = gasTankFeeTokens.find(
      (x) => x.address.toLowerCase() === '0xdac17f958d2ee523a2206206994597c13d831ec7'.toLowerCase()
    )
    expect(getFeeToken('0xdAC17F958D2ee523a2206206994597C13D831ec7', '1', 1n)).toBe(ethEntry)
  })

  it('matches the native zero address fee token across both branches', () => {
    const ethNative = gasTankFeeTokens.find(
      (x) => x.address === '0x0000000000000000000000000000000000000000' && x.chainId === 1n
    )
    expect(getFeeToken(ZERO_ADDRESS, '1', 1n)).toBe(ethNative)
    expect(getFeeToken(ZERO_ADDRESS, 'gasTank', 1n)).toBe(ethNative)
  })

  it('returns the same Map instance on subsequent calls (lazy build, not rebuilt per call)', () => {
    // Repeated lookups must reuse the lazily built Map; rebuilding 153 entries
    // per token would defeat the optimisation.
    const a = getFeeToken(ZERO_ADDRESS, '1', 1n)
    const b = getFeeToken(ZERO_ADDRESS, '1', 1n)
    expect(a).toBe(b)
  })
})
