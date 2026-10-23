import { MaxUint256, ZeroAddress } from 'ethers'

import { describe, expect, test } from '@jest/globals'

import {
  appendNativeValueRow,
  formatTimestampAsDate,
  getAction,
  getAddressVisualization,
  getFlatParts,
  getLegacyVisualization,
  getNativeValueWarning,
  getRichVisualization,
  getSingleValueRow,
  getToken,
  NATIVE_VALUE_WARNING_CODE,
  showNativeValueOfCall
} from './utils'

const TOKEN = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
const SPENDER = '0x46705dfff24256421a05d056c29e81bdc09723b8'
const NATIVE_VALUE = 10n ** 18n

const approveVisualization = getRichVisualization('Approve', [
  getSingleValueRow('Spender', getAddressVisualization(SPENDER)),
  getSingleValueRow('Amount', getToken(TOKEN, 5n, 1n))
])

describe('formatTimestampAsDate', () => {
  test('formats a timestamp in seconds as a date', () => {
    expect(formatTimestampAsDate(1900000000n)).toBe(new Date(1900000000 * 1000).toLocaleString())
  })

  test('treats the maximum value as no expiration', () => {
    expect(formatTimestampAsDate(MaxUint256)).toBe('No expiration')
  })

  test('treats a timestamp of only f digits as no expiration', () => {
    expect(formatTimestampAsDate(2n ** 48n - 1n)).toBe('No expiration')
  })

  test('does not treat a short run of f digits as no expiration', () => {
    expect(formatTimestampAsDate(0xfffffn)).toBe(new Date(0xfffff * 1000).toLocaleString())
  })

  test('returns null for a timestamp that is not a valid date', () => {
    expect(formatTimestampAsDate(10n ** 30n)).toBeNull()
  })
})

describe('getFlatParts', () => {
  test('returns the intent followed by every row with its label', () => {
    const parts = getFlatParts(approveVisualization)

    expect(parts).toMatchObject([
      { type: 'action', content: 'Approve' },
      { type: 'label', content: 'spender' },
      { type: 'address', address: SPENDER },
      { type: 'label', content: 'amount' },
      { type: 'token', address: TOKEN, value: 5n }
    ])
  })

  test('returns the parts of a nested call without a label of its own', () => {
    const parts = getFlatParts(
      getRichVisualization('Execute', [{ type: 'call', value: approveVisualization }])
    )

    expect(parts).toHaveLength(6)
    expect(parts[1]).toMatchObject({ type: 'action', content: 'Approve' })
  })

  test('returns just the intent of a visualization with no rows', () => {
    const intent = [getAction('Send')]

    expect(getFlatParts(getLegacyVisualization(intent))).toEqual(intent)
  })
})

describe('appendNativeValueRow', () => {
  test('adds a Send row with the native value', () => {
    const { fullVisualization, didAppendNativeValueRow } = appendNativeValueRow(
      approveVisualization,
      NATIVE_VALUE,
      1n
    )

    expect(didAppendNativeValueRow).toBe(true)
    expect(fullVisualization.fields).toHaveLength(3)
    expect(fullVisualization.fields[2]).toMatchObject({
      type: 'single-value',
      label: 'Send',
      value: { type: 'token', address: ZeroAddress, value: NATIVE_VALUE, chainId: 1n }
    })
  })

  test('does not change the visualization it was given', () => {
    appendNativeValueRow(approveVisualization, NATIVE_VALUE, 1n)

    expect(approveVisualization.fields).toHaveLength(2)
  })

  test('adds nothing when no native value is sent', () => {
    const { fullVisualization, didAppendNativeValueRow } = appendNativeValueRow(
      approveVisualization,
      0n,
      1n
    )

    expect(didAppendNativeValueRow).toBe(false)
    expect(fullVisualization).toBe(approveVisualization)
  })

  test('adds nothing when the visualization already shows that native value', () => {
    const showsValue = getLegacyVisualization([
      getAction('Wrap'),
      getToken(ZeroAddress, NATIVE_VALUE)
    ])

    const { fullVisualization, didAppendNativeValueRow } = appendNativeValueRow(
      showsValue,
      NATIVE_VALUE,
      1n
    )

    expect(didAppendNativeValueRow).toBe(false)
    expect(fullVisualization).toBe(showsValue)
  })

  test('adds a row when the visualization shows another native amount', () => {
    const showsOtherValue = getLegacyVisualization([
      getAction('Wrap'),
      getToken(ZeroAddress, NATIVE_VALUE + 1n)
    ])

    expect(appendNativeValueRow(showsOtherValue, NATIVE_VALUE, 1n).didAppendNativeValueRow).toBe(
      true
    )
  })
})

describe('native value warning', () => {
  test('names the coin when it is known', () => {
    expect(getNativeValueWarning('ETH')).toMatchObject({
      content: 'This transaction will send ETH',
      code: NATIVE_VALUE_WARNING_CODE
    })
  })

  test('names the coin in a general way when it is not known', () => {
    expect(getNativeValueWarning().content).not.toContain('undefined')
    expect(getNativeValueWarning().code).toBe(NATIVE_VALUE_WARNING_CODE)
  })

  test('is returned with the row only when the row was added', () => {
    expect(showNativeValueOfCall(approveVisualization, NATIVE_VALUE, 1n).warnings).toEqual([
      getNativeValueWarning()
    ])
    expect(showNativeValueOfCall(approveVisualization, 0n, 1n).warnings).toEqual([])
  })
})
