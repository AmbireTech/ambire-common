/* eslint-disable no-bitwise */
import { getBytes, keccak256, LangEn, Mnemonic, randomBytes } from 'ethers'

// Custom entropy generator that enhances ethers' randomBytes by incorporating:
// - Time-based entropy for additional randomness.
// - Optional extra entropy (like mouse position, timestamp...) provided by the user for added security.
// This helps improve the security of mainKey generation and random seed phrase creation.
export class EntropyGenerator {
  #entropyPool: Uint8Array = new Uint8Array(0)

  generateRandomBytes(length: number, extraEntropy: string): Uint8Array {
    this.#resetEntropyPool()
    this.#collectCryptographicEntropy(length)
    this.#collectTimeEntropy()

    if (extraEntropy) {
      const encoder = new TextEncoder()
      const uint8Array = encoder.encode(extraEntropy)
      this.addEntropy(uint8Array)
    }

    if (this.#entropyPool.length === 0) throw new Error('Entropy pool is empty')

    const hash = getBytes(keccak256(this.#entropyPool))
    const randomBytesGenerated = randomBytes(length)
    // Introduces additional entropy mixing via XOR
    for (let i = 0; i < length; i++) {
      randomBytesGenerated[i] ^= hash[i % hash.length]
    }

    return randomBytesGenerated
  }

  generateRandomMnemonic(wordCount: 12 | 24, extraEntropy: string): Mnemonic {
    const wordCountToBytesLength = { 12: 16, 24: 32 }
    const bytesLength = wordCountToBytesLength[wordCount] || 16 // defaults to 12-word phrase
    const entropy = this.generateRandomBytes(bytesLength, extraEntropy)
    const mnemonic = Mnemonic.fromEntropy(entropy, '', LangEn.wordlist())
    return mnemonic
  }

  #collectTimeEntropy(): void {
    // TODO: steps to add support for the mobile app:
    // 1. install the polyfill: `yarn add react-native-performance`
    // 2. add it globally in a top-level file:
    // if (typeof performance === "undefined") {
    //   global.performance = { now }
    // }
    const now = performance.now()

    if (!now) return

    const timeEntropy = new Uint8Array(new Float64Array([now]).buffer)
    this.addEntropy(timeEntropy)
  }

  #collectCryptographicEntropy(length: number): void {
    this.addEntropy(randomBytes(length))
  }

  addEntropy(newEntropy: Uint8Array): void {
    this.#entropyPool = new Uint8Array(Buffer.concat([this.#entropyPool, newEntropy]))
  }

  #resetEntropyPool() {
    this.#entropyPool = new Uint8Array(0)
  }
}
