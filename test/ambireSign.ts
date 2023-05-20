const { ethers } = require("ethers")

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
 * SIGMODE_CANCEL
 *
 * @param BytesLike sig
 * @returns BytesLike
 */
function wrapCancel(sig: string) {
  return `${sig}${'fe'}`
}

export {
  wrapEIP712,
  wrapEthSign,
  wrapSchnorr,
  wrapMultiSig,
  wrapRecover,
  wrapCancel
}