import { AbiCoder, getAddress, keccak256 } from 'ethers'

// TODO: change to original address once deployed
export const DKIM_VALIDATOR_ADDR = '0x0000000000000000000000000000000000000000'

export const RECOVERY_DEFAULTS = {
  emailTo: 'recovery@ambire.com',
  acceptUnknownSelectors: true,
  waitUntilAcceptAdded: 138240n, // 4 days
  waitUntilAcceptRemoved: 138240n, // 4 days
  acceptEmptyDKIMSig: true,
  acceptEmptySecondSig: true,
  onlyOneSigTimelock: 259200n // 3 days
}

export const knownSelectors = {
  'gmail.com': '20230601'
}

export const frequentlyUsedSelectors = [
  'Google',
  'selector1',
  'selector2',
  'everlytickey1',
  'everlytickey2',
  'eversrv',
  'k1',
  'mxvault',
  'dkim'
]

/**
 * Get the signerKey that goes as the address in privileges
 * and its accompanying priv hash for the email recovery
 *
 * @param validatorAddr string
 * @param validatorData BytesLike
 * @returns {Address, bytes32}
 */
export function getSignerKey(validatorAddr: string, validatorData: any) {
  const abiCoder = new AbiCoder()
  const hash = keccak256(abiCoder.encode(['address', 'bytes'], [validatorAddr, validatorData]))
  const signerKey = getAddress(`0x${hash.slice(hash.length - 40, hash.length)}`)
  return { signerKey, hash }
}
