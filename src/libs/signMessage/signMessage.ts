/* eslint-disable no-param-reassign */
import {
  AbiCoder,
  getAddress,
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

import UniversalSigValidator from '../../../contracts/compiled/UniversalSigValidator.json'
import { PERMIT_2_ADDRESS, UNISWAP_UNIVERSAL_ROUTERS } from '../../consts/addresses'
import { Account, AccountCreation, AccountId, AccountOnchainState } from '../../interfaces/account'
import { Hex } from '../../interfaces/hex'
import { KeystoreSigner } from '../../interfaces/keystore'
import { Network } from '../../interfaces/network'
import { TypedMessage } from '../../interfaces/userRequest'
import hexStringToUint8Array from '../../utils/hexStringToUint8Array'
import isSameAddr from '../../utils/isSameAddr'
import { stripHexPrefix } from '../../utils/stripHexPrefix'
import {
  AccountOp,
  accountOpSignableHash,
  callToTuple,
  getSignableHash
} from '../accountOp/accountOp'
import { fromDescriptor } from '../deployless/deployless'
import { relayerAdditionalNetworks } from '../networks/networks'
import { getActivatorCall } from '../userOperation/userOperation'

// EIP6492 signature ends in magicBytes, which ends with a 0x92,
// which makes it is impossible for it to collide with a valid ecrecover signature if packed in the r,s,v format,
// as 0x92 is not a valid value for v.
const magicBytes = '6492649264926492649264926492649264926492649264926492649264926492'

export const EIP_1271_NOT_SUPPORTED_BY = [
  'opensea.io',
  'paraswap.xyz',
  'blur.io',
  'aevo.xyz',
  'socialscan.io',
  'tally.xyz',
  'questn.com'
]

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
 * For v2 accounts acting as signers, we need to append the v2 wallet
 * addr that's the signer and a 02 mode at the end to indicate it's a wallet:
 * {sig+mode}{wallet_32bytes}{mode}
 */
export const wrapWallet = (signature: string, walletAddr: string) => {
  const wallet32bytes = `${stripHexPrefix(toBeHex(0, 12))}${stripHexPrefix(walletAddr)}`
  return `${signature}${wallet32bytes}02`
}

// allow v1 accounts to have v2 signers
interface AmbireReadableOperation {
  addr: Hex
  chainId: bigint
  nonce: bigint
  calls: { to: Hex; value: bigint; data: Hex }[]
}

export const getAmbireReadableTypedData = (
  chainId: bigint,
  verifyingAddr: string,
  v1Execute: AmbireReadableOperation
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
    Calls: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' }
    ],
    AmbireReadableOperation: [
      { name: 'account', type: 'address' },
      { name: 'chainId', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'calls', type: 'Calls[]' }
    ]
  }

  return {
    kind: 'typedMessage',
    domain,
    types,
    message: v1Execute,
    primaryType: 'AmbireOperation'
  }
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

