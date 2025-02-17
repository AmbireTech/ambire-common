/* eslint-disable no-bitwise */
import { getBytes, keccak256, LangEn, Mnemonic, randomBytes } from 'ethers'

export class EntropyGenerator {
  #entropyPool: Uint8Array = new Uint8Array(0)

  generateRandomBytes(length: number, extraEntropy: string): Uint8Array {
    this.#resetEntropyPool()
    this.#collectSystemNoiseEntropy(length)
    this.#collectTimeEntropy()

    if (extraEntropy) {
      const encoder = new TextEncoder()
      const uint8Array = encoder.encode(extraEntropy)
      this.addEntropy(uint8Array)
    }

    if (this.#entropyPool.length === 0) throw new Error('Entropy pool is empty')

    const hash = getBytes(keccak256(this.#entropyPool))
    const randomBytesGenerated = randomBytes(length)
    // ensures non-deterministic final output
    for (let i = 0; i < length; i++) {
      randomBytesGenerated[i] ^= hash[i % hash.length]
    }

    return randomBytesGenerated
  }

  generateRandomMnemonic(wordCount: 12 | 24, extraEntropy: string): Mnemonic {
    const wordCountToBytesLength = { 12: 16, 24: 32 }
    const bytesLength = wordCountToBytesLength[wordCount] || 16
    const entropy = this.generateRandomBytes(bytesLength, extraEntropy)
    const mnemonic = Mnemonic.fromEntropy(entropy, '', LangEn.wordlist())
    return mnemonic
  }

  #collectTimeEntropy(): void {
    const now = performance.now()

    if (!now) return

    const timeEntropy = new Uint8Array(new Float64Array([now]).buffer)
    this.addEntropy(timeEntropy)
  }

  #collectSystemNoiseEntropy(length: number): void {
    this.addEntropy(randomBytes(length))
  }

  addEntropy(newEntropy: Uint8Array): void {
    const combined = new Uint8Array(this.#entropyPool.length + newEntropy.length)
    combined.set(this.#entropyPool)
    combined.set(newEntropy, this.#entropyPool.length)
    this.#entropyPool = combined
  }

  #resetEntropyPool() {
    this.#entropyPool = new Uint8Array(0)
  }
}
