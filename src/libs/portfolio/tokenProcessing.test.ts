import { ZeroAddress } from 'ethers'

import { describe, expect, it } from '@jest/globals'

import gasTankFeeTokens from '../../consts/gasTankFeeTokens'
import { getFeeToken, getFlags } from './tokenProcessing'

const USDT_ETHEREUM = '0xdAC17F958D2ee523a2206206994597C13D831ec7'
const WETH_OPTIMISM = '0x4200000000000000000000000000000000000006'
const DUPLICATED_ON_AVALANCHE = '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'
const NOT_A_FEE_TOKEN = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'

describe('getFeeToken', () => {
  it('returns the first of two entries sharing an address and a chain', () => {
    const duplicates = gasTankFeeTokens.filter(
      (t) =>
        t.address.toLowerCase() === DUPLICATED_ON_AVALANCHE.toLowerCase() && t.chainId === 43114n
    )

    expect(duplicates.length).toBeGreaterThan(1)
    expect(getFeeToken(DUPLICATED_ON_AVALANCHE, '43114', 43114n)).toBe(duplicates[0])
  })

  it('is case-insensitive on the given address', () => {
    const usdt = gasTankFeeTokens.find(
      (t) => t.address.toLowerCase() === USDT_ETHEREUM.toLowerCase() && t.chainId === 1n
    )

    expect(usdt).toBeDefined()
    expect(getFeeToken(USDT_ETHEREUM.toLowerCase(), '1', 1n)).toBe(usdt)
    expect(getFeeToken(USDT_ETHEREUM.toUpperCase(), '1', 1n)).toBe(usdt)
  })

  it('finds the native token by the zero address on both branches', () => {
    const nativeOnEthereum = gasTankFeeTokens.find(
      (t) => t.address === ZeroAddress && t.chainId === 1n
    )

    expect(nativeOnEthereum).toBeDefined()
    expect(getFeeToken(ZeroAddress, '1', 1n)).toBe(nativeOnEthereum)
    expect(getFeeToken(ZeroAddress, 'gasTank', 1n)).toBe(nativeOnEthereum)
  })

  it('returns undefined for an address that is not a fee token', () => {
    expect(getFeeToken(NOT_A_FEE_TOKEN, '1', 1n)).toBeUndefined()
    expect(getFeeToken(NOT_A_FEE_TOKEN, 'gasTank', 1n)).toBeUndefined()
  })

  it('returns undefined when the address is a fee token but on another chain', () => {
    const wethOnOptimism = gasTankFeeTokens.find(
      (t) => t.address.toLowerCase() === WETH_OPTIMISM.toLowerCase() && t.chainId === 10n
    )

    expect(wethOnOptimism).toBeDefined()
    expect(getFeeToken(WETH_OPTIMISM, '1', 1n)).toBeUndefined()
    expect(getFeeToken(WETH_OPTIMISM, 'gasTank', 1n)).toBeUndefined()
  })

  it('reuses the index across calls instead of rebuilding it', () => {
    expect(getFeeToken(USDT_ETHEREUM, '1', 1n)).toBe(getFeeToken(USDT_ETHEREUM, '1', 1n))
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

    expect(getFeeToken(ZeroAddress, '31337', 31337n)).toBeUndefined()
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
