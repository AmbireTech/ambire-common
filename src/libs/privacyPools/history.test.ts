import { expect } from '@jest/globals'

import type { PPv1HistoryEvent } from '@kohaku-eth/privacy-pools'

import { PRIVACY_POOLS_NATIVE_ASSET_ADDRESS } from '../../consts/privacyPools'
import { PrivacyPoolsHistoryEntry } from '../../interfaces/privacyPools'
import { ZERO_ADDRESS } from '../../services/socket/constants'
import { getPrivacyPoolsHistoryPage, toPrivacyPoolsHistoryEntries } from './history'

const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
const ETH_POOL = 0xf241d57c6debae225c0f2e6ea1529373c9a9c9fbn
const DEPOSITOR = '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'
const RAGEQUITTER = '0xc4A6bB5139123bD6ba0CF387828a9A3a73EF8D1e'
const TX_HASH = '0x00000000000000000000000000000000000000000000000000000000000000ab'

const base = {
  transactionHash: BigInt(TX_HASH),
  blockNumber: 100n,
  logIndex: 3,
  timestamp: 1_700_000_000n,
  poolAddress: ETH_POOL,
  assetAddress: BigInt(PRIVACY_POOLS_NATIVE_ASSET_ADDRESS),
  value: 10n
}

const deposit = (overrides: Partial<PPv1HistoryEvent> = {}): PPv1HistoryEvent =>
  ({
    ...base,
    type: 'deposit',
    depositor: BigInt(DEPOSITOR),
    label: 1n,
    aspStatus: 'approved',
    ...overrides
  }) as PPv1HistoryEvent

const withdrawal = (overrides: Partial<PPv1HistoryEvent> = {}): PPv1HistoryEvent =>
  ({ ...base, type: 'withdrawal', ...overrides }) as PPv1HistoryEvent

const ragequit = (overrides: Partial<PPv1HistoryEvent> = {}): PPv1HistoryEvent =>
  ({
    ...base,
    type: 'ragequit',
    ragequitter: BigInt(RAGEQUITTER),
    ...overrides
  }) as PPv1HistoryEvent

const toEntries = (events: PPv1HistoryEvent[], pendingLabels: bigint[] = []) =>
  toPrivacyPoolsHistoryEntries({ chainId: '1', events, pendingLabels: new Set(pendingLabels) })

const entry = (id: string, timestamp: number): PrivacyPoolsHistoryEntry => ({
  id,
  type: 'withdrawal',
  chainId: '1',
  tokenAddress: ZERO_ADDRESS,
  amount: 1n,
  timestamp,
  txnId: null,
  counterpartyAddr: null,
  status: null
})

describe('toPrivacyPoolsHistoryEntries', () => {
  it("translates a deposit into the wallet's terms", () => {
    expect(toEntries([deposit()])).toEqual([
      {
        id: '1-deposit-100-3',
        type: 'deposit',
        chainId: '1',
        tokenAddress: ZERO_ADDRESS,
        amount: 10n,
        timestamp: 1_700_000_000_000,
        txnId: TX_HASH,
        counterpartyAddr: DEPOSITOR,
        status: 'approved'
      }
    ])
  })

  it('keeps the token address of a token pool, and the order the plugin gives', () => {
    const entries = toEntries([
      withdrawal({ assetAddress: BigInt(USDC), blockNumber: 200n }),
      deposit({ blockNumber: 100n })
    ])

    expect(entries.map(({ type, tokenAddress }) => [type, tokenAddress])).toEqual([
      ['withdrawal', USDC],
      ['deposit', ZERO_ADDRESS]
    ])
  })

  it('names where a deposit taken back went, and no one for a withdrawal', () => {
    const [ragequitEntry, withdrawalEntry] = toEntries([ragequit(), withdrawal()])

    expect(ragequitEntry!.counterpartyAddr).toBe(RAGEQUITTER)
    expect(withdrawalEntry!.counterpartyAddr).toBeNull()
  })

  it('checksums the addresses, as the plugin reports them as numbers', () => {
    const [entry0] = toEntries([deposit({ depositor: BigInt(DEPOSITOR.toLowerCase()) } as any)])

    expect(entry0!.counterpartyAddr).toBe(DEPOSITOR)
  })

  it('has no transaction when the history did not record it', () => {
    const [entry0] = toEntries([deposit({ transactionHash: 0n })])

    expect(entry0!.txnId).toBeNull()
  })

  it('pads a transaction hash with leading zeros to its full length', () => {
    const [entry0] = toEntries([deposit({ transactionHash: 1n })])

    expect(entry0!.txnId).toHaveLength(66)
  })

  describe('the status', () => {
    it('is pending for a deposit still being verified, by the notes of the same sync', () => {
      const [entry0] = toEntries([deposit({ aspStatus: 'pending', label: 7n } as any)], [7n])

      expect(entry0!.status).toBe('pending')
    })

    it('is none for a deposit taken back, though the plugin still reports it pending', () => {
      const [entry0] = toEntries([deposit({ aspStatus: 'pending', label: 7n } as any)], [])

      expect(entry0!.status).toBeNull()
    })

    it('is approved for a deposit the plugin reports approved, whatever the notes say', () => {
      const [listed, spent] = toEntries(
        [
          deposit({ aspStatus: 'approved', label: 7n } as any),
          deposit({ aspStatus: 'approved', label: 8n, blockNumber: 99n } as any)
        ],
        [7n]
      )

      expect(listed!.status).toBe('approved')
      expect(spent!.status).toBe('approved')
    })

    it('is none for a withdrawal or a deposit taken back, even when a note shares the label', () => {
      const entries = toEntries([withdrawal(), ragequit()], [1n])

      expect(entries.map(({ status }) => status)).toEqual([null, null])
    })
  })

  describe('ids', () => {
    it('are the same across reads', () => {
      const events = [deposit(), withdrawal({ blockNumber: 99n })]

      expect(toEntries(events).map(({ id }) => id)).toEqual(toEntries(events).map(({ id }) => id))
    })

    it('stay unique when the history did not record the position in the block', () => {
      const ids = toEntries([
        withdrawal({ logIndex: 0 }),
        withdrawal({ logIndex: 0 }),
        withdrawal({ logIndex: 0 })
      ]).map(({ id }) => id)

      expect(ids).toEqual(['1-withdrawal-100-0', '1-withdrawal-100-0-1', '1-withdrawal-100-0-2'])
    })

    it('tell apart events of different kinds at the same position', () => {
      const ids = toEntries([deposit({ logIndex: 0 }), withdrawal({ logIndex: 0 })]).map(
        ({ id }) => id
      )

      expect(new Set(ids).size).toBe(2)
    })

    it('tell apart the same event on two networks', () => {
      const [onEthereum] = toEntries([withdrawal()])
      const [onOther] = toPrivacyPoolsHistoryEntries({
        chainId: '10',
        events: [withdrawal()],
        pendingLabels: new Set()
      })

      expect(onEthereum!.id).not.toBe(onOther!.id)
    })
  })

  it('returns nothing for no events', () => {
    expect(toEntries([])).toEqual([])
  })
})

describe('getPrivacyPoolsHistoryPage', () => {
  const history = Array.from({ length: 25 }, (_, i) => entry(`e${i}`, 1000 - i))

  it('returns the requested page and what it takes to move between pages', () => {
    const page = getPrivacyPoolsHistoryPage([history], { fromPage: 1, itemsPerPage: 10 })

    expect(page.items.map(({ id }) => id)).toEqual(history.slice(10, 20).map(({ id }) => id))
    expect(page).toMatchObject({ itemsTotal: 25, currentPage: 1, maxPages: 3 })
  })

  it('returns a short last page and an empty one past the end', () => {
    expect(
      getPrivacyPoolsHistoryPage([history], { fromPage: 2, itemsPerPage: 10 }).items
    ).toHaveLength(5)
    expect(getPrivacyPoolsHistoryPage([history], { fromPage: 3, itemsPerPage: 10 }).items).toEqual(
      []
    )
  })

  it('merges networks newest first', () => {
    const ethereum = [entry('eth-new', 300), entry('eth-old', 100)]
    const other = [entry('other', 200)]

    const page = getPrivacyPoolsHistoryPage([ethereum, other], { fromPage: 0, itemsPerPage: 10 })

    expect(page.items.map(({ id }) => id)).toEqual(['eth-new', 'other', 'eth-old'])
  })

  it("keeps a network's own order of events at the same time", () => {
    const ethereum = [entry('second-in-block', 100), entry('first-in-block', 100)]

    const page = getPrivacyPoolsHistoryPage([ethereum, []], { fromPage: 0, itemsPerPage: 10 })

    expect(page.items.map(({ id }) => id)).toEqual(['second-in-block', 'first-in-block'])
  })

  it('keeps the order of a single network as the plugin gives it', () => {
    const page = getPrivacyPoolsHistoryPage([history], { fromPage: 0, itemsPerPage: 100 })

    expect(page.items).toEqual(history)
  })

  it('is empty, with no pages, when there is no history', () => {
    expect(getPrivacyPoolsHistoryPage([], { fromPage: 0, itemsPerPage: 10 })).toEqual({
      items: [],
      itemsTotal: 0,
      currentPage: 0,
      maxPages: 0
    })
  })
})
