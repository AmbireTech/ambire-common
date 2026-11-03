/**
 * How long the refresh after a confirmed transaction waits for the RPC to reach the block of the
 * transaction. After that it refreshes anyway.
 */
export const CONFIRMED_BLOCK_WAIT_TIMEOUT_MS = 10 * 1000 // 10 seconds

/**
 * How long a new txn skips the nonces of a txn that was just mined. Right after we get the
 * receipt, the RPC node may still be a few blocks behind and return the old txn count. Say an EOA
 * txn with nonce 5 was just mined, but the node still says the next nonce is 5. The new txn would
 * also get 5 and could never be mined. A timer is used, during which time we trust the activity
 * more than the RPC.
 */
export const CONFIRMED_NONCE_SETTLE_MS = 60 * 1000 // 1 minute

/**
 * After this time Activity marks a sent Relayer or bundler op that is still not confirmed as
 * stuck, and stops waiting for it. So does it for a raw txn that is not in the mempool anymore,
 * while one that is still in the mempool is awaited until it is mined or dropped.
 */
export const ACCOUNT_OP_PENDING_TIMEOUT_MINS = 30
