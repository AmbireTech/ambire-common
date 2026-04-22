import { Signature } from 'ethers'

import { addHexPrefix } from './addHexPrefix'
import { stripHexPrefix } from './stripHexPrefix'

export function normalizeSignatureHex(input: { r?: string; s?: string; v?: number; hex?: string }) {
  if (input.hex) return addHexPrefix(stripHexPrefix(input.hex))

  if (!input.r || !input.s || input.v === undefined) {
    throw new Error('normalizeSignatureHex: missing signature fields')
  }

  try {
    const signature = Signature.from({
      r: input.r,
      s: input.s,
      v: Signature.getNormalizedV(input.v)
    })

    return signature.serialized
  } catch {
    throw new Error('normalizeSignatureHex: invalid signature payload')
  }
}
