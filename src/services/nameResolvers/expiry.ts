import { ENS_EXPIRY_WARN_WINDOW_IN_MS, NameExpiry } from '@/services/ensDomains/ensDomains'

// Within the warn window before a name expires, re-poll its expiry to catch a renewal.
export const EXPIRY_CLOSE_TO_DEADLINE_POLL_IN_MS = 1 * 60 * 60 * 1000

/**
 * Generic staleness check for a cached name expiry, independent of the naming service:
 * - never fetched -> refetch
 * - far from expiry -> keep it (registration expiries rarely move)
 * - inside the warn window and the cache is old -> refetch to catch a renewal
 *
 * A service whose expiry can move unexpectedly (e.g. ENS wrapped subnames) layers its own rule on
 * top of this via `NameResolver.shouldRefetchExpiry`.
 */
export const isNameExpiryStale = (cachedExpiry: NameExpiry | null | undefined): boolean => {
  if (!cachedExpiry) return true

  // Measured from expiry, not the grace-period end, so it covers the whole time the expiry banner shows.
  const isCloseToDeadline = cachedExpiry.expiresAt - Date.now() < ENS_EXPIRY_WARN_WINDOW_IN_MS
  if (!isCloseToDeadline) return false

  return cachedExpiry.updatedAt + EXPIRY_CLOSE_TO_DEADLINE_POLL_IN_MS < Date.now()
}
