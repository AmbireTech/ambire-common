import { describe, expect, test } from '@jest/globals'

import { BROADCAST_OPTIONS } from '../broadcast/broadcast'
import { calculateFeeAmount, increaseFee } from './fees'

const nativeRatio = 2000n * 10n ** 18n
const mainnet = { chainId: 1n }
const arbitrum = { chainId: 42161n }

describe('fees', () => {
  test('increaseFee adds non-safe account overhead', () => {
    expect(increaseFee(100n, false, mainnet)).toBe(110n)
  })

  test('increaseFee adds safe account mainnet overhead', () => {
    expect(increaseFee(100n, true, mainnet)).toBe(125n)
  })

  test('increaseFee adds safe account non-mainnet overhead', () => {
    expect(increaseFee(100n, true, arbitrum)).toBe(150n)
  })

  test('calculateFeeAmount returns native amount for bySelf', () => {
    expect(
      calculateFeeAmount({
        broadcastOption: BROADCAST_OPTIONS.bySelf,
        simulatedGasLimit: 21000n,
        gasPrice: 100n,
        nativeRatio,
        feeTokenDecimals: 18,
        addedNative: 50n,
        isAccountSafe: false,
        network: mainnet
      })
    ).toBe(2100050n)
  })

  test('calculateFeeAmount returns native amount for bySelf7702', () => {
    expect(
      calculateFeeAmount({
        broadcastOption: BROADCAST_OPTIONS.bySelf7702,
        simulatedGasLimit: 30000n,
        gasPrice: 100n,
        nativeRatio,
        feeTokenDecimals: 18,
        addedNative: 75n,
        isAccountSafe: false,
        network: mainnet
      })
    ).toBe(3000075n)
  })

  test('calculateFeeAmount returns native amount for byOtherEOA', () => {
    expect(
      calculateFeeAmount({
        broadcastOption: BROADCAST_OPTIONS.byOtherEOA,
        simulatedGasLimit: 40000n,
        gasPrice: 100n,
        nativeRatio,
        feeTokenDecimals: 18,
        addedNative: 125n,
        isAccountSafe: false,
        network: mainnet
      })
    ).toBe(4000125n)
  })

  test('calculateFeeAmount converts bundler amount without overhead when no paymaster is used', () => {
    expect(
      calculateFeeAmount({
        broadcastOption: BROADCAST_OPTIONS.byBundler,
        simulatedGasLimit: 200000n,
        gasPrice: 1000000000n,
        nativeRatio,
        feeTokenDecimals: 6,
        addedNative: 0n,
        isAccountSafe: false,
        network: mainnet
      })
    ).toBe(400000n)
  })

  test('calculateFeeAmount converts bundler amount and adds paymaster overhead', () => {
    expect(
      calculateFeeAmount({
        broadcastOption: BROADCAST_OPTIONS.byBundler,
        simulatedGasLimit: 200000n,
        gasPrice: 1000000000n,
        nativeRatio,
        feeTokenDecimals: 6,
        addedNative: 0n,
        usesPaymaster: true,
        isAccountSafe: false,
        network: mainnet
      })
    ).toBe(440000n)
  })

  test('calculateFeeAmount converts safe bundler amount and adds mainnet paymaster overhead', () => {
    expect(
      calculateFeeAmount({
        broadcastOption: BROADCAST_OPTIONS.byBundler,
        simulatedGasLimit: 200000n,
        gasPrice: 1000000000n,
        nativeRatio,
        feeTokenDecimals: 6,
        addedNative: 0n,
        usesPaymaster: true,
        isAccountSafe: true,
        network: mainnet
      })
    ).toBe(500000n)
  })

  test('calculateFeeAmount converts safe bundler amount and adds non-mainnet paymaster overhead', () => {
    expect(
      calculateFeeAmount({
        broadcastOption: BROADCAST_OPTIONS.byBundler,
        simulatedGasLimit: 200000n,
        gasPrice: 1000000000n,
        nativeRatio,
        feeTokenDecimals: 6,
        addedNative: 0n,
        usesPaymaster: true,
        isAccountSafe: true,
        network: arbitrum
      })
    ).toBe(600000n)
  })

  test('calculateFeeAmount converts relayer amount without overhead', () => {
    expect(
      calculateFeeAmount({
        broadcastOption: BROADCAST_OPTIONS.byRelayer,
        simulatedGasLimit: 200000n,
        gasPrice: 1000000000n,
        nativeRatio,
        feeTokenDecimals: 6,
        addedNative: 0n,
        isAccountSafe: false,
        network: mainnet
      })
    ).toBe(400000n)
  })

  test('calculateFeeAmount treats delegation as a non-bundler fee-token broadcast', () => {
    expect(
      calculateFeeAmount({
        broadcastOption: BROADCAST_OPTIONS.delegation,
        simulatedGasLimit: 200000n,
        gasPrice: 1000000000n,
        nativeRatio,
        feeTokenDecimals: 6,
        addedNative: 0n,
        isAccountSafe: false,
        network: mainnet
      })
    ).toBe(400000n)
  })

  test('calculateFeeAmount returns minimum fee token unit for tiny converted fees', () => {
    expect(
      calculateFeeAmount({
        broadcastOption: BROADCAST_OPTIONS.byBundler,
        simulatedGasLimit: 1n,
        gasPrice: 1n,
        nativeRatio: 1n,
        feeTokenDecimals: 6,
        addedNative: 0n,
        isAccountSafe: false,
        network: mainnet
      })
    ).toBe(1n)
  })
})
