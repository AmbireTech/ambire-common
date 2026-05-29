import { scrypt as scryptJs } from 'scrypt-js';
import { scrypt as nobleScrypt } from '@noble/hashes/scrypt';
export class ScryptAdapter {
    #platform = 'default';
    constructor(platform) {
        this.#platform = platform;
    }
    async scrypt(password, salt, params) {
        const { N, r, p, dkLen } = params;
        if (this.#platform === 'browser-gecko') {
            // noble/hashes scrypt returns Uint8Array directly
            return nobleScrypt(password, salt, { N, r, p, dkLen });
        }
        // scrypt-js returns Promise<ArrayLike<number>>
        const result = await scryptJs(password, salt, N, r, p, dkLen, () => { });
        return new Uint8Array(result);
    }
}
//# sourceMappingURL=scryptAdapter.js.map