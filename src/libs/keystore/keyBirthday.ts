import { StoredKey } from '@/interfaces/keystore'

/**
 * Gives every internal key a birthday, assuming today for the ones that have none.
 *
 * Keys stored before the wallet recorded birthdays carry no flag at all, and an unknown birthday
 * forces anything that scans the chain for an address to start at the beginning of it. Assuming
 * today is right for almost all of them: the feature that creates notes worth scanning for shipped
 * alongside the flag, so an address without one has had no chance to accumulate anything.
 *
 * The assumption is marked as such via `isBirthdayAssumed`, so a scan that comes up empty can be
 * told apart from one that started too late - see `InternalKey['meta'].hasNoPriorHistory`.
 *
 * An existing `createdAt` is kept rather than overwritten with today. It is the earlier of the two
 * and therefore the safer one: a birthday set too early only costs scanning time, while one set
 * too late silently misses the user's own funds.
 *
 * Returns whether anything changed so the caller can skip a pointless write - after the first run
 * there is nothing left to fill in.
 */
export const backfillKeyBirthdays = (
  keys: StoredKey[],
  now: number = Date.now()
): { keys: StoredKey[]; hasBackfilled: boolean } => {
  let hasBackfilled = false

  const nextKeys = keys.map((key) => {
    if (key.type !== 'internal' || key.meta.hasNoPriorHistory !== undefined) return key

    hasBackfilled = true

    return {
      ...key,
      meta: {
        ...key.meta,
        createdAt: key.meta.createdAt ?? now,
        hasNoPriorHistory: true,
        isBirthdayAssumed: true
      }
    }
  })

  return { keys: nextKeys, hasBackfilled }
}
