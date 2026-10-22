"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAssetPreferenceId = void 0;
/** Identifies a token, a collection or a single collectible of a collection */
const getAssetPreferenceId = ({ address, chainId, tokenId }) => `${chainId}-${address.toLowerCase()}${typeof tokenId === 'bigint' ? `-${tokenId}` : ''}`;
exports.getAssetPreferenceId = getAssetPreferenceId;
//# sourceMappingURL=customToken.js.map