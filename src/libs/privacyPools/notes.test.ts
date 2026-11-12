import { Hex } from '../../interfaces/hex'
import { PrivacyPoolsNote } from '../../interfaces/privacyPools'
import { ZERO_ADDRESS } from '../../services/socket/constants'
import { findSendablePrivacyPoolsNote, getSdkPickedPrivacyPoolsNote } from './notes'

const DEPOSITOR: Hex = '0x00000000000000000000000000000000000000d1'
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'

let nextLabel = 1n

/** An approved, untouched ETH note of 100. */
const note = (overrides: Partial<PrivacyPoolsNote> = {}): PrivacyPoolsNote => {
  const label = nextLabel++

  return {
    label,
    tokenAddress: ZERO_ADDRESS,
    amount: 100n,
    approval: 'approved',
    depositorAddr: DEPOSITOR,
    depositIndex: Number(label),
    depositValue: 100n,
    withdrawCount: 0,
    blockNumber: 1n,
    ...overrides
  }
}

describe('findSendablePrivacyPoolsNote', () => {
  test('finds an approved deposit of the token with enough left, in any address case', () => {
    const chosen = note({ amount: 60n })
    const notes = [note(), chosen]

    expect(findSendablePrivacyPoolsNote(notes, ZERO_ADDRESS, chosen.label, 60n)).toBe(chosen)
    const usdc = note({ tokenAddress: USDC })
    expect(findSendablePrivacyPoolsNote([usdc], USDC.toUpperCase(), usdc.label, 1n)).toBe(usdc)
  })

  test('finds none that is pending, of another token, too small or unknown', () => {
    const pending = note({ approval: 'pending' })
    const usdc = note({ tokenAddress: USDC })
    const small = note({ amount: 10n })
    const notes = [pending, usdc, small]

    expect(findSendablePrivacyPoolsNote(notes, ZERO_ADDRESS, pending.label, 1n)).toBeUndefined()
    expect(findSendablePrivacyPoolsNote(notes, ZERO_ADDRESS, usdc.label, 1n)).toBeUndefined()
    expect(findSendablePrivacyPoolsNote(notes, ZERO_ADDRESS, small.label, 11n)).toBeUndefined()
    expect(findSendablePrivacyPoolsNote(notes, ZERO_ADDRESS, 9_999n, 1n)).toBeUndefined()
  })

  test('finds none for no amount or a negative one', () => {
    const chosen = note()

    expect(findSendablePrivacyPoolsNote([chosen], ZERO_ADDRESS, chosen.label, 0n)).toBeUndefined()
    expect(findSendablePrivacyPoolsNote([chosen], ZERO_ADDRESS, chosen.label, -1n)).toBeUndefined()
  })
})

describe('getSdkPickedPrivacyPoolsNote', () => {
  test('picks the deposit with the least left that covers the amount', () => {
    const smallest = note({ amount: 50n })
    const notes = [note({ amount: 500n }), smallest, note({ amount: 20n })]

    expect(getSdkPickedPrivacyPoolsNote(notes, ZERO_ADDRESS, 40n)).toBe(smallest)
    expect(getSdkPickedPrivacyPoolsNote(notes, ZERO_ADDRESS, 50n)).toBe(smallest)
  })

  test('picks a pending deposit too, as the SDK does not skip them', () => {
    const pending = note({ amount: 50n, approval: 'pending' })

    expect(getSdkPickedPrivacyPoolsNote([note(), pending], ZERO_ADDRESS, 40n)).toBe(pending)
  })

  test('keeps the listed order on ties', () => {
    const first = note({ amount: 60n })
    const notes = [first, note({ amount: 60n })]

    expect(getSdkPickedPrivacyPoolsNote(notes, ZERO_ADDRESS, 60n)).toBe(first)
  })

  test("skips other tokens' deposits and picks none when none covers the amount", () => {
    const notes = [note({ amount: 500n, tokenAddress: USDC }), note({ amount: 30n })]

    expect(getSdkPickedPrivacyPoolsNote(notes, ZERO_ADDRESS, 40n)).toBeUndefined()
  })
})
