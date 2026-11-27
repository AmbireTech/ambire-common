import { describe, expect, it } from '@jest/globals'

import { formatLimitOrderAmount } from './formatAmount'

describe('formatLimitOrderAmount', () => {
  it('keeps four significant digits below 1, so close amounts can be told apart', () => {
    // The minimum and the received amount of the same order
    expect(formatLimitOrderAmount('0.000081530123')).toBe('0.00008153')
    expect(formatLimitOrderAmount('0.000081595')).toBe('0.00008159')
    expect(formatLimitOrderAmount('0.00000006')).toBe('0.00000006')
    expect(formatLimitOrderAmount('0.119165')).toBe('0.1191')
  })

  it('keeps four decimals from 1 and two from 100', () => {
    expect(formatLimitOrderAmount('23.10185')).toBe('23.1018')
    expect(formatLimitOrderAmount('115.050474437651047134')).toBe('115.05')
  })

  it('cuts the extra digits instead of rounding up', () => {
    expect(formatLimitOrderAmount('0.000081599')).toBe('0.00008159')
    expect(formatLimitOrderAmount('114.999')).toBe('114.99')
  })

  it('drops trailing zeros and groups thousands', () => {
    expect(formatLimitOrderAmount('5.0')).toBe('5')
    expect(formatLimitOrderAmount('5')).toBe('5')
    expect(formatLimitOrderAmount('100.10')).toBe('100.1')
    expect(formatLimitOrderAmount('1234567.891')).toBe('1,234,567.89')
  })

  it('shows zero as 0', () => {
    expect(formatLimitOrderAmount('0.0')).toBe('0')
    expect(formatLimitOrderAmount('0')).toBe('0')
  })
})
