import { AbiCoder, hexlify, Interface } from 'ethers'

import { AccountCreation } from '../../interfaces/account'
import hexStringToUint8Array from '../../utils/hexStringToUint8Array'

/**
 * Produce EIP6492 signature for Predeploy Contracts
 *
 * More info: https://eips.ethereum.org/EIPS/eip-6492
 *
 * @param {string} signature - origin ERC-1271 signature
 * @param {object} account
 * @returns {string} - EIP6492 signature
 */
export const wrapSignature = (signature: string, creation: AccountCreation) => {
  // EIP6492 signature ends in magicBytes, which ends with a 0x92,
  // which makes it is impossible for it to collide with a valid ecrecover signature if packed in the r,s,v format,
  // as 0x92 is not a valid value for v.
  const magicBytes = '6492649264926492649264926492649264926492649264926492649264926492'

  const ABI = ['function deploy(bytes code, uint256 salt)']
  const iface = new Interface(ABI)
  const factoryCallData = iface.encodeFunctionData('deploy', [creation.bytecode, creation.salt])

  const coder = new AbiCoder()

  // EIP6492 signature
  return (
    coder.encode(
      ['address', 'bytes', 'bytes'],
      [creation.factoryAddr, factoryCallData, signature]
    ) + magicBytes
  )
}

export function mapSignatureV(sigRaw: string) {
  const sig = hexStringToUint8Array(sigRaw)
  if (sig[64] < 27) sig[64] += 27
  return hexlify(sig)
}
