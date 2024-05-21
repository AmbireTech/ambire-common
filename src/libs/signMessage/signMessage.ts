/* eslint-disable no-param-reassign */
import {
  AbiCoder,
  concat,
  getBytes,
  hashMessage,
  hexlify,
  Interface,
  isHexString,
  JsonRpcProvider,
  toBeHex,
  toUtf8Bytes,
  TypedDataDomain,
  TypedDataEncoder,
  TypedDataField
} from 'ethers'

import { PERMIT_2_ADDRESS } from '../../consts/addresses'
import { Account, AccountCreation, AccountOnchainState } from '../../interfaces/account'
import { KeystoreSigner } from '../../interfaces/keystore'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { TypedMessage } from '../../interfaces/userRequest'
import hexStringToUint8Array from '../../utils/hexStringToUint8Array'
import { AccountOp, accountOpSignableHash } from '../accountOp/accountOp'

/**
 * For Unprotected signatures, we need to append 00 at the end
 * for ambire to recognize it
 */
export const wrapUnprotected = (signature: string) => {
  return `${signature}00`
}

/**
 * For EIP-712 signatures, we need to append 01 at the end
 * for ambire to recognize it.
 * For v1 contracts, we do ETH sign at the 01 slot, which we'll
 * call standard from now on
 */
export const wrapStandard = (signature: string) => {
  return `${signature}01`
}

/**
 * Return the typed data for EIP-712 sign
 */
export const getTypedData = (
  chainId: bigint,
  verifyingAddr: string,
  msgHash: string
): TypedMessage => {
  const domain: TypedDataDomain = {
    name: 'Ambire',
    version: '1',
    chainId: chainId.toString(),
    verifyingContract: verifyingAddr,
    salt: toBeHex(0, 32)
  }
  const types = {
    EIP712Domain: [
      {
        name: 'name',
        type: 'string'
      },
      {
        name: 'version',
        type: 'string'
      },
      {
        name: 'chainId',
        type: 'uint256'
      },
      {
        name: 'verifyingContract',
        type: 'address'
      },
      {
        name: 'salt',
        type: 'bytes32'
      }
    ],
    AmbireOperation: [
      { name: 'account', type: 'address' },
      { name: 'hash', type: 'bytes32' }
    ]
  }
  const message = {
    account: verifyingAddr,
    hash: msgHash
  }

  return {
    kind: 'typedMessage',
    domain,
    types,
    message,
    primaryType: 'AmbireOperation'
  }
}

/**
 * Produce EIP6492 signature for Predeploy Contracts
 *
 * More info: https://eips.ethereum.org/EIPS/eip-6492
 *
 * @param {string} signature - origin ERC-1271 signature
 * @param {object} account
 * @returns {string} - EIP6492 signature
 */
