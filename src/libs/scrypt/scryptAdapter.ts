import { scrypt as scryptJs } from 'scrypt-js'

import { scrypt as nobleScrypt } from '@noble/hashes/scrypt'
import { scrypt as wasmScrypt } from 'hash-wasm'

import { Platform } from '../../interfaces/platform'

export type NormalizedScryptParams = { N: number; r: number; p: number; dkLen: number }

// Check once whether WebAssembly can run here by compiling an empty module.
// True in normal browsers and even when JIT optimization is turned off, false
// only in the rare case where the browser blocks WASM entirely.
let isWasmSupportedCache: boolean | null = null
const isWasmSupported = (): boolean => {
  if (isWasmSupportedCache !== null) return isWasmSupportedCache
  try {
    const probeModule = new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))
    isWasmSupportedCache = probeModule instanceof WebAssembly.Module
  } catch {
    isWasmSupportedCache = false
  }
  return isWasmSupportedCache
}

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

    const isMobile = this.#platform === 'mobile-android' || this.#platform === 'mobile-ios'

    // On mobile, scrypt-js is swapped for a fast native implementation, so use it.
    if (isMobile) {
      // scrypt-js returns Promise<ArrayLike<number>>
      const result = await scryptJs(password, salt, N, r, p, dkLen, () => {})
      return new Uint8Array(result)
    }

    // In the browser, prefer WASM. The browser has no built-in scrypt, so it
    // runs as our own code. In JavaScript that becomes ~45s (vs ~0.3s) when the
    // user turns off JIT optimization for security, a setting WASM ignores.
    // hash-wasm gives the exact same bytes as the JS versions.
    if (isWasmSupported()) {
      try {
        return await wasmScrypt({
          password,
          salt,
          costFactor: N,
          blockSize: r,
          parallelism: p,
          hashLength: dkLen,
          outputType: 'binary'
        })
      } catch {
        // If WASM unexpectedly fails to run, fall back to JS below.
      }
    }

    // No WASM available. noble is the fastest JS option; it's slow without JIT,
    // but nothing in the browser can do better since there's no native scrypt.
    return nobleScrypt(password, salt, { N, r, p, dkLen })
  }
}
