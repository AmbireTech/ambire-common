import { Hex } from '../../interfaces/hex';
import { EIP7702Signature } from '../../interfaces/signatures';
export declare function get7702SigV(signature: EIP7702Signature): Hex;
export declare const EIP_1271_NOT_SUPPORTED_BY: string[];
/**
 * Tries to convert an input (from a dapp) to a hex string
 */
export declare const toPersonalSignHex: (input: string | Uint8Array | Hex) => Hex;
//# sourceMappingURL=utils.d.ts.map