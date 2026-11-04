import formatDecimals from './formatDecimals'

type TestCases = {
  value: number | undefined
  type: 'value' | 'price' | 'amount' | 'default' | 'precise'
  expected: string
}[]

const TEST_CASES: TestCases = [
  { value: 10001.1234, type: 'value', expected: '$10,001' },
  { value: 1234.5678, type: 'value', expected: '$1,234.56' },
  { value: 1234.5678, type: 'price', expected: '$1,234.56' },
  { value: 1234.5678, type: 'amount', expected: '1,234.56' },
  { value: 1234.5678, type: 'default', expected: '1,234.56' },
  { value: 1234.5678901234, type: 'precise', expected: '1,234.56789012' },
  { value: 1234.5678901274, type: 'precise', expected: '1,234.56789012' },
  { value: 1234, type: 'value', expected: '$1,234.00' },
  { value: 1234, type: 'price', expected: '$1,234.00' },
  { value: 1234, type: 'amount', expected: '1,234' },
  { value: 1234, type: 'default', expected: '1,234' },
  { value: 1234, type: 'precise', expected: '1,234' },
  { value: -1234.5678, type: 'value', expected: '-$1,234.56' },
  { value: -1234.5678, type: 'price', expected: '-$1,234.56' },
  { value: -1234.5678, type: 'amount', expected: '-1,234.56' },
  { value: -1234.5678, type: 'default', expected: '-1,234.56' },
  { value: -1234.5678901234, type: 'precise', expected: '-1,234.56789012' },
  { value: -1234.5678901274, type: 'precise', expected: '-1,234.56789012' },
  { value: -1234, type: 'value', expected: '-$1,234.00' },
  { value: -1234, type: 'price', expected: '-$1,234.00' },
  { value: -1234, type: 'amount', expected: '-1,234' },
  { value: -1234, type: 'default', expected: '-1,234' },
  { value: -1234, type: 'precise', expected: '-1,234' },
  { value: 0, type: 'value', expected: '$0.00' },
  { value: 0, type: 'price', expected: '$0.00' },
  { value: 0, type: 'amount', expected: '0' },
  { value: 0, type: 'default', expected: '0.00' },
  { value: 0, type: 'precise', expected: '0.00' },
  { value: undefined, type: 'value', expected: '$-' },
  { value: undefined, type: 'price', expected: '$-' },
  { value: undefined, type: 'amount', expected: '-' },
  { value: undefined, type: 'default', expected: '-' },
  { value: undefined, type: 'precise', expected: '-' },
  { value: NaN, type: 'value', expected: '$-' },
  { value: NaN, type: 'price', expected: '$-' },
  { value: NaN, type: 'amount', expected: '-' },
  { value: NaN, type: 'default', expected: '-' },
  { value: NaN, type: 'precise', expected: '-' }
]

const SPECIAL_TEST_CASES: TestCases = [
  {
    value: 0.001,
    type: 'value',
    expected: '<$0.01'
  },
  {
    value: -0.001,
    type: 'value',
    expected: '-<$0.01'
  },
  {
    value: 0.000000001,
    type: 'amount',
    expected: '<0.00001'
  },
  {
    value: -0.000000001,
    type: 'amount',
    expected: '-<0.00001'
  }
]

// Cut, never rounded up: a balance shown rounded up is more than the user can spend. Done by hand
// because Hermes ignores Intl's `roundingMode: 'trunc'`, so these run on Node too.
const TRUNCATION_TEST_CASES: TestCases = [
  { value: 0.7957, type: 'amount', expected: '0.79' },
  { value: -0.7957, type: 'amount', expected: '-0.79' },
  { value: 0.999, type: 'amount', expected: '0.99' },
  { value: 0.7957, type: 'price', expected: '$0.79' },
  { value: 0.999, type: 'value', expected: '$0.99' },
  { value: 10009.99, type: 'value', expected: '$10,009' },
  { value: 999999.999, type: 'amount', expected: '999,999.99' },
  // Float noise: 0.29 is 0.28999... in binary and must not be cut to 0.28
  { value: 0.29, type: 'amount', expected: '0.29' },
  { value: 0.57, type: 'price', expected: '$0.57' },
  { value: 1.1, type: 'precise', expected: '1.1' },
  // Leading zeros don't count towards the decimals
  { value: 0.000012345, type: 'amount', expected: '0.000012' },
  { value: 0.0019999, type: 'amount', expected: '0.0019' },
  // Below 1e-6 toString() switches to exponent form
  { value: 0.00000012345, type: 'precise', expected: '0.00000012345' },
  { value: 0.000000999999999, type: 'precise', expected: '0.00000099999999' },
  { value: 1e21, type: 'amount', expected: '1,000,000,000,000,000,000,000' }
]

describe('formatDecimals', () => {
  TEST_CASES.forEach(({ value, type, expected }) => {
    it(`should format ${value} as ${expected} for type ${type}`, () => {
      expect(formatDecimals(value, type)).toBe(expected)
    })
  })
  SPECIAL_TEST_CASES.forEach(({ value, type, expected }) => {
    it(`special test case: should format ${value} as ${expected} for type ${type}`, () => {
      expect(formatDecimals(value, type)).toBe(expected)
    })
  })
  TRUNCATION_TEST_CASES.forEach(({ value, type, expected }) => {
    it(`truncation: should format ${value} as ${expected} for type ${type}`, () => {
      expect(formatDecimals(value, type)).toBe(expected)
    })
  })
})
