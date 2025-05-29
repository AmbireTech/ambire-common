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
    scrypt(password: ArrayLike<number>, salt: Uint8Array, params: NormalizedScryptParams): Promise<Uint8Array>;
}
//# sourceMappingURL=scryptAdapter.d.ts.map