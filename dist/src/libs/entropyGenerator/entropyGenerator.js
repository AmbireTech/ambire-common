"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EntropyGenerator = void 0;
/* eslint-disable no-bitwise */
const ethers_1 = require("ethers");
// Custom entropy generator that enhances ethers' randomBytes by incorporating:
// - Time-based entropy for additional randomness.
// - Optional extra entropy (like mouse position, timestamp...) provided by the user for added security.
// This helps improve the security of mainKey generation and random seed phrase creation.
class EntropyGenerator {
    #entropyPool = new Uint8Array(0);
    generateRandomBytes(length, extraEntropy) {
        this.#resetEntropyPool();
        this.#collectCryptographicEntropy(length);
        this.#collectTimeEntropy();
        if (extraEntropy) {
            const encoder = new TextEncoder();
            const uint8Array = encoder.encode(extraEntropy);
            this.addEntropy(uint8Array);
        }
        if (this.#entropyPool.length === 0)
            throw new Error('Entropy pool is empty');
        const hash = (0, ethers_1.getBytes)((0, ethers_1.keccak256)(this.#entropyPool));
        const randomBytesGenerated = (0, ethers_1.randomBytes)(length);
        // Introduces additional entropy mixing via XOR
        for (let i = 0; i < length; i++) {
            randomBytesGenerated[i] ^= hash[i % hash.length];
        }
        return randomBytesGenerated;
    }
    generateRandomMnemonic(wordCount, extraEntropy) {
        const wordCountToBytesLength = { 12: 16, 24: 32 };
        const bytesLength = wordCountToBytesLength[wordCount] || 16; // defaults to 12-word phrase
        const entropy = this.generateRandomBytes(bytesLength, extraEntropy);
        const mnemonic = ethers_1.Mnemonic.fromEntropy(entropy, '', ethers_1.LangEn.wordlist());
        return mnemonic;
    }
    #collectTimeEntropy() {
        // TODO: steps to add support for the mobile app:
        // 1. install the polyfill: `yarn add react-native-performance`
        // 2. add it globally in a top-level file:
        // if (typeof performance === "undefined") {
        //   global.performance = { now }
        // }
        const now = performance.now();
        if (!now)
            return;
        const timeEntropy = new Uint8Array(new Float64Array([now]).buffer);
        this.addEntropy(timeEntropy);
    }
    #collectCryptographicEntropy(length) {
        this.addEntropy((0, ethers_1.randomBytes)(length));
    }
    addEntropy(newEntropy) {
        this.#entropyPool = new Uint8Array(Buffer.concat([this.#entropyPool, newEntropy]));
    }
    #resetEntropyPool() {
        this.#entropyPool = new Uint8Array(0);
    }
}
exports.EntropyGenerator = EntropyGenerator;
//# sourceMappingURL=entropyGenerator.js.map