import { Signature } from 'ethers'

import { addHexPrefix } from './addHexPrefix'
import { stripHexPrefix } from './stripHexPrefix'

export function normalizeSignatureHex(input: { r?: string; s?: string; v?: number; hex?: string }) {
  if (input.hex) return addHexPrefix(stripHexPrefix(input.hex))

  const signature = Signature.from({
    r: input.r!,
    s: input.s!,
    v: Signature.getNormalizedV(input.v!)
  })

  return signature.serialized
}
