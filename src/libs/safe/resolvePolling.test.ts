import { describe, expect, test } from '@jest/globals'

import {
  SAFE_RESOLVE_INACTIVE_INTERVAL,
  SAFE_RESOLVE_MAX_ACTIVE_INTERVAL,
  SAFE_RESOLVE_MAX_INACTIVE_INTERVAL,
  SAFE_RESOLVE_UNCHANGED_CHECKS_BEFORE_BACKOFF,
  SAFE_TXNS_RESOLVE_ACTIVE_INTERVAL
} from '../../consts/intervals'
import {
  getNextSafeResolvePollState,
  getSafeResolveTimeout,
  INITIAL_SAFE_RESOLVE_POLL_STATE,
  toSafeResolveFingerprint
} from './resolvePolling'

describe('toSafeResolveFingerprint', () => {
  test('is the same whatever order the parts come in', () => {
    expect(toSafeResolveFingerprint(['b', 'a', 'c'])).toBe(toSafeResolveFingerprint(['c', 'b', 'a']))
  })

  test('changes when a part changes', () => {
    expect(toSafeResolveFingerprint(['txn:0x1:2'])).not.toBe(toSafeResolveFingerprint(['txn:0x1:3']))
  })

  test('does not modify the passed parts', () => {
    const parts = ['b', 'a']
    toSafeResolveFingerprint(parts)
    expect(parts).toEqual(['b', 'a'])
  })
})

describe('getNextSafeResolvePollState', () => {
  test('counts the checks in a row that found the same thing', () => {
    const first = getNextSafeResolvePollState(INITIAL_SAFE_RESOLVE_POLL_STATE, 'a')
    const second = getNextSafeResolvePollState(first, 'a')
    const third = getNextSafeResolvePollState(second, 'a')

    expect(first).toEqual({ fingerprint: 'a', unchangedChecksCount: 0 })
    expect(second).toEqual({ fingerprint: 'a', unchangedChecksCount: 1 })
    expect(third).toEqual({ fingerprint: 'a', unchangedChecksCount: 2 })
  })

  test('starts the count over when a check finds something new', () => {
    const state = { fingerprint: 'a', unchangedChecksCount: 5 }

    expect(getNextSafeResolvePollState(state, 'b')).toEqual({
      fingerprint: 'b',
      unchangedChecksCount: 0
    })
  })

  test('starts over when there was nothing to check', () => {
    const state = { fingerprint: 'a', unchangedChecksCount: 5 }

    expect(getNextSafeResolvePollState(state, undefined)).toEqual(INITIAL_SAFE_RESOLVE_POLL_STATE)
  })

  test('counts an empty fingerprint as something that was checked', () => {
    const state = getNextSafeResolvePollState(INITIAL_SAFE_RESOLVE_POLL_STATE, '')

    expect(getNextSafeResolvePollState(state, '')).toEqual({
      fingerprint: '',
      unchangedChecksCount: 1
    })
  })
})

describe('getSafeResolveTimeout', () => {
  const activeTimeout = SAFE_TXNS_RESOLVE_ACTIVE_INTERVAL
  const firstBackoffCount = SAFE_RESOLVE_UNCHANGED_CHECKS_BEFORE_BACKOFF

  test('uses the fast interval while a wallet window is open and nothing has slowed it down', () => {
    expect(getSafeResolveTimeout({ activeTimeout, isUiActive: true, unchangedChecksCount: 0 })).toBe(
      activeTimeout
    )
  })

  test('uses the slower interval while no wallet window is open, but keeps checking', () => {
    expect(
      getSafeResolveTimeout({ activeTimeout, isUiActive: false, unchangedChecksCount: 0 })
    ).toBe(SAFE_RESOLVE_INACTIVE_INTERVAL)
  })

  test('keeps the base interval until enough checks in a row found nothing new', () => {
    expect(
      getSafeResolveTimeout({
        activeTimeout,
        isUiActive: false,
        unchangedChecksCount: firstBackoffCount - 1
      })
    ).toBe(SAFE_RESOLVE_INACTIVE_INTERVAL)
  })

  test('doubles the interval with each further check that finds nothing new', () => {
    expect(
      getSafeResolveTimeout({
        activeTimeout,
        isUiActive: false,
        unchangedChecksCount: firstBackoffCount
      })
    ).toBe(SAFE_RESOLVE_INACTIVE_INTERVAL * 2)
    expect(
      getSafeResolveTimeout({
        activeTimeout,
        isUiActive: false,
        unchangedChecksCount: firstBackoffCount + 1
      })
    ).toBe(SAFE_RESOLVE_INACTIVE_INTERVAL * 4)
  })

  test('never goes above the maximum, with or without a wallet window', () => {
    expect(
      getSafeResolveTimeout({ activeTimeout, isUiActive: true, unchangedChecksCount: 1000 })
    ).toBe(SAFE_RESOLVE_MAX_ACTIVE_INTERVAL)
    expect(
      getSafeResolveTimeout({ activeTimeout, isUiActive: false, unchangedChecksCount: 1000 })
    ).toBe(SAFE_RESOLVE_MAX_INACTIVE_INTERVAL)
  })
})
