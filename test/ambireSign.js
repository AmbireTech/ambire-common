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

module.exports = {
  wrapEIP712,
  wrapSchnorr,
  wrapMultiSig
}