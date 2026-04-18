import { getAmountAfterFeeReserve } from './amount'

describe('transfer amount helpers', () => {
  test('should subtract the reserved fee from the transferable amount', () => {
    expect(getAmountAfterFeeReserve(15_000_000n, 350_000n)).toBe(14_650_000n)
  })

  test('should never return a negative transferable amount', () => {
    expect(getAmountAfterFeeReserve(15_000_000n, 15_000_001n)).toBe(0n)
  })
})
