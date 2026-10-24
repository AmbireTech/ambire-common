import { TORNADO_CASH_POOLS } from '../../consts/tornadoCash'
import {
  countTornadoCashNotes,
  describeTornadoCashAmounts,
  getTornadoCashPoolsOfAsset,
  pickTornadoCashNotes,
  splitIntoTornadoCashNotes,
  TornadoCashNoteCount
} from './amounts'

const ETH = '0x0000000000000000000000000000000000000000'
const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7'
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const ETHER = 10n ** 18n

const ethPool = (denomination: bigint) =>
  TORNADO_CASH_POOLS.find(
    (pool) => pool.assetAddress === ETH && pool.denomination === denomination
  )!

/** Note counts as `amount in tenths of ETH => count`, for readable assertions. */
const asTenths = (noteCounts: TornadoCashNoteCount[] | null) =>
  noteCounts &&
  Object.fromEntries(
    noteCounts.map(({ pool, count }) => [(pool.denomination / (ETHER / 10n)).toString(), count])
  )

describe('Tornado Cash amounts', () => {
  it("lists an asset's pools largest first, whatever the address case", () => {
    expect(getTornadoCashPoolsOfAsset(USDT.toLowerCase()).map((pool) => pool.denomination)).toEqual(
      [10n ** 9n, 10n ** 8n]
    )
    expect(getTornadoCashPoolsOfAsset('0x0000000000000000000000000000000000000001')).toEqual([])
  })

  it('offers no USDC pools, as their withdrawals are not safe yet', () => {
    expect(getTornadoCashPoolsOfAsset(USDC)).toEqual([])
    expect(splitIntoTornadoCashNotes(USDC, 100n * 10n ** 6n)).toBeNull()
  })

  it('splits an amount into the fewest notes', () => {
    const noteCounts = splitIntoTornadoCashNotes(ETH, 12n * ETHER + 3n * (ETHER / 10n))

    expect(asTenths(noteCounts)).toEqual({ '100': 1, '10': 2, '1': 3 })
    expect(countTornadoCashNotes(noteCounts!)).toBe(6)
  })

  it('refuses an amount that is no exact sum of notes, instead of dropping the rest', () => {
    expect(splitIntoTornadoCashNotes(ETH, ETHER + ETHER / 100n)).toBeNull()
    expect(splitIntoTornadoCashNotes(ETH, ETHER / 20n)).toBeNull()
    expect(splitIntoTornadoCashNotes(ETH, 0n)).toBeNull()
    expect(splitIntoTornadoCashNotes(USDT, 150n * 10n ** 6n)).toBeNull()
    expect(
      splitIntoTornadoCashNotes('0x0000000000000000000000000000000000000001', ETHER)
    ).toBeNull()
  })

  it('picks owned notes for an exact amount, skipping larger ones', () => {
    const owned = [
      { pool: ethPool(ETHER), count: 1 },
      { pool: ethPool(ETHER / 10n), count: 5 }
    ]

    expect(asTenths(pickTornadoCashNotes(owned, ETHER / 2n))).toEqual({ '1': 5 })
    expect(asTenths(pickTornadoCashNotes(owned, ETHER + ETHER / 5n))).toEqual({ '10': 1, '1': 2 })
  })

  it('refuses an amount the owned notes cannot make exactly', () => {
    const owned = [{ pool: ethPool(ETHER), count: 2 }]

    expect(pickTornadoCashNotes(owned, ETHER / 2n)).toBeNull()
    expect(pickTornadoCashNotes(owned, 3n * ETHER)).toBeNull()
    expect(pickTornadoCashNotes(owned, 0n)).toBeNull()
  })
})

describe('describeTornadoCashAmounts', () => {
  it("lists an asset's amounts smallest first", () => {
    expect(describeTornadoCashAmounts(ETH)).toBe('0.1, 1, 10 or 100 ETH')
    expect(describeTornadoCashAmounts(USDT)).toBe('100 or 1000 USDT')
  })
})
