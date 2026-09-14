import { ENS_EXPIRY_WARN_WINDOW_IN_MS, NameExpiry } from '@/services/ensDomains/ensDomains'

// Within this window before the grace-period deadline, re-poll a name's expiry to catch a renewal.
export const EXPIRY_CLOSE_TO_DEADLINE_POLL_IN_MS = 1 * 60 * 60 * 1000

/**
 * Generic staleness check for a cached name expiry, independent of the naming service:
 * - never fetched -> refetch
 * - far from the grace-period deadline -> keep it (registration expiries rarely move)
 * - close to the deadline and the cache is old -> refetch to catch a renewal
 *
 * A service whose expiry can move unexpectedly (e.g. ENS wrapped subnames) layers its own rule on
 * top of this via `NameResolver.shouldRefetchExpiry`.
 */
export const isNameExpiryStale = (cachedExpiry: NameExpiry | null | undefined): boolean => {
  if (!cachedExpiry) return true

  const isCloseToDeadline =
    cachedExpiry.gracePeriodEndsAt - Date.now() < ENS_EXPIRY_WARN_WINDOW_IN_MS
  if (!isCloseToDeadline) return false

  return cachedExpiry.updatedAt + EXPIRY_CLOSE_TO_DEADLINE_POLL_IN_MS < Date.now()
}
