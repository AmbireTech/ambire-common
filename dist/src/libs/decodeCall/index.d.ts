import { DecodedCall, RecursivelyDecodedCallData } from '../../interfaces/decodeCall';
import { Call } from '../accountOp/types';
import type { IrCall } from '../humanizer/interfaces';
/** Length of the 0x prefixed function selector at the start of call data. */
export declare const CALLDATA_SELECTOR_HEX_LENGTH = 10;
export declare function decodeCall(data: Call['data'], foundSignatures: {
    signature: string;
}[]): DecodedCall | null;
/**
 * Decodes call data with the signatures known for its selector, then keeps decoding every
 * argument that is call data itself. `getSignatures` gives the known signatures of a selector,
 * or an empty list. Nothing is fetched, so the result also lists every selector that was looked
 * up, letting the caller fetch the unknown ones and decode again.
 */
export declare function decodeCallDataRecursively(data: string, getSignatures: (selector: string) => {
    signature: string;
}[]): RecursivelyDecodedCallData;
/**
 * Returns the calls with `decodedCall` set from `getDecodedCall`, which is asked once per
 * distinct call data and gives null when the data can't be decoded. A call that isn't decoded
 * gets `isDecodingCall` when `isDecoding` says its signatures are still on the way. Calls that
 * come out the same are kept as they are, and so is the whole array when none of them changed,
 * so a caller that re-renders on a reference change only does so when the decoding actually
 * changed.
 */
export declare function withDecodedCalls(calls: IrCall[], getDecodedCall: (data: string) => DecodedCall | null, isDecoding: (data: string) => boolean): IrCall[];
//# sourceMappingURL=index.d.ts.map