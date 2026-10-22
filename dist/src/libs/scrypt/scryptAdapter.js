"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScryptAdapter = void 0;
const scrypt_js_1 = require("scrypt-js");
const scrypt_1 = require("@noble/hashes/scrypt");
const hash_wasm_1 = require("hash-wasm");
// Check once whether WebAssembly can run here by compiling an empty module.
// True in normal browsers and even when JIT optimization is turned off, false
// only in the rare case where the browser blocks WASM entirely.
let isWasmSupportedCache = null;
const isWasmSupported = () => {
    if (isWasmSupportedCache !== null)
        return isWasmSupportedCache;
    try {
        const probeModule = new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
        isWasmSupportedCache = probeModule instanceof WebAssembly.Module;
    }
    catch {
        isWasmSupportedCache = false;
    }
    return isWasmSupportedCache;
};
class ScryptAdapter {
    #platform = 'default';
    constructor(platform) {
        this.#platform = platform;
    }
    /**
     * Whether the derivation runs on a thread other than the caller's. True only on
     * mobile, where scrypt-js is swapped for a native implementation that resolves
     * from a background thread. Everywhere else the derivation holds the calling
     * thread, so callers have to yield around it to keep the UI responsive.
     */
    get runsOffCallerThread() {
        return this.#isMobile;
    }
    get #isMobile() {
        return this.#platform === 'mobile-android' || this.#platform === 'mobile-ios';
    }
    async scrypt(password, salt, params) {
        const { N, r, p, dkLen } = params;
        // On mobile, scrypt-js is swapped for a fast native implementation, so use it.
        if (this.#isMobile) {
            // scrypt-js returns Promise<ArrayLike<number>>
            const result = await (0, scrypt_js_1.scrypt)(password, salt, N, r, p, dkLen, () => { });
            return new Uint8Array(result);
        }
        // In the browser, prefer WASM. The browser has no built-in scrypt, so it
        // runs as our own code. In JavaScript that becomes ~45s (vs ~0.3s) when the
        // user turns off JIT optimization for security, a setting WASM ignores.
        // hash-wasm gives the exact same bytes as the JS versions.
        if (isWasmSupported()) {
            try {
                return await (0, hash_wasm_1.scrypt)({
                    password,
                    salt,
                    costFactor: N,
                    blockSize: r,
                    parallelism: p,
                    hashLength: dkLen,
                    outputType: 'binary'
                });
            }
            catch {
                // If WASM unexpectedly fails to run, fall back to JS below.
            }
        }
        // No WASM available. noble is the fastest JS option; it's slow without JIT,
        // but nothing in the browser can do better since there's no native scrypt.
        return (0, scrypt_1.scrypt)(password, salt, { N, r, p, dkLen });
    }
}
exports.ScryptAdapter = ScryptAdapter;
//# sourceMappingURL=scryptAdapter.js.map