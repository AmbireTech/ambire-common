import { Hex } from '../interfaces/hex';
export interface Custom7702Settings {
    [chainId: string]: {
        implementation: Hex;
    };
}
export declare const networks7702: Custom7702Settings;
export interface EIP7702Auth {
    address: Hex;
    chainId: Hex;
    nonce: Hex;
    r: Hex;
    s: Hex;
    v: Hex;
    yParity: Hex;
}
//# sourceMappingURL=7702.d.ts.map