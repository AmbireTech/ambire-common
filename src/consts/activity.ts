/**
 * How long the refresh after a confirmed transaction waits for the RPC to reach the block of the
 * transaction. After that it refreshes anyway.
 */
export const CONFIRMED_BLOCK_WAIT_TIMEOUT_MS = 10 * 1000 // 10 seconds

/**
 * After this time Activity marks a sent Relayer or bundler op that is still not confirmed as
 * stuck, and stops waiting for it. So does it for a raw txn that is not in the mempool anymore,
 * while one that is still in the mempool is awaited until it is mined or dropped.
 */
export const ACCOUNT_OP_PENDING_TIMEOUT_MINS = 30