export const wrapCounterfactualSign = (signature: string, creation: AccountCreation) => {
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

// Outputted by solc contracts/DeploylessUniversalSigValidator.sol --bin --optimize --optimize-runs=1
const universalValidator =
  '0x60806040523480156200001157600080fd5b50604051620007003803806200070083398101604081905262000034916200056f565b6000620000438484846200004f565b9050806000526001601ff35b600080846001600160a01b0316803b806020016040519081016040528181526000908060200190933c90507f6492649264926492649264926492649264926492649264926492649264926492620000a68462000451565b036200021f57600060608085806020019051810190620000c79190620005ce565b8651929550909350915060000362000192576000836001600160a01b031683604051620000f5919062000643565b6000604051808303816000865af19150503d806000811462000134576040519150601f19603f3d011682016040523d82523d6000602084013e62000139565b606091505b5050905080620001905760405162461bcd60e51b815260206004820152601e60248201527f5369676e617475726556616c696461746f723a206465706c6f796d656e74000060448201526064015b60405180910390fd5b505b604051630b135d3f60e11b808252906001600160a01b038a1690631626ba7e90620001c4908b90869060040162000661565b602060405180830381865afa158015620001e2573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906200020891906200069d565b6001600160e01b031916149450505050506200044a565b805115620002b157604051630b135d3f60e11b808252906001600160a01b03871690631626ba7e9062000259908890889060040162000661565b602060405180830381865afa15801562000277573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906200029d91906200069d565b6001600160e01b031916149150506200044a565b8251604114620003195760405162461bcd60e51b815260206004820152603a6024820152600080516020620006e083398151915260448201527f3a20696e76616c6964207369676e6174757265206c656e677468000000000000606482015260840162000187565b620003236200046b565b506020830151604080850151855186939260009185919081106200034b576200034b620006c9565b016020015160f81c9050601b81148015906200036b57508060ff16601c14155b15620003cf5760405162461bcd60e51b815260206004820152603b6024820152600080516020620006e083398151915260448201527f3a20696e76616c6964207369676e617475726520762076616c75650000000000606482015260840162000187565b6040805160008152602081018083528a905260ff83169181019190915260608101849052608081018390526001600160a01b038a169060019060a0016020604051602081039080840390855afa1580156200042e573d6000803e3d6000fd5b505050602060405103516001600160a01b031614955050505050505b9392505050565b60006020825110156200046357600080fd5b508051015190565b60405180606001604052806003906020820280368337509192915050565b6001600160a01b03811681146200049f57600080fd5b50565b634e487b7160e01b600052604160045260246000fd5b60005b83811015620004d5578181015183820152602001620004bb565b50506000910152565b600082601f830112620004f057600080fd5b81516001600160401b03808211156200050d576200050d620004a2565b604051601f8301601f19908116603f01168101908282118183101715620005385762000538620004a2565b816040528381528660208588010111156200055257600080fd5b62000565846020830160208901620004b8565b9695505050505050565b6000806000606084860312156200058557600080fd5b8351620005928162000489565b6020850151604086015191945092506001600160401b03811115620005b657600080fd5b620005c486828701620004de565b9150509250925092565b600080600060608486031215620005e457600080fd5b8351620005f18162000489565b60208501519093506001600160401b03808211156200060f57600080fd5b6200061d87838801620004de565b935060408601519150808211156200063457600080fd5b50620005c486828701620004de565b6000825162000657818460208701620004b8565b9190910192915050565b828152604060208201526000825180604084015262000688816060850160208701620004b8565b601f01601f1916919091016060019392505050565b600060208284031215620006b057600080fd5b81516001600160e01b0319811681146200044a57600080fd5b634e487b7160e01b600052603260045260246000fdfe5369676e617475726556616c696461746f72237265636f7665725369676e6572'

type Props = {
  provider?: JsonRpcProvider
  signer?: string
  signature: string | Uint8Array
  message?: string | Uint8Array
  typedData?: {
    domain: TypedDataDomain
    types: Record<string, Array<TypedDataField>>
    message: Record<string, any>
  }
  finalDigest?: string
}

/**
 * Verifies the signature of a message using the provided signer and signature
 * via a "magic" universal validator contract using the provided provider to
 * verify the signature on-chain. The contract deploys itself within the
 * `eth_call`, tries to verify the signature using ERC-6492, ERC-1271, and
 * `ecrecover`, and returns the value to the function.
 *
 * Note: you only need to pass one of: typedData, finalDigest, message
 */
export async function verifyMessage({
  provider,
  signer,
  signature,
  message,
  typedData,
  finalDigest
}: (
  | Required<Pick<Props, 'message'>>
  | Required<Pick<Props, 'typedData'>>
  | Required<Pick<Props, 'finalDigest'>>
) &
  Props): Promise<boolean> {
  if (message) {
    finalDigest = hashMessage(message)
  } else if (typedData) {
    // To resolve the "ambiguous primary types or unused types" error, remove
    // the `EIP712Domain` from `types` object. The domain type is inbuilt in
    // the EIP712 standard and hence TypedDataEncoder so you do not need to
    // specify it in the types, see:
    // {@link https://ethereum.stackexchange.com/a/151930}
    const typesWithoutEIP712Domain = { ...typedData.types }
    if (typesWithoutEIP712Domain.EIP712Domain) {
      // eslint-disable-next-line no-param-reassign
      delete typesWithoutEIP712Domain.EIP712Domain
    }

    finalDigest = TypedDataEncoder.hash(
      typedData.domain,
      typesWithoutEIP712Domain,
      typedData.message
    )
  }

  if (!finalDigest)
    throw Error(
      'Something went wrong while validating the message you signed. Please try again or contact Ambire support if the issue persists. Error details: missing one of the required props: message, unPrefixedMessage, typedData or finalDigest'
    )

  // this 'magic' universal validator contract will deploy itself within the eth_call, try to verify the signature using
  // ERC-6492, ERC-1271 and ecrecover, and return the value to us
  const coder = new AbiCoder()
  let callResult
  try {
    callResult = await provider!.call({
      data: concat([
        universalValidator,
        coder.encode(['address', 'bytes32', 'bytes'], [signer, finalDigest, signature])
      ])
    })
  } catch {
    throw new Error(
      'Something went wrong while validating the message you signed. If the problem persists, please contact Ambire support. Error details: call to UniversalValidator failed.'
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

// Authorize the execute calls according to the version of the smart account
export async function getExecuteSignature(
  network: NetworkDescriptor,
  accountOp: AccountOp,
  accountState: AccountOnchainState,
  signer: KeystoreSigner
) {
  // if we're authorizing calls for a v1 contract, we do a sign message
  // on the hash of the calls
  if (!accountState.isV2) {
    const message = hexlify(accountOpSignableHash(accountOp, network.chainId))
    return wrapStandard(await signer.signMessage(message))
  }

  // txns for v2 contracts are always eip-712 so we put the hash of the calls
  // in eip-712 format
  const typedData = getTypedData(
    network.chainId,
    accountState.accountAddr,
    hexlify(accountOpSignableHash(accountOp, network.chainId))
  )
  return wrapStandard(await signer.signTypedData(typedData))
}

export async function getPlainTextSignature(
  message: string | Uint8Array,
  network: NetworkDescriptor,
  account: Account,
  accountState: AccountOnchainState,
  signer: KeystoreSigner
): Promise<string> {
  const dedicatedToOneSA = signer.key.dedicatedToOneSA

  let messageHex
  if (message instanceof Uint8Array) {
    messageHex = hexlify(message)
  } else if (!isHexString(message)) {
    messageHex = hexlify(toUtf8Bytes(message))
  } else {
    messageHex = message
  }

  if (!account.creation) {
    const signature = await signer.signMessage(messageHex)
    return signature
  }

  if (!accountState.isV2) {
    // the below commented out code is the way this should work if we enable it
    // we're disabling it from the extension for v1 account as signatures
    // produced in plain text are malleable, meaning they could be reused
    // somewhere else. If demand is big enough for v1 account, we might
    // re-enable them
    // return wrapUnprotected(await signer.signMessage(messageHex))
    throw new Error(
      'Signing messages is disallowed for v1 accounts. Please contact support to proceed'
    )
  }

  // if it's safe, we proceed
  if (dedicatedToOneSA) {
    return wrapUnprotected(await signer.signMessage(messageHex))
  }

  // in case of only_standard priv key, we transform the data
  // for signing to EIP-712. This is because the key is not labeled safe
  // and it should inform the user that he's performing an Ambire Op.
  // This is important as this key could be a metamask one and someone
  // could be phishing him into approving an Ambire Op without him
  // knowing
  const typedData = getTypedData(network!.chainId, account.addr, hashMessage(getBytes(messageHex)))
  return wrapStandard(await signer.signTypedData(typedData))
}

export async function getEIP712Signature(
  message: TypedMessage,
  account: Account,
  accountState: AccountOnchainState,
  signer: KeystoreSigner
): Promise<string> {
  if (!message.types.EIP712Domain) {
    throw new Error(
      'Ambire only supports signing EIP712 typed data messages. Please try again with a valid EIP712 message.'
    )
  }
  if (!message.primaryType) {
    throw new Error(
      'The primaryType is missing in the typed data message incoming. Please try again with a valid EIP712 message.'
    )
  }

  if (!account.creation) {
    const signature = await signer.signTypedData(message)
    return signature
  }

  if (!accountState.isV2) {
    if (
      message.domain.name === 'Permit2' &&
      message.domain.verifyingContract === PERMIT_2_ADDRESS
    ) {
      return wrapUnprotected(await signer.signTypedData(message))
    }

    throw new Error(
      'Signing eip-712 messages is disallowed for v1 accounts. Please contact support to proceed'
    )
  }

  // if it's safe, we proceed
  const dedicatedToOneSA = signer.key.dedicatedToOneSA
  if (dedicatedToOneSA) {
    return wrapUnprotected(await signer.signTypedData(message))
  }

  // we do not allow signers who are not dedicated to one account to sign eip-712
  // messsages in v2 as it could lead to reusing that key from
  throw new Error(
    `Signer with address ${signer.key.addr} does not have privileges to execute this operation. Please choose a different signer and try again`
  )
}