type Props = {
  network?: Network
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
  network,
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
        finalDigest = TypedDataEncoder.hash(
          typedData.domain,
          typesWithoutEIP712Domain,
          typedData.message
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
    const deploylessVerify = fromDescriptor(
      provider!,
      UniversalSigValidator,
      !network!.rpcNoStateOverride
    )
    const deploylessRes = await deploylessVerify.call('isValidSigWithSideEffects', [
      signer,
      finalDigest,
      signature
    ])
    if (deploylessRes[0] === true) callResult = '0x01'
    else if (deploylessRes[0] === false) callResult = '0x00'
    else callResult = deploylessRes[0]
  } catch (e: any) {
    throw new Error(
      `Validating the just signed message failed. Please try again or contact Ambire support if the issue persists. Error details: UniversalValidator call failed, more details: ${
        // TODO: Use the `reason` from the decodeError(e) instead, when this case is better handled in there
        e?.message || 'missing'
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

// Authorize the execute calls according to the version of the smart account
export async function getExecuteSignature(
  network: Network,
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
  network: Network,
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
    const lowercaseHexAddrWithout0x = hexlify(toUtf8Bytes(account.addr.toLowerCase().slice(2)))
    const checksummedHexAddrWithout0x = hexlify(toUtf8Bytes(account.addr.slice(2)))
    const asciiAddrLowerCase = account.addr.toLowerCase()
    const humanReadableMsg = message instanceof Uint8Array ? hexlify(message) : message

    const isAsciiAddressInMessage = humanReadableMsg.toLowerCase().includes(asciiAddrLowerCase)
    const isLowercaseHexAddressInMessage = humanReadableMsg.includes(
      lowercaseHexAddrWithout0x.slice(2)
    )
    const isChecksummedHexAddressInMessage = humanReadableMsg.includes(
      checksummedHexAddrWithout0x.slice(2)
    )

    if (
      !network.predefined &&
      !relayerAdditionalNetworks.find((net) => net.chainId === network.chainId)
    ) {
      throw new Error(`Signing messages is disallowed for v1 accounts on ${network.name}`)
    }

    if (
      isAsciiAddressInMessage ||
      isLowercaseHexAddressInMessage ||
      isChecksummedHexAddressInMessage
    ) {
      return wrapUnprotected(await signer.signMessage(messageHex))
    }

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
  signer: KeystoreSigner,
  network: Network
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
    const asString = JSON.stringify(message).toLowerCase()
    if (
      asString.indexOf(account.addr.toLowerCase()) !== -1 ||
      (message.domain.name === 'Permit2' &&
        message.domain.verifyingContract &&
        getAddress(message.domain.verifyingContract) === PERMIT_2_ADDRESS &&
        message.message &&
        message.message.spender &&
        UNISWAP_UNIVERSAL_ROUTERS[Number(network.chainId)] &&
        UNISWAP_UNIVERSAL_ROUTERS[Number(network.chainId)] === getAddress(message.message.spender))
    ) {
      return wrapUnprotected(await signer.signTypedData(message))
    }

    throw new Error(
      'Signing this eip-712 message is disallowed for v1 accounts as it does not contain the smart account address and therefore deemed unsafe'
    )
  }

  // we do not allow signers who are not dedicated to one account to sign eip-712
  // messsages in v2 as it could lead to reusing that key from
  const dedicatedToOneSA = signer.key.dedicatedToOneSA
  if (!dedicatedToOneSA) {
    throw new Error(
      `Signer with address ${signer.key.addr} does not have privileges to execute this operation. Please choose a different signer and try again`
    )
  }

  if ('AmbireReadableOperation' in message.types) {
    const ambireReadableOperation = message.message as AmbireReadableOperation
    if (isSameAddr(ambireReadableOperation.addr, account.addr)) {
      throw new Error(
        'signature error: trying to sign an AmbireReadableOperation for the same address. Please contact support'
      )
    }

    const hash = hexlify(
      getSignableHash(
        ambireReadableOperation.addr,
        ambireReadableOperation.chainId,
        ambireReadableOperation.nonce,
        ambireReadableOperation.calls.map(callToTuple)
      )
    )
    const ambireOperation = getTypedData(ambireReadableOperation.chainId, account.addr, hash)
    const signature = wrapStandard(await signer.signTypedData(ambireOperation))
    return wrapWallet(signature, account.addr)
  }

  return wrapUnprotected(await signer.signTypedData(message))
}

// get the typedData for the first ERC-4337 deploy txn
export async function getEntryPointAuthorization(addr: AccountId, chainId: bigint, nonce: bigint) {
  const hash = getSignableHash(addr, chainId, nonce, [callToTuple(getActivatorCall(addr))])
  return getTypedData(chainId, addr, hexlify(hash))
}

export function adjustEntryPointAuthorization(signature: string): string {
  let entryPointSig = signature

  // if thet signature is wrapepd in magicBytes because of eip-6492, unwrap it
  if (signature.endsWith(magicBytes)) {
    const coder = new AbiCoder()
    const decoded = coder.decode(
      ['address', 'bytes', 'bytes'],
      signature.substring(0, signature.length - magicBytes.length)
    )
    entryPointSig = decoded[2]
  }

  // since normally when we sign an EIP-712 request, we wrap it in Unprotected,
  // we adjust the entry point authorization signature so we could execute a txn
  return wrapStandard(entryPointSig.substring(0, entryPointSig.length - 2))
}
