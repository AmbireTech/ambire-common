import { ethers } from "ethers"

// TODO: change to original address once deployed
export const DKIM_VALIDATOR_ADDR = '0x0000000000000000000000000000000000000000'

export const RECOVERY_DEFAULTS = {
    emailTo: 'tt469695@gmail.com', // TODO: change with the relayer value
    acceptUnknownSelectors: true,
    waitUntilAcceptAdded: 0n,
    waitUntilAcceptRemoved: 0n,
    acceptEmptyDKIMSig: false,
    acceptEmptySecondSig: false,
    onlyOneSigTimelock: 259200n, // 3 days
}

export const knownSelectors = {
    'gmail.com': '20230601',
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
    'dkim',
]

export function getSignerKey(validatorAddr: any, validatorData: any) {
    const abiCoder = new ethers.AbiCoder()
    const hash = ethers.keccak256(
      abiCoder.encode(['address', 'bytes'], [validatorAddr, validatorData])
    )
    const signerKey = `0x${hash.slice(hash.length - 40, hash.length)}`
    return { signerKey, hash }
  }