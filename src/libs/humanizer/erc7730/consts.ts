export const ERC7730_CALLDATA_INDEX_RELAYER_PATH = '/v2/erc7730/account-op'
export const ERC7730_EIP712_INDEX_RELAYER_PATH = '/v2/erc7730/eip-712'
export const ERC7730_DESCRIPTOR_PATH = '/v2/erc7730/fetch-descriptor'
export const ERC7730_CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
// people don't change their singleton on a whim
export const SAFE_SINGLETOn_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000 // 14 days

export const ERC20_APPROVE_SELECTOR = '0x095ea7b3'
export const ERC20_TRANSFER_SELECTOR = '0xa9059cbb'
export const PERMIT2_APPROVE_SELECTOR = '0x87517c45'
export const PERMIT2_ADDRESS = '0x000000000022d473030f116ddee9f6b43ac78ba3'
export const SAFE_TX_PRIMARY_TYPE = 'SafeTx'
export const SAFE_PROXY_SINGLETON_SLOT = 0n
