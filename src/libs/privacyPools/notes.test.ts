import { Hex } from '../../interfaces/hex'
import { PrivacyPoolsNote } from '../../interfaces/privacyPools'
import { ZERO_ADDRESS } from '../../services/socket/constants'
import {
  findPrivacyPoolsDepositLabel,
  findSendablePrivacyPoolsNote,
  getPrivacyPoolsSendableDeposits,
  getSdkPickedPrivacyPoolsNote
} from './notes'

const DEPOSITOR: Hex = '0x00000000000000000000000000000000000000d1'
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
const DAI = '0x6b175474e89094c44da98b954eedeac495271d0f'

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

describe('getPrivacyPoolsSendableDeposits', () => {
  const getDeposits = (notes: PrivacyPoolsNote[], withdrawingAmounts = new Map<bigint, bigint>()) =>
    getPrivacyPoolsSendableDeposits({ chainId: '1', notes, withdrawingAmounts })

  test('numbers each deposit among all of its token, oldest first, and lists the approved ones left', () => {
    // Listed out of order, as numbering goes by when each was made
    const third = note({ depositIndex: 7, amount: 30n })
    const spent = note({ depositIndex: 2, amount: 0n })
    const pending = note({ depositIndex: 5, approval: 'pending' })
    const first = note({ depositIndex: 1, amount: 10n })

    expect(getDeposits([third, spent, pending, first])).toEqual([
      expect.objectContaining({ number: 1, availableAmount: 10n }),
      expect.objectContaining({ number: 4, availableAmount: 30n })
    ])
  })

  test("numbers each token on its own, in the order of the chain's assets", () => {
    const usdc = note({ tokenAddress: USDC, depositIndex: 1 })
    const eth = note({ depositIndex: 2 })

    expect(getDeposits([usdc, eth])).toEqual([
      {
        tokenAddress: ZERO_ADDRESS,
        symbol: 'ETH',
        decimals: 18,
        isNative: true,
        number: 1,
        availableAmount: 100n
      },
      expect.objectContaining({ tokenAddress: USDC, symbol: 'USDC', number: 1 })
    ])
  })

  test('takes out what sends on their way take from each deposit, and drops one they empty', () => {
    const partly = note({ depositIndex: 1 })
    const emptied = note({ depositIndex: 2 })
    const withdrawing = new Map([
      [partly.label, 40n],
      [emptied.label, 100n]
    ])

    expect(getDeposits([partly, emptied], withdrawing)).toEqual([
      expect.objectContaining({ number: 1, availableAmount: 60n })
    ])
  })

  test('lists no deposit of a token that cannot be sent, nor on a chain without pools', () => {
    expect(getDeposits([note({ tokenAddress: DAI })])).toEqual([])
    expect(
      getPrivacyPoolsSendableDeposits({
        chainId: '137',
        notes: [note()],
        withdrawingAmounts: new Map()
      })
    ).toEqual([])
  })
})

describe('findPrivacyPoolsDepositLabel', () => {
  test('finds the deposit of the token with that number, the spent and pending ones counted', () => {
    const second = note({ depositIndex: 4, approval: 'pending' })
    const first = note({ depositIndex: 2, amount: 0n })
    const third = note({ depositIndex: 9 })
    const notes = [third, note({ tokenAddress: USDC, depositIndex: 3 }), second, first]

    expect(findPrivacyPoolsDepositLabel(notes, ZERO_ADDRESS, 1)).toBe(first.label)
    expect(findPrivacyPoolsDepositLabel(notes, ZERO_ADDRESS, 2)).toBe(second.label)
    expect(findPrivacyPoolsDepositLabel(notes, ZERO_ADDRESS, 3)).toBe(third.label)
  })

  test('finds none past the last deposit, before the first, or of a token with none', () => {
    const notes = [note()]

    expect(findPrivacyPoolsDepositLabel(notes, ZERO_ADDRESS, 2)).toBeUndefined()
    expect(findPrivacyPoolsDepositLabel(notes, ZERO_ADDRESS, 0)).toBeUndefined()
    expect(findPrivacyPoolsDepositLabel(notes, USDC, 1)).toBeUndefined()
  })
})
