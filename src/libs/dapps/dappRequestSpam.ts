import {
  DAPP_REJECT_TRACKING_WINDOW,
  DAPP_REJECTS_BEFORE_OFFERING_SILENCE,
  DAPP_SILENCE_DURATION
} from '../../consts/safeguards/dappRequestSpam'
import { UserRequest } from '../../interfaces/userRequest'

/**
 * What we remember about one app while it keeps getting rejected.
 */
export interface DappSpamRecord {
  lastRejectedAt: number
  rejectedCount: number
  silencedAt: number | null
}

/** A record for an app that has never been rejected. */
export const getEmptyDappSpamRecord = (): DappSpamRecord => ({
  lastRejectedAt: 0,
  rejectedCount: 0,
  silencedAt: null
})

/**
 * The record after the user rejects one more request from the app. Rejections older than
 * the tracking window don't count, so an app the user refuses once in a while never
 * accumulates suspicion.
 */
export const recordRejection = (
  record: DappSpamRecord | undefined,
  now: number
): DappSpamRecord => {
  const isWithinWindow = !!record && now - record.lastRejectedAt < DAPP_REJECT_TRACKING_WINDOW

  if (!isWithinWindow) {
    return {
      ...getEmptyDappSpamRecord(),
      // The quiet period is the user's own decision and outlives the counters that led to it
      silencedAt: record?.silencedAt ?? null,
      lastRejectedAt: now,
      rejectedCount: 1
    }
  }

  return {
    ...record,
    lastRejectedAt: now,
    rejectedCount: record.rejectedCount + 1
  }
}

/**
 * Whether the app has been refused enough for the user to be offered a way to shut it up.
 * What the app asked for never comes into it: refusing the same request twice and refusing
 * two different ones weigh the same.
 */
export const shouldOfferSilence = (record: DappSpamRecord | undefined, now: number): boolean => {
  if (!record) return false
  if (now - record.lastRejectedAt >= DAPP_REJECT_TRACKING_WINDOW) return false

  return record.rejectedCount >= DAPP_REJECTS_BEFORE_OFFERING_SILENCE
}

/** Whether the app is still inside the quiet period the user put it in. */
export const isSilenced = (record: DappSpamRecord | undefined, now: number): boolean => {
  if (!record?.silencedAt) return false

  return now - record.silencedAt < DAPP_SILENCE_DURATION
}

/**
 * The apps a request came from, deduplicated. Usually one, but a transaction batch keyed by
 * account and chain collects calls from every app asking on that pair, so it can be several -
 * and an empty list for requests the wallet raised itself.
 */
export const getDappIdsFromUserRequest = (userRequest: UserRequest): string[] => {
  const ids = userRequest.dappPromises.map((p) => p.session?.id).filter(Boolean) as string[]

  return [...new Set(ids)]
}
