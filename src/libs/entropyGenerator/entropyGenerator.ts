/* eslint-disable no-bitwise */
import { getBytes, keccak256, randomBytes } from 'ethers'

export class EntropyGenerator {
  #entropyPool: Uint8Array = new Uint8Array(0)

  generateRandomBytes(length: number, extraEntropy: Uint8Array | null): Uint8Array {
    this.#addSystemNoiseEntropy()
    this.#addTimeEntropy()

    if (extraEntropy) this.addEntropy(extraEntropy)

    if (this.#entropyPool.length === 0) throw new Error('Entropy pool is empty')

    const hash = getBytes(keccak256(this.#entropyPool))
    const randomBytesGenerated = randomBytes(length)
    for (let i = 0; i < length; i++) {
      randomBytesGenerated[i] ^= hash[i % hash.length]
    }

    return randomBytesGenerated
  }

  #addTimeEntropy(): void {
    const now = performance.now()

    if (!now) return

    const timeEntropy = new Uint8Array(new Float64Array([now]).buffer)
    console.log('addTimeEntropy', timeEntropy)
    this.addEntropy(timeEntropy)
  }

  #addSystemNoiseEntropy(): void {
    const systemNoise = randomBytes(16)
    this.addEntropy(systemNoise)
  }

  addEntropy(newEntropy: Uint8Array): void {
    const combined = new Uint8Array(this.#entropyPool.length + newEntropy.length)
    combined.set(this.#entropyPool)
    combined.set(newEntropy, this.#entropyPool.length)
    this.#entropyPool = combined
  }
}
