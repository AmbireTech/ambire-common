import { scrypt as scryptJs } from 'scrypt-js'

import { scrypt as nobleScrypt } from '@noble/hashes/scrypt'

import { Platform } from '../../interfaces/platform'

export type NormalizedScryptParams = { N: number; r: number; p: number; dkLen: number }

export class ScryptAdapter {
  #platform: Platform = 'default'

  constructor(platform: Platform) {
    this.#platform = platform
  }

  async scrypt(
    password: Uint8Array<ArrayBufferLike>,
    salt: Uint8Array,
    params: NormalizedScryptParams
  ): Promise<Uint8Array> {
    const { N, r, p, dkLen } = params

    if (this.#platform === 'browser-gecko') {
      // noble/hashes scrypt returns Uint8Array directly
      return nobleScrypt(password, salt, { N, r, p, dkLen })
    }

    // scrypt-js returns Promise<ArrayLike<number>>
    const result = await scryptJs(password, salt, N, r, p, dkLen, () => {})
    return new Uint8Array(result)
  }
}
