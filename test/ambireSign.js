/**
 * SignatureMode.EIP712 sign
 *
 * @param BytesLike sig
 * @returns BytesLike
 */
function wrapEIP712(sig) {
  return `${sig}${'00'}`
}

/**
 * SignatureMode.EthSign sign
 *
 * @param BytesLike sig
 * @returns BytesLike
 */
function wrapEthSign(sig) {
  return `${sig}${'01'}`
}

/**
 * SignatureMode.Schnorr sign
 *
 * @param BytesLike sig
 * @returns BytesLike
 */
function wrapSchnorr(sig) {
  return `${sig}${'04'}`
}

/**
 * SignatureMode.Multisig sign
 *
 * @param BytesLike sig
 * @returns BytesLike
 */
function wrapMultiSig(sig) {
  return `${sig}${'05'}`
}

/**
 * SIGMODE_RECOVER
 *
 * @param BytesLike sig
 * @returns BytesLike
 */
function wrapRecover(sig) {
  return `${sig}${'fe'}`
}

module.exports = {
  wrapEIP712,
  wrapEthSign,
  wrapSchnorr,
  wrapMultiSig,
  wrapRecover
}