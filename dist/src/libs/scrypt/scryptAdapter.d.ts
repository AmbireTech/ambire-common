import { Platform } from '../../interfaces/platform';
export type NormalizedScryptParams = {
    N: number;
    r: number;
    p: number;
    dkLen: number;
};
export declare class ScryptAdapter {
    #private;
    constructor(platform: Platform);
    /**
     * Whether the derivation runs on a thread other than the caller's. True only on
     * mobile, where scrypt-js is swapped for a native implementation that resolves
     * from a background thread. Everywhere else the derivation holds the calling
     * thread, so callers have to yield around it to keep the UI responsive.
     */
    get runsOffCallerThread(): boolean;
    scrypt(password: Uint8Array<ArrayBufferLike>, salt: Uint8Array, params: NormalizedScryptParams): Promise<Uint8Array>;
}
//# sourceMappingURL=scryptAdapter.d.ts.map