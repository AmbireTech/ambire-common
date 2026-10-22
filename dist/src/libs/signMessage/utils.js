"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toPersonalSignHex = exports.EIP_1271_NOT_SUPPORTED_BY = void 0;
exports.get7702SigV = get7702SigV;
const ethers_1 = require("ethers");
function get7702SigV(signature) {
    return BigInt(signature.yParity) === 0n ? (0, ethers_1.toBeHex)(27) : (0, ethers_1.toBeHex)(28);
}
exports.EIP_1271_NOT_SUPPORTED_BY = [
    'opensea.io',
    'paraswap.xyz',
    'blur.io',
    'aevo.xyz',
    'socialscan.io',
    'tally.xyz',
    'questn.com',
    'taskon.xyz',
    'hyperliquid.xyz',
    'bitrefill.com'
];
/**
 * Tries to convert an input (from a dapp) to a hex string
 */
const toPersonalSignHex = (input) => {
    if (typeof input === 'string') {
        return (0, ethers_1.isHexString)(input) ? input : (0, ethers_1.hexlify)((0, ethers_1.toUtf8Bytes)(input));
    }
    return (0, ethers_1.hexlify)(input);
};
exports.toPersonalSignHex = toPersonalSignHex;
//# sourceMappingURL=utils.js.map