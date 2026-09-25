import { Interface } from 'ethers'

import { expect } from '@jest/globals'

import {
  decodePendingWalletWithdrawals,
  encodeWalletStakingLeaveLog,
  formatPendingWalletWithdrawalDuration,
  getActivePendingWalletWithdrawals,
  getLegacyPendingWalletWithdrawalStorageKey,
  getPendingWalletWithdrawalCommitmentId,
  getPendingWalletWithdrawalId,
  getPendingWalletWithdrawalSummary,
  getUniqueAccountWalletStakingLeaveLogs,
  isPendingWalletWithdrawalReady,
  LOG_LEAVE_TOPIC,
  parseCachedPendingWalletWithdrawal,
  parseWalletStakingRelayerLogsResponse,
  shouldUsePendingWalletWithdrawalMode,
  walletStakingInterface
} from './pendingWithdrawal'

const ACCOUNT = '0x0000000000000000000000000000000000000001'
const OTHER_ACCOUNT = '0x0000000000000000000000000000000000000002'
const pendingWithdrawal = {
  shares: 10n,
  unlocksAt: 2_592_000n,
  maxTokens: 12n
}

describe('pending WALLET withdrawal helpers', () => {
  test('selects the latest timer and totals the shares from all active withdrawals', () => {
    const latestWithdrawal = {
      shares: 20n,
      unlocksAt: pendingWithdrawal.unlocksAt + 2n * 24n * 60n * 60n,
      maxTokens: 24n
    }

    expect(getPendingWalletWithdrawalSummary([pendingWithdrawal, latestWithdrawal])).toEqual({
      latestWithdrawal,
      totalShares: 30n
    })
    expect(getPendingWalletWithdrawalSummary([])).toEqual({
      latestWithdrawal: null,
      totalShares: 0n
    })
  })

  test('keeps successful active withdrawals when another commitment check fails', async () => {
    const failedWithdrawal = { ...pendingWithdrawal, shares: 20n, unlocksAt: 3_000_000n }
    const inactiveWithdrawal = { ...pendingWithdrawal, shares: 30n, unlocksAt: 4_000_000n }
    const failure = new Error('Unable to check commitment')

    const result = await getActivePendingWalletWithdrawals(
      [pendingWithdrawal, failedWithdrawal, inactiveWithdrawal],
      async (withdrawal) => {
        if (withdrawal === failedWithdrawal) throw failure
        return withdrawal === inactiveWithdrawal ? 0n : 15n
      }
    )

    expect(result).toEqual({
      activeWithdrawals: [{ ...pendingWithdrawal, maxTokens: 15n }],
      errors: [failure]
    })
  })

  test('uses the lock-time flow for every fully backed pending withdrawal, including small ones', () => {
    const smallPendingShares = 470_878_895_989_112n

    expect(
      shouldUsePendingWalletWithdrawalMode(
        { ...pendingWithdrawal, shares: smallPendingShares },
        smallPendingShares,
        smallPendingShares
      )
    ).toBe(true)
    expect(shouldUsePendingWalletWithdrawalMode(pendingWithdrawal, 11n, 10n)).toBe(true)
    expect(shouldUsePendingWalletWithdrawalMode(pendingWithdrawal, 9n, 10n)).toBe(false)
    expect(shouldUsePendingWalletWithdrawalMode(null, 10n, 10n)).toBe(false)
  })

  test('parses an account-specific legacy cache entry', () => {
    expect(getLegacyPendingWalletWithdrawalStorageKey(ACCOUNT.toUpperCase())).toBe(
      `walletStakingPendingWithdrawal:${ACCOUNT}`
    )
    expect(
      parseCachedPendingWalletWithdrawal({ shares: '10', unlocksAt: '2592000', maxTokens: '12' })
    ).toEqual(pendingWithdrawal)
  })

  test.each([
    null,
    {},
    { shares: '0', unlocksAt: '1', maxTokens: '1' },
    { shares: '1', unlocksAt: 'invalid', maxTokens: '1' }
  ])('rejects an invalid legacy cache entry: %p', (cachedValue) => {
    expect(parseCachedPendingWalletWithdrawal(cachedValue)).toBeNull()
  })

  test('decodes only LogLeave events owned by the selected account', () => {
    const event = encodeWalletStakingLeaveLog(ACCOUNT, pendingWithdrawal)
    const otherEvent = encodeWalletStakingLeaveLog(OTHER_ACCOUNT, pendingWithdrawal)
    const unrelatedInterface = new Interface(['event Transfer(address indexed from)'])
    const unrelatedEvent = unrelatedInterface.encodeEventLog(
      unrelatedInterface.getEvent('Transfer')!,
      [ACCOUNT]
    )

    expect(
      decodePendingWalletWithdrawals(
        [event, otherEvent, { topics: unrelatedEvent.topics, data: unrelatedEvent.data }],
        ACCOUNT
      )
    ).toEqual([pendingWithdrawal])
  })

  test('encodes a leave log in the same shape as the contract event', () => {
    const contractEvent = walletStakingInterface.encodeEventLog(
      walletStakingInterface.getEvent('LogLeave')!,
      [ACCOUNT, pendingWithdrawal.shares, pendingWithdrawal.unlocksAt, pendingWithdrawal.maxTokens]
    )

    expect(encodeWalletStakingLeaveLog(ACCOUNT, pendingWithdrawal)).toEqual({
      topics: contractEvent.topics,
      data: contractEvent.data
    })
  })

  test('keeps one decodable leave log per withdrawal of the account', () => {
    const log = encodeWalletStakingLeaveLog(ACCOUNT, pendingWithdrawal)
    const sameWithdrawalLog = encodeWalletStakingLeaveLog(ACCOUNT, {
      ...pendingWithdrawal,
      maxTokens: 99n
    })
    const otherWithdrawal = { ...pendingWithdrawal, shares: 20n }
    const otherWithdrawalLog = encodeWalletStakingLeaveLog(ACCOUNT, otherWithdrawal)

    const entries = getUniqueAccountWalletStakingLeaveLogs(
      [
        log,
        encodeWalletStakingLeaveLog(OTHER_ACCOUNT, pendingWithdrawal),
        // A log that can't be decoded must not drop the others
        { topics: [LOG_LEAVE_TOPIC], data: '0x' },
        otherWithdrawalLog,
        sameWithdrawalLog
      ],
      ACCOUNT
    )

    expect(entries).toEqual([
      // The later log of the same withdrawal wins
      { log: sameWithdrawalLog, withdrawal: { ...pendingWithdrawal, maxTokens: 99n } },
      { log: otherWithdrawalLog, withdrawal: otherWithdrawal }
    ])
    expect(entries.map(({ withdrawal }) => getPendingWalletWithdrawalId(withdrawal))).toEqual([
      '10:2592000',
      '20:2592000'
    ])
  })

  test('validates the relayer response before decoding logs', () => {
    const logs = [{ topics: [LOG_LEAVE_TOPIC], data: '0x' }]

    expect(parseWalletStakingRelayerLogsResponse({ success: true, data: { logs } })).toEqual(logs)
    expect(() =>
      parseWalletStakingRelayerLogsResponse({ success: false, message: 'Unavailable' })
    ).toThrow('Unavailable')
    expect(() =>
      parseWalletStakingRelayerLogsResponse({ success: true, data: { logs: [{}] } })
    ).toThrow('invalid pending withdrawal data')
  })

  test('calculates the contract commitment key deterministically', () => {
    const uppercaseAccount = `0x${ACCOUNT.slice(2).toUpperCase()}`

    expect(getPendingWalletWithdrawalCommitmentId(ACCOUNT, pendingWithdrawal)).toBe(
      getPendingWalletWithdrawalCommitmentId(uppercaseAccount, pendingWithdrawal)
    )
  })

  test('formats the countdown and only becomes ready after unlocksAt', () => {
    const unlocksAt = 2_592_000n

    expect(formatPendingWalletWithdrawalDuration(unlocksAt, 0)).toBe('30d 0h 0m')
    expect(isPendingWalletWithdrawalReady(unlocksAt, Number(unlocksAt) * 1000)).toBe(false)
    expect(isPendingWalletWithdrawalReady(unlocksAt, (Number(unlocksAt) + 1) * 1000)).toBe(true)
    expect(LOG_LEAVE_TOPIC.startsWith('0x')).toBe(true)
  })
})
