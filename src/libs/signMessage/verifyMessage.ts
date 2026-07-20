import { AbiCoder, hashMessage, hexlify, JsonRpcProvider } from 'ethers'

import { verifyMessage as signatureValidatorVerifyMessage } from '@ambire/signature-validator'
import { SignTypedDataVersion, TypedDataUtils } from '@metamask/eth-sig-util'

import { Hex } from '../../interfaces/hex'
import { TypedMessageUserRequest } from '../../interfaces/userRequest'
import { callToTuple, getSignableHash } from '../accountOp/accountOp'
import { decodeError } from '../errorDecoder'
import { getErrorCodeStringFromReason } from '../errorDecoder/helpers'
import { adaptTypedMessageForMetaMaskSigUtil, AmbireReadableOperation } from './signMessage'

type Props = {
  provider: JsonRpcProvider
  signer: string
  signature: string | Uint8Array
} & (
  | { message: string | Uint8Array; typedData?: never; authorization?: never }
  | {
      typedData: TypedMessageUserRequest['meta']['params']
      message?: never
      authorization?: never
    }
  | { message?: never; typedData?: never; authorization: Hex }
)

/**
 * Verifies the signature of a message using the provided signer and signature
 * via a "magic" universal validator contract using the provided provider to
 * verify the signature on-chain. The contract deploys itself within the
 * `eth_call`, tries to verify the signature using ERC-6492, ERC-1271, and
 * `ecrecover`, and returns the value to the function.
 *
 * Note: you only need to pass one of: `message` or `typedData`
 */
export async function verifyMessage({
  provider,
  signer,
  signature,
  message,
  authorization,
  typedData
}: Props): Promise<boolean> {
  let finalDigest: string | Buffer

  if (message) {
    try {
      finalDigest = hashMessage(message)
      if (!finalDigest) throw Error('Hashing the message returned no (falsy) result.')
    } catch (e: any) {
      throw Error(
        `Preparing the just signed (standard) message for validation failed. Please try again or contact Ambire support if the issue persists. Error details: ${
          e?.message || 'missing'
        }`
      )
    }
  } else if (authorization) {
    finalDigest = authorization
  } else {
    // According to the Props definition, either `message` or `typedData` must be provided.
    // However, TypeScript struggles with this `else` condition, incorrectly treating `typedData` as undefined.
    // To prevent TypeScript from complaining, we've added this runtime validation.
    if (!typedData) {
      throw new Error("Either 'message' or 'typedData' must be provided.")
    }

    try {
      // the final digest for AmbireReadableOperation is the execute hash
      // as it's wrapped in mode.standard and onchain gets transformed to
      // an AmbireOperation
      if ('AmbireReadableOperation' in typedData.types) {
        const ambireReadableOperation = typedData.message as AmbireReadableOperation
        finalDigest = hexlify(
          getSignableHash(
            ambireReadableOperation.addr,
            ambireReadableOperation.chainId,
            ambireReadableOperation.nonce,
            ambireReadableOperation.calls.map(callToTuple)
          )
        )
      } else {
        // TODO: Hardcoded to V4, use the version from the typedData if we want to support other versions?
        finalDigest = hexlify(
          TypedDataUtils.eip712Hash(
            adaptTypedMessageForMetaMaskSigUtil({ ...typedData }),
            SignTypedDataVersion.V4
          )
        )
      }

      if (!finalDigest) throw Error('Hashing the typedData returned no (falsy) result.')
    } catch (e: any) {
      throw Error(
        `Preparing the just signed (typed data) message for validation failed. Please try again or contact Ambire support if the issue persists. Error details: ${
          e?.message || 'missing'
        }`
      )
    }
  }

  // this 'magic' universal validator contract will deploy itself within the eth_call, try to verify the signature using
  // ERC-6492, ERC-1271 and ecrecover, and return the value to us
  const coder = new AbiCoder()
  let callResult
  try {
    const deploylessRes = await signatureValidatorVerifyMessage({
      signer,
      finalDigest,
      signature,
      provider: provider as any
    })
    if (deploylessRes === true) callResult = '0x01'
    else if (deploylessRes === false) callResult = '0x00'
    else callResult = deploylessRes
  } catch (e: any) {
    const decoded = decodeError(e)
    const moreDetails = getErrorCodeStringFromReason(decoded.reason || e?.message || '')

    throw new Error(
      `Validating the just signed message failed. Please try again or contact Ambire support if the issue persists. Error details: UniversalValidator call failed (${decoded.type}).${
        moreDetails ? `${moreDetails}` : ''
      }`
    )
  }

  if (callResult === '0x01') return true
  if (callResult === '0x00') return false
  if (callResult.startsWith('0x08c379a0'))
    throw new Error(
      `Ambire failed to validate the signature. Please make sure you are signing with the correct key or device. If the problem persists, please contact Ambire support. Error details:: ${
        coder.decode(['string'], `0x${callResult.slice(10)}`)[0]
      }`
    )

  throw new Error(
    `Ambire failed to validate the signature. Please make sure you are signing with the correct key or device. If the problem persists, please contact Ambire support. Error details: unexpected result from the UniversalValidator: ${callResult}`
  )
}
