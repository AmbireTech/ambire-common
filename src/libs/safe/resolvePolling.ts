import {
  SAFE_RESOLVE_INACTIVE_INTERVAL,
  SAFE_RESOLVE_MAX_ACTIVE_INTERVAL,
  SAFE_RESOLVE_MAX_INACTIVE_INTERVAL,
  SAFE_RESOLVE_UNCHANGED_CHECKS_BEFORE_BACKOFF
} from '../../consts/intervals'

/**
 * What the last check for resolved Safe txns or messages found. `fingerprint` describes the
 * requests that were checked and what the Safe API answered for them, and is undefined when
 * there was nothing to check.
 */
export type SafeResolvePollState = {
  fingerprint?: string
  unchangedChecksCount: number
}

export const INITIAL_SAFE_RESOLVE_POLL_STATE: SafeResolvePollState = { unchangedChecksCount: 0 }

/**
 * Builds a fingerprint out of the parts describing one check. The parts are sorted, so the
 * order the requests or the API results come in doesn't count as a change.
 */
export function toSafeResolveFingerprint(parts: string[]): string {
  return [...parts].sort().join('|')
}

/**
 * Counts how many checks in a row found the same thing. A check with nothing to look at
 * starts the count over, so the first check after a request appears runs at the base interval.
 */
export function getNextSafeResolvePollState(
  previous: SafeResolvePollState,
  fingerprint: string | undefined
): SafeResolvePollState {
  if (fingerprint === undefined) return INITIAL_SAFE_RESOLVE_POLL_STATE
  if (previous.fingerprint !== fingerprint) return { fingerprint, unchangedChecksCount: 0 }

  return { fingerprint, unchangedChecksCount: previous.unchangedChecksCount + 1 }
}

/**
 * Returns the delay until the next check for resolved Safe txns or messages. The checks run
 * at `activeTimeout` while a wallet window is open and slower while none is. Once
 * `SAFE_RESOLVE_UNCHANGED_CHECKS_BEFORE_BACKOFF` checks in a row find nothing new, the
 * delay doubles with each further one, up to a maximum.
 */
export function getSafeResolveTimeout({
  activeTimeout,
  isUiActive,
  unchangedChecksCount
}: {
  activeTimeout: number
  isUiActive: boolean
  unchangedChecksCount: number
}): number {
  const baseTimeout = isUiActive ? activeTimeout : SAFE_RESOLVE_INACTIVE_INTERVAL
  const maxTimeout = isUiActive
    ? SAFE_RESOLVE_MAX_ACTIVE_INTERVAL
    : SAFE_RESOLVE_MAX_INACTIVE_INTERVAL
  const backoffSteps = unchangedChecksCount - SAFE_RESOLVE_UNCHANGED_CHECKS_BEFORE_BACKOFF + 1
  if (backoffSteps <= 0) return baseTimeout

  return Math.min(baseTimeout * 2 ** backoffSteps, maxTimeout)
}
