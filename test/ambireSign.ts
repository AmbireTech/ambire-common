import { TypedDataDomain } from 'ethers'
import { ethers } from 'hardhat'

import { abiCoder } from './config'

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

function wrapTypedData(chainId: bigint, verifyingAddr: string, executeHash: string) {
  const domain: TypedDataDomain = {
    name: 'Ambire',
    version: '1',
    chainId,
    verifyingContract: verifyingAddr,
    salt: ethers.toBeHex(0, 32)
  }
  const types = {
    AmbireOperation: [
      { name: 'account', type: 'address' },
      { name: 'hash', type: 'bytes32' }
    ]
  }
  const value = {
    account: verifyingAddr,
    hash: executeHash
  }

  return {
    domain,
    types,
    value
  }
}

function getRawTypedDataFinalDigest(
  chainId: bigint,
  ambireAccountAddress: string,
  executeHash: string
) {
  const typedData = wrapTypedData(chainId, ambireAccountAddress, executeHash)
  const domain = ethers.keccak256(
    abiCoder.encode(
      ['bytes32', 'bytes32', 'bytes32', 'uint256', 'address', 'bytes32'],
      [
        ethers.keccak256(
          ethers.toUtf8Bytes(
            'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract,bytes32 salt)'
          )
        ),
        ethers.keccak256(ethers.toUtf8Bytes(typedData.domain.name!)),
        ethers.keccak256(ethers.toUtf8Bytes(typedData.domain.version!)),
        typedData.domain.chainId!,
        typedData.domain.verifyingContract!,
        typedData.domain.salt!
      ]
    )
  )
  return ethers.keccak256(
    ethers.solidityPacked(
      ['string', 'bytes32', 'bytes32'],
      [
        '\x19\x01',
        domain,
        ethers.keccak256(
          abiCoder.encode(
            ['bytes32', 'address', 'bytes32'],
            [
              ethers.keccak256(ethers.toUtf8Bytes('AmbireOperation(address account,bytes32 hash)')),
              ambireAccountAddress,
              executeHash
            ]
          )
        )
      ]
    )
  )
}

export {
  wrapEIP712,
  wrapEthSign,
  wrapSchnorr,
  wrapMultiSig,
  wrapRecover,
  wrapCancel,
  wrapExternallyValidated,
  wrapTypedData,
  getRawTypedDataFinalDigest
}
