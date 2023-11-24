import { TypedDataDomain } from 'ethers'
import { ethers } from 'hardhat'

/**
 * SignatureMode.EIP712 sign
 *
 * @param BytesLike sig
 * @returns BytesLike
 */
function wrapEIP712(sig: string) {
  return `${sig}${'00'}`
}

/**
 * SignatureMode.EthSign sign
 *
 * @param BytesLike sig
 * @returns BytesLike
 */
function wrapEthSign(sig: string) {
  return `${sig}${'01'}`
}

/**
 * SignatureMode.Schnorr sign
 *
 * @param BytesLike sig
 * @returns BytesLike
 */
function wrapSchnorr(sig: string) {
  return `${sig}${'04'}`
}

/**
 * SignatureMode.Multisig sign
 *
 * @param BytesLike sig
 * @returns BytesLike
 */
function wrapMultiSig(sig: string) {
  return `${sig}${'05'}`
}

/**
 * SIGMODE_RECOVER
 *
 * @param BytesLike sig
 * @returns BytesLike
 */
function wrapRecover(sig: string) {
  return `${sig}${'ff'}`
}

/**
 * SIGMODE_EXTERNALLY_VALIDATED
 *
 * @param BytesLike sig
 * @returns BytesLike
 */
function wrapExternallyValidated(sig: string) {
  return `${sig}${'ff'}`
}

/**
 * SIGMODE_CANCEL
 *
 * @param BytesLike sig
 * @returns BytesLike
 */
function wrapCancel(sig: string) {
  return `${sig}${'fe'}`
}

function wrapTypedData(chainId: bigint, ambireAccountAddress: string, executeHash: string) {
  const domain: TypedDataDomain = {
    name: 'Ambire',
    version: '1',
    chainId,
    verifyingContract: ambireAccountAddress,
    salt: ethers.toBeHex(0, 32)
  }
  const types = {
    AmbireOperation: [
      { name: 'account', type: 'address' },
      { name: 'hash', type: 'bytes32' }
    ]
  }
  const value = {
    account: ambireAccountAddress,
    hash: executeHash
  }

  return {
    domain,
    types,
    value
  }
}

export {
  wrapEIP712,
  wrapEthSign,
  wrapSchnorr,
  wrapMultiSig,
  wrapRecover,
  wrapCancel,
  wrapExternallyValidated,
  wrapTypedData
}
