import { describe, expect, test } from '@jest/globals'

import { ZeroAddress } from 'ethers'

import { buildSafeTxGasRefund } from './safeTxGasRefund'

describe('buildSafeTxGasRefund', () => {
  test('builds a refund with a fixed receiver and token', () => {
    expect(
      buildSafeTxGasRefund(
        '2',
        '3',
        '0x8888888888888888888888888888888888888888',
        '0x9999999999999999999999999999999999999999'
      )
    ).toEqual({
      refundReceiver: '0x9999999999999999999999999999999999999999',
      gasToken: '0x8888888888888888888888888888888888888888',
      minAmount: 6n
    })
  })

  test('keeps a zero receiver as the broadcaster and defaults an invalid token to the native token', () => {
    expect(buildSafeTxGasRefund(1n, 1n, 'invalid', ZeroAddress)).toEqual({
      refundReceiver: undefined,
      gasToken: ZeroAddress,
      minAmount: 1n
    })
  })

  test('does not build a refund when gasPrice is zero', () => {
    expect(buildSafeTxGasRefund(1n, 0n, ZeroAddress, ZeroAddress)).toBeNull()
  })

  test('does not build a refund from invalid numeric values', () => {
    expect(buildSafeTxGasRefund('invalid', 1n, ZeroAddress, ZeroAddress)).toBeNull()
    expect(buildSafeTxGasRefund(1n, 'invalid', ZeroAddress, ZeroAddress)).toBeNull()
  })
})
