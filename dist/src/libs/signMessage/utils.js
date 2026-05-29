import { toBeHex } from 'ethers';
export function get7702SigV(signature) {
    return BigInt(signature.yParity) === 0n ? toBeHex(27) : toBeHex(28);
}
//# sourceMappingURL=utils.js.map