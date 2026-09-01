import formatDecimals from '../formatDecimals/formatDecimals'
import { truncateFiatAmountDecimals } from './formatters'

describe('truncateFiatAmountDecimals', () => {
  it('keeps two decimals for amounts of a dollar or more', () => {
    // The exact value produced by converting 0.33 WETH at ~$2491 to fiat
    expect(truncateFiatAmountDecimals('822.17306780556431192506')).toBe('822.17')
    expect(truncateFiatAmountDecimals('1000.000000000000000000')).toBe('1000.00')
  })

  it('keeps as many decimals as the same amount is shown with as a label', () => {
    // `formatDecimals` counts the meaningful decimals from the first non-zero
    // one, so an amount whose cents start with a zero keeps a third decimal
    expect(truncateFiatAmountDecimals('822.017306780556431192506')).toBe('822.017')
    expect(formatDecimals(Number('822.017306780556431192506'), 'price')).toBe('$822.017')
    expect(
      formatDecimals(Number(truncateFiatAmountDecimals('1000.000000000000000000')), 'price')
    ).toBe('$1,000.00')
  })

  it('keeps two meaningful decimals for sub-cent amounts', () => {
    expect(truncateFiatAmountDecimals('0.00034567')).toBe('0.00034')
    // Two decimals counted from the first non-zero one, same as `formatDecimals`
    expect(truncateFiatAmountDecimals('0.09999999')).toBe('0.099')
    expect(truncateFiatAmountDecimals('0.0000000000012345678')).toBe('0.0000000000012')
  })

  it('never rounds up, so the result never exceeds the given amount', () => {
    const amounts = ['822.17999999999', '0.00999999', '5.999', '0.0000199999']

    amounts.forEach((amount) => {
      expect(Number(truncateFiatAmountDecimals(amount))).toBeLessThanOrEqual(Number(amount))
    })
  })

  it('returns amounts that are already short enough untouched', () => {
    expect(truncateFiatAmountDecimals('12.34')).toBe('12.34')
    expect(truncateFiatAmountDecimals('12.3')).toBe('12.3')
    expect(truncateFiatAmountDecimals('12')).toBe('12')
    expect(truncateFiatAmountDecimals('0.0001')).toBe('0.0001')
    expect(truncateFiatAmountDecimals('')).toBe('')
  })

  it('handles a zero amount with a long decimal tail', () => {
    expect(truncateFiatAmountDecimals('0.000000000000000000')).toBe('0.00')
    expect(truncateFiatAmountDecimals('0.0')).toBe('0.0')
    expect(truncateFiatAmountDecimals('0')).toBe('0')
  })
})
