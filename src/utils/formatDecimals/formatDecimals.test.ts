import formatDecimals from './formatDecimals'

type TestCases = {
  value: number | undefined
  type: 'value' | 'price' | 'amount' | 'default' | 'precise'
  expected: string
}[]

const TEST_CASES: TestCases = [
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
})
