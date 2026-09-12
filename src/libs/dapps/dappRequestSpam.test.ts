import { describe, expect, test } from '@jest/globals'

import {
  DAPP_REJECT_TRACKING_WINDOW,
  DAPP_REJECTS_BEFORE_OFFERING_SILENCE,
  DAPP_SILENCE_DURATION
} from '../../consts/safeguards/dappRequestSpam'
import { UserRequest } from '../../interfaces/userRequest'
import {
  getDappIdsFromUserRequest,
  getEmptyDappSpamRecord,
  isSilenced,
  recordRejection,
  shouldOfferSilence
} from './dappRequestSpam'

const NOW = 1_700_000_000_000

const makeMessageRequest = (message: string): UserRequest =>
  ({
    id: 'message-request',
    kind: 'message',
    meta: { params: { message } },
    dappPromises: []
  }) as unknown as UserRequest

const makeCallsRequest = (calls: { to: string; value: bigint; data: string }[]): UserRequest =>
  ({
    id: 'calls-request',
    kind: 'calls',
    signAccountOp: { accountOp: { calls } },
    dappPromises: []
  }) as unknown as UserRequest

const makeSession = (id: string) => ({ id }) as any

describe('recordRejection', () => {
  test('starts the count at one for an app that was never rejected', () => {
    const record = recordRejection(undefined, NOW)

    expect(record.rejectedCount).toBe(1)
    expect(record.lastRejectedAt).toBe(NOW)
  })

  test('counts up while the rejections stay inside the tracking window', () => {
    const first = recordRejection(undefined, NOW)
    const second = recordRejection(first, NOW + DAPP_REJECT_TRACKING_WINDOW - 1)

    expect(second.rejectedCount).toBe(2)
    expect(second.lastRejectedAt).toBe(NOW + DAPP_REJECT_TRACKING_WINDOW - 1)
  })

  test('starts over once the tracking window has passed', () => {
    const first = recordRejection(undefined, NOW)
    const second = recordRejection(first, NOW + DAPP_REJECT_TRACKING_WINDOW)

    expect(second.rejectedCount).toBe(1)
  })

  test('keeps an active silence when the app is rejected again', () => {
    const silenced = { ...getEmptyDappSpamRecord(), lastRejectedAt: NOW, silencedAt: NOW }

    expect(recordRejection(silenced, NOW + 1).silencedAt).toBe(NOW)
  })

  test('keeps an active silence even when the counters start over', () => {
    const silenced = { ...getEmptyDappSpamRecord(), silencedAt: NOW }
    const record = recordRejection(silenced, NOW + DAPP_REJECT_TRACKING_WINDOW)

    expect(record.rejectedCount).toBe(1)
    expect(record.silencedAt).toBe(NOW)
  })
})

describe('shouldOfferSilence', () => {
  test('stays off for an app that has never been rejected', () => {
    expect(shouldOfferSilence(undefined, NOW)).toBe(false)
  })

  test('stays off below the rejection threshold', () => {
    let record = recordRejection(undefined, NOW)

    for (let i = 1; i < DAPP_REJECTS_BEFORE_OFFERING_SILENCE - 1; i += 1) {
      record = recordRejection(record, NOW)
    }

    expect(record.rejectedCount).toBe(DAPP_REJECTS_BEFORE_OFFERING_SILENCE - 1)
    expect(shouldOfferSilence(record, NOW)).toBe(false)
  })

  test('stays off when the app asks again for what the user rejected once', () => {
    const rejectedOnce = recordRejection(undefined, NOW)

    expect(rejectedOnce.rejectedCount).toBe(1)
    expect(shouldOfferSilence(rejectedOnce, NOW + 1)).toBe(false)
  })

  test('turns on at the rejection threshold', () => {
    let record = recordRejection(undefined, NOW)

    for (let i = 1; i < DAPP_REJECTS_BEFORE_OFFERING_SILENCE; i += 1) {
      record = recordRejection(record, NOW)
    }

    expect(shouldOfferSilence(record, NOW)).toBe(true)
  })

  test('counts rejections of different requests, so varying the payload does not help', () => {
    const first = recordRejection(undefined, NOW)
    const second = recordRejection(first, NOW + 1)

    expect(shouldOfferSilence(second, NOW + 2)).toBe(true)
  })

  test('turns back off once the tracking window has passed', () => {
    const first = recordRejection(undefined, NOW)
    const second = recordRejection(first, NOW)

    expect(shouldOfferSilence(second, NOW + DAPP_REJECT_TRACKING_WINDOW - 1)).toBe(true)
    expect(shouldOfferSilence(second, NOW + DAPP_REJECT_TRACKING_WINDOW)).toBe(false)
  })
})

describe('isSilenced', () => {
  test('is off for an app the user never silenced', () => {
    expect(isSilenced(undefined, NOW)).toBe(false)
    expect(isSilenced(getEmptyDappSpamRecord(), NOW)).toBe(false)
  })

  test('lasts exactly the silence duration', () => {
    const record = { ...getEmptyDappSpamRecord(), silencedAt: NOW }

    expect(isSilenced(record, NOW)).toBe(true)
    expect(isSilenced(record, NOW + DAPP_SILENCE_DURATION - 1)).toBe(true)
    expect(isSilenced(record, NOW + DAPP_SILENCE_DURATION)).toBe(false)
  })
})

describe('getDappIdsFromUserRequest', () => {
  test('has no app behind a request the wallet raised itself', () => {
    expect(getDappIdsFromUserRequest(makeMessageRequest('Hello'))).toEqual([])
  })

  test('lists every app in a batch exactly once', () => {
    const request = {
      ...makeCallsRequest([]),
      dappPromises: [
        { session: makeSession('example.com') },
        { session: makeSession('other.com') },
        { session: makeSession('example.com') }
      ]
    } as unknown as UserRequest

    expect(getDappIdsFromUserRequest(request)).toEqual(['example.com', 'other.com'])
  })
})
