import { hexlify, isHexString, toBeHex, toUtf8Bytes } from 'ethers'

import { Hex } from '../../interfaces/hex'
import { EIP7702Signature } from '../../interfaces/signatures'

export function get7702SigV(signature: EIP7702Signature): Hex {
  return BigInt(signature.yParity) === 0n ? (toBeHex(27) as Hex) : (toBeHex(28) as Hex)
}

export const EIP_1271_NOT_SUPPORTED_BY = [
  'opensea.io',
  'paraswap.xyz',
  'blur.io',
  'aevo.xyz',
  'socialscan.io',
  'tally.xyz',
  'questn.com',
  'taskon.xyz',
  'hyperliquid.xyz',
  'bitrefill.com'
]

/**
 * Tries to convert an input (from a dapp) to a hex string
 */
export const toPersonalSignHex = (input: string | Uint8Array | Hex): Hex => {
  if (typeof input === 'string') {
    return isHexString(input) ? input : (hexlify(toUtf8Bytes(input)) as Hex)
  }

  return hexlify(input) as Hex
}
