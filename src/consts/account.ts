export const DEFAULT_ACCOUNT_LABEL = 'Account'

/**
 * The delay between reads after a receipt, while the RPC doesn't have the receipt block yet or
 * still returns the state from before it. It starts at the min and doubles up to the max.
 */
export const AFTER_RECEIPT_RETRY_MIN_DELAY_MS = 250
export const AFTER_RECEIPT_RETRY_MAX_DELAY_MS = 2000

/** How long the account state is read again after a receipt, until it counts the confirmed ops. */
export const ACCOUNT_STATE_AFTER_RECEIPT_RETRY_LIMIT_MS = 5 * 1000 // 5 seconds
