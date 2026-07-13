import { getAmountAfterFeeReserve, getAmountAfterFeeSync } from './amount'

describe('transfer amount helpers', () => {
  test('should subtract the reserved fee plus overhead from the transferable amount', () => {
    expect(getAmountAfterFeeReserve(15_000_000n, 350_000n)).toBe(14_580_000n)
  })

  test('should never return a negative transferable amount', () => {
    expect(getAmountAfterFeeReserve(15_000_000n, 15_000_001n)).toBe(0n)
  })

  test('should clamp manually entered amounts that exceed the reserved max', () => {
    expect(
      getAmountAfterFeeSync({
        currentAmount: 14_900_000n,
        totalAmount: 15_000_000n,
        fee: 350_000n,
        shouldReserveFee: true,
        isMaxAmountSelected: false
      })
    ).toBe(14_580_000n)
  })

  test('should preserve smaller manual amounts when fee reservation is needed', () => {
    expect(
      getAmountAfterFeeSync({
        currentAmount: 14_000_000n,
        totalAmount: 15_000_000n,
        fee: 350_000n,
        shouldReserveFee: true,
        isMaxAmountSelected: false
      })
    ).toBe(14_000_000n)
  })

  test('should keep max selection synced with the current fee option', () => {
    expect(
      getAmountAfterFeeSync({
        currentAmount: 14_650_000n,
        totalAmount: 15_000_000n,
        fee: 350_000n,
        shouldReserveFee: false,
        isMaxAmountSelected: true
      })
    ).toBe(15_000_000n)
  })

  test('should not increase max amount while a larger fee is reserved', () => {
    expect(
      getAmountAfterFeeSync({
        currentAmount: 14_600_000n,
        totalAmount: 15_000_000n,
        fee: 350_000n,
        reservedFee: 400_000n,
        shouldReserveFee: true,
        isMaxAmountSelected: true
      })
    ).toBe(14_520_000n)
  })
})
