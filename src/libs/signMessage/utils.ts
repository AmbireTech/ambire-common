import { toBeHex } from 'ethers'

import { Hex } from '../../interfaces/hex'
import { EIP7702Signature } from '../../interfaces/signatures'

export function get7702SigV(signature: EIP7702Signature): Hex {
  return BigInt(signature.yParity) === 0n ? (toBeHex(27) as Hex) : (toBeHex(28) as Hex)
}
