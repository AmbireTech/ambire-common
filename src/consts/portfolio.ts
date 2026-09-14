// Different invictus requests can hit different providers so we allow a few blocks of difference
export const DEFAULT_STALE_RPC_BLOCK_THRESHOLD = 10

// Ethereum blocks are ~12s apart, so every tolerated block is a long stretch of stale data
export const ETHEREUM_STALE_RPC_BLOCK_THRESHOLD = 2
