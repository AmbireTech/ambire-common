export const ERC7730_CALLDATA_INDEX_RELAYER_PATH = '/v2/erc7730/account-op'
export const ERC7730_EIP712_INDEX_RELAYER_PATH = '/v2/erc7730/eip-712'
export const ERC7730_DESCRIPTOR_PATH = '/v2/erc7730/fetch-descriptor'

// how long do we wait to do another fetch
export const ERC7730_CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

// people don't change their singleton on a whim
export const SAFE_SINGLETON_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000 // 14 days

// the max time we wait to visualize erc-7730 before going to the fallback
export const ERC7730_DESCRIPTOR_WAIT_MS = 4000

export const ERC20_APPROVE_SELECTOR = '0x095ea7b3'
export const ERC20_TRANSFER_SELECTOR = '0xa9059cbb'
export const PERMIT2_APPROVE_SELECTOR = '0x87517c45'
export const PERMIT2_ADDRESS = '0x000000000022d473030f116ddee9f6b43ac78ba3'
export const SAFE_TX_PRIMARY_TYPE = 'SafeTx'
export const SAFE_PROXY_SINGLETON_SLOT = 0n

// How many levels of calls embedded in other calls are shown in the UI. The humanizer
// itself decodes all the levels, so that the warnings of the deeply embedded calls are
// not lost, but showing all of them makes the transaction impossible to read.
export const MAX_DISPLAYED_NESTED_CALLDATA_DEPTH = 4

// Descriptors are the bulk of the cached data and the whole blob is rewritten whenever a new one
// arrives, so the count is capped and the least recently used are dropped past it. Sized to stay
// well inside the extension's storage quota at a few tens of KB per descriptor.
export const ERC7730_MAX_CACHED_DESCRIPTORS = 150
