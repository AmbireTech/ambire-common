"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ERC7730_MAX_CACHED_DESCRIPTORS = exports.MAX_DISPLAYED_NESTED_CALLDATA_DEPTH = exports.SAFE_PROXY_SINGLETON_SLOT = exports.SAFE_TX_PRIMARY_TYPE = exports.PERMIT2_ADDRESS = exports.PERMIT2_APPROVE_SELECTOR = exports.ERC20_TRANSFER_SELECTOR = exports.ERC20_APPROVE_SELECTOR = exports.ERC7730_DESCRIPTOR_WAIT_MS = exports.SAFE_SINGLETON_CACHE_TTL_MS = exports.ERC7730_CACHE_TTL_MS = exports.ERC7730_DESCRIPTOR_PATH = exports.ERC7730_EIP712_INDEX_RELAYER_PATH = exports.ERC7730_CALLDATA_INDEX_RELAYER_PATH = void 0;
exports.ERC7730_CALLDATA_INDEX_RELAYER_PATH = '/v2/erc7730/account-op';
exports.ERC7730_EIP712_INDEX_RELAYER_PATH = '/v2/erc7730/eip-712';
exports.ERC7730_DESCRIPTOR_PATH = '/v2/erc7730/fetch-descriptor';
// how long do we wait to do another fetch
exports.ERC7730_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
// people don't change their singleton on a whim
exports.SAFE_SINGLETON_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
// the max time we wait to visualize erc-7730 before going to the fallback
exports.ERC7730_DESCRIPTOR_WAIT_MS = 4000;
exports.ERC20_APPROVE_SELECTOR = '0x095ea7b3';
exports.ERC20_TRANSFER_SELECTOR = '0xa9059cbb';
exports.PERMIT2_APPROVE_SELECTOR = '0x87517c45';
exports.PERMIT2_ADDRESS = '0x000000000022d473030f116ddee9f6b43ac78ba3';
exports.SAFE_TX_PRIMARY_TYPE = 'SafeTx';
exports.SAFE_PROXY_SINGLETON_SLOT = 0n;
// How many levels of calls embedded in other calls are shown in the UI. The humanizer
// itself decodes all the levels, so that the warnings of the deeply embedded calls are
// not lost, but showing all of them makes the transaction impossible to read.
exports.MAX_DISPLAYED_NESTED_CALLDATA_DEPTH = 4;
// Descriptors are the bulk of the cached data and the whole blob is rewritten whenever a new one
// arrives, so the count is capped and the least recently used are dropped past it. Sized to stay
// well inside the extension's storage quota at a few tens of KB per descriptor.
exports.ERC7730_MAX_CACHED_DESCRIPTORS = 150;
//# sourceMappingURL=consts.js.map