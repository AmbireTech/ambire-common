import { ZeroAddress } from 'ethers'

import { describe, expect, it } from '@jest/globals'

import gasTankFeeTokens from '../../consts/gasTankFeeTokens'
import { getFeeToken, getFlags, isSuspectedRegardsKnownAddresses } from './tokenProcessing'

const USDT_ETHEREUM = '0xdAC17F958D2ee523a2206206994597C13D831ec7'
const WETH_OPTIMISM = '0x4200000000000000000000000000000000000006'
const DUPLICATED_ON_AVALANCHE = '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'
const NOT_A_FEE_TOKEN = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
// The only entry in the known addresses carrying the symbol OP, and only on Optimism
const OP_OPTIMISM = '0x4200000000000000000000000000000000000042'
const SPOOFED_ADDRESS = '0x000000000000000000000000000000000000dEaD'

describe('getFeeToken', () => {
  it('returns the first of two entries sharing an address and a chain', () => {
    const duplicates = gasTankFeeTokens.filter(
      (t) =>
        t.address.toLowerCase() === DUPLICATED_ON_AVALANCHE.toLowerCase() && t.chainId === 43114n
    )

    expect(duplicates.length).toBeGreaterThan(1)
    expect(getFeeToken(DUPLICATED_ON_AVALANCHE, 43114n)).toBe(duplicates[0])
  })

  it('is case-insensitive on the given address', () => {
    const usdt = gasTankFeeTokens.find(
      (t) => t.address.toLowerCase() === USDT_ETHEREUM.toLowerCase() && t.chainId === 1n
    )

    expect(usdt).toBeDefined()
    expect(getFeeToken(USDT_ETHEREUM.toLowerCase(), 1n)).toBe(usdt)
    expect(getFeeToken(USDT_ETHEREUM.toUpperCase(), 1n)).toBe(usdt)
  })

  it('returns undefined for an address that is not a fee token', () => {
    expect(getFeeToken(NOT_A_FEE_TOKEN, 1n)).toBeUndefined()
    expect(getFeeToken(NOT_A_FEE_TOKEN, 1n)).toBeUndefined()
  })

  it('returns undefined when the address is a fee token but on another chain', () => {
    const wethOnOptimism = gasTankFeeTokens.find(
      (t) => t.address.toLowerCase() === WETH_OPTIMISM.toLowerCase() && t.chainId === 10n
    )

    expect(wethOnOptimism).toBeDefined()
    expect(getFeeToken(WETH_OPTIMISM, 1n)).toBeUndefined()
    expect(getFeeToken(WETH_OPTIMISM, 1n)).toBeUndefined()
  })

  it('reuses the index across calls instead of rebuilding it', () => {
    expect(getFeeToken(USDT_ETHEREUM, 1n)).toBe(getFeeToken(USDT_ETHEREUM, 1n))
  })
})

describe('isSuspectedRegardsKnownAddresses', () => {
  it('does not suspect the known token itself, whichever case its address is given in', () => {
    expect(isSuspectedRegardsKnownAddresses(OP_OPTIMISM, 'OP', 10n)).toBe(false)
    expect(isSuspectedRegardsKnownAddresses(OP_OPTIMISM.toLowerCase(), 'OP', 10n)).toBe(false)
  })

  it('suspects another address holding a known symbol on the same chain', () => {
    expect(isSuspectedRegardsKnownAddresses(SPOOFED_ADDRESS, 'OP', 10n)).toBe(true)
  })

  it('does not suspect a known symbol on a chain the known token is not on', () => {
    expect(isSuspectedRegardsKnownAddresses(SPOOFED_ADDRESS, 'OP', 1n)).toBe(false)
  })

  it('does not suspect a symbol no known token carries', () => {
    expect(isSuspectedRegardsKnownAddresses(SPOOFED_ADDRESS, 'NOTASYMBOL', 10n)).toBe(false)
  })

  it('sees through characters that are dropped from a symbol', () => {
    expect(isSuspectedRegardsKnownAddresses(SPOOFED_ADDRESS, 'O\u200bP', 10n)).toBe(true)
    expect(isSuspectedRegardsKnownAddresses(SPOOFED_ADDRESS, 'oр', 10n)).toBe(false)
  })

  it('needs both an address and a symbol to suspect anything', () => {
    expect(isSuspectedRegardsKnownAddresses('', 'OP', 10n)).toBe(false)
    expect(isSuspectedRegardsKnownAddresses(SPOOFED_ADDRESS, '', 10n)).toBe(false)
  })

  it('answers the same on every call, so the index it builds is reused as it is', () => {
    expect(isSuspectedRegardsKnownAddresses(SPOOFED_ADDRESS, 'OP', 10n)).toBe(true)
    expect(isSuspectedRegardsKnownAddresses(OP_OPTIMISM, 'OP', 10n)).toBe(false)
    expect(isSuspectedRegardsKnownAddresses(SPOOFED_ADDRESS, 'OP', 10n)).toBe(true)
  })
})

describe('getFlags fee token flags', () => {
  it('marks a gas tank fee token as topped up and usable as a fee', () => {
    const usdt = gasTankFeeTokens.find(
      (t) => t.address.toLowerCase() === USDT_ETHEREUM.toLowerCase() && t.chainId === 1n
    )!

    expect(usdt.disableGasTankDeposit).toBeFalsy()
    expect(usdt.disableAsFeeToken).toBeFalsy()

    const flags = getFlags({}, '1', 1n, USDT_ETHEREUM, 'Tether USD', 'USDT')

    expect(flags.canTopUpGasTank).toBe(true)
    expect(flags.isFeeToken).toBe(true)
    expect(flags.onGasTank).toBe(false)
  })

  it('does not mark an unknown token as a fee token', () => {
    const flags = getFlags({}, '1', 1n, NOT_A_FEE_TOKEN, 'Random', 'RND')

    expect(flags.canTopUpGasTank).toBe(false)
    expect(flags.isFeeToken).toBeFalsy()
  })

  it('treats the native token as a fee token even without a gas tank entry', () => {
    const flags = getFlags({}, '31337', 31337n, ZeroAddress, 'Ether', 'ETH')

    expect(getFeeToken(ZeroAddress, 31337n)).toBeUndefined()
    expect(flags.isFeeToken).toBe(true)
    expect(flags.canTopUpGasTank).toBe(false)
  })

  it('resolves fee tokens on the gasTank pseudo chain by the token chain id', () => {
    const flags = getFlags({}, 'gasTank', 1n, USDT_ETHEREUM, 'Tether USD', 'USDT')

    expect(flags.onGasTank).toBe(true)
    expect(flags.canTopUpGasTank).toBe(true)
    expect(flags.isFeeToken).toBe(true)
  })
})
