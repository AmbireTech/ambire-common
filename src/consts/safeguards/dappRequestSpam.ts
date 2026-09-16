/** How long a rejection keeps counting against the app that sent it. */
export const DAPP_REJECT_TRACKING_WINDOW = 60 * 1000

/** Rejections within the tracking window before the app is treated as spamming. */
export const DAPP_REJECTS_BEFORE_OFFERING_SILENCE = 2

/** How long an app stays silenced after the user silences it. */
export const DAPP_SILENCE_DURATION = 60 * 1000

/**
 * How many transactions from apps one request can hold. Everything an app sends for the same
 * account and chain collects into a single request, and every addition re-estimates and
 * re-simulates all of it, so an app firing in a loop would otherwise grow one request until
 * the wallet crawls.
 */
export const MAX_DAPP_CALLS_PER_REQUEST = 100
