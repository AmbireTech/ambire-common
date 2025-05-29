"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScryptAdapter = void 0;
const scrypt_js_1 = require("scrypt-js");
const scrypt_1 = require("@noble/hashes/scrypt");
class ScryptAdapter {
    #platform = 'default';
    constructor(platform) {
        this.#platform = platform;
    }
    async scrypt(password, salt, params) {
        const { N, r, p, dkLen } = params;
        if (this.#platform === 'browser-gecko') {
            // noble/hashes scrypt returns Uint8Array directly
            return (0, scrypt_1.scrypt)(Uint8Array.from(password), salt, { N, r, p, dkLen });
        }
        // scrypt-js returns Promise<ArrayLike<number>>
        const result = await (0, scrypt_js_1.scrypt)(password, salt, N, r, p, dkLen, () => { });
        return new Uint8Array(result);
    }
}
exports.ScryptAdapter = ScryptAdapter;
//# sourceMappingURL=scryptAdapter.js.map