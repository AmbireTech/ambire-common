import {
  AbiCoder,
  concat,
  hexlify,
  Interface,
  keccak256,
  Log,
  randomBytes,
  solidityPacked,
  toBeHex,
  toUtf8Bytes
} from 'ethers'

import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import AmbireFactory from '../../../contracts/compiled/AmbireFactory.json'
import { EIP7702Auth } from '../../consts/7702'
import { BUNDLER } from '../../consts/bundlers'
import {
  AMBIRE_ACCOUNT_FACTORY,
  AMBIRE_PAYMASTER,
  AMBIRE_PAYMASTER_SIGNER,
  ENTRY_POINT_MARKER,
  ENTRYPOINT_0_9_0,
  ERC_4337_ENTRYPOINT
} from '../../consts/deploy'
import { PAYMASTER_SIG_MAGIC, SPOOF_SIGTYPE } from '../../consts/signatures'
import { Account, AccountId, AccountOnchainState } from '../../interfaces/account'
import { Hex } from '../../interfaces/hex'
import { Network } from '../../interfaces/network'
import { SignUserOperation } from '../../interfaces/userOperation'
//  TODO: dependency cycle
// eslint-disable-next-line import/no-cycle
import { AccountOp, callToTuple } from '../accountOp/accountOp'
//  TODO: dependency cycle
// eslint-disable-next-line import/no-cycle
import { PackedUserOperation, UserOperation, UserOperationEventData } from './types'

export function calculateCallDataCost(callData: string): bigint {
  if (callData === '0x') return 0n
  const bytes = Buffer.from(callData.substring(2))
  const nonZeroBytes = BigInt(bytes.filter((b) => b).length)
  const zeroBytes = BigInt(BigInt(bytes.length) - nonZeroBytes)
  return zeroBytes * 4n + nonZeroBytes * 16n
}

export function getPaymasterSpoof() {
  const abiCoder = new AbiCoder()
  const spoofSig = abiCoder.encode(['address'], [AMBIRE_PAYMASTER_SIGNER]) + SPOOF_SIGTYPE
  const simulationData = abiCoder.encode(['uint48', 'uint48', 'bytes'], [0, 0, spoofSig])
  return hexlify(concat([AMBIRE_PAYMASTER, simulationData]))
}

export function getSigForCalculations() {
  return '0x0dc2d37f7b285a2243b2e1e6ba7195c578c72b395c0f76556f8961b0bca97ddc44e2d7a249598f56081a375837d2b82414c3c94940db3c1e64110108021161ca1c01'
}

// get the call to give privileges to the entry point
export function getActivatorCall(addr: AccountId) {
  const saAbi = new Interface(AmbireAccount.abi)
  const givePermsToEntryPointData = saAbi.encodeFunctionData('setAddrPrivilege', [
    ERC_4337_ENTRYPOINT,
    ENTRY_POINT_MARKER
  ])
  return {
    to: addr,
    value: 0n,
    data: givePermsToEntryPointData
  }
}

/**
 * When we use abi.encode or send the user operation to the bundler,
 * we need to strip it of the specific ambire-common properties that we use
 *
 * @param UserOperation userOp
 * @returns EntryPoint userOp
 */
export function getCleanUserOp(userOp: UserOperation) {
  return [(({ activatorCall, bundler, ...o }) => o)(userOp)]
}

/**
 * Get the nonce we're expecting in validateUserOp
 * when we're going through the activation | recovery
 *
 * @param UserOperation userOperation
 * @returns hex string
 */
export function getOneTimeNonce(userOperation: UserOperation) {
  if (
    !userOperation.paymaster ||
    !userOperation.paymasterVerificationGasLimit ||
    !userOperation.paymasterPostOpGasLimit ||
    !userOperation.paymasterData
  ) {
    throw new Error('One time nonce could not be encoded because paymaster data is missing')
  }

  const abiCoder = new AbiCoder()
  return `0x${keccak256(
    abiCoder.encode(
      ['bytes', 'bytes', 'bytes32', 'uint256', 'bytes32', 'bytes'],
      [
        userOperation.factory && userOperation.factoryData
          ? concat([userOperation.factory, userOperation.factoryData])
          : '0x',
        userOperation.callData,
        concat([
          toBeHex(userOperation.verificationGasLimit, 16),
          toBeHex(userOperation.callGasLimit, 16)
        ]),
        userOperation.preVerificationGas,
        concat([
          toBeHex(userOperation.maxPriorityFeePerGas, 16),
          toBeHex(userOperation.maxFeePerGas, 16)
        ]),
        concat([
          userOperation.paymaster,
          toBeHex(userOperation.paymasterVerificationGasLimit, 16),
          toBeHex(userOperation.paymasterPostOpGasLimit, 16),
          userOperation.paymasterData
        ])
      ]
    )
  ).substring(18)}${toBeHex(0, 8).substring(2)}`
}

export function getUserOperation({
  account,
  accountState,
  accountOp,
  bundler,
  entryPointSig,
  eip7702Auth,
  hasPendingUserOp
}: {
  account: Account
  accountState: AccountOnchainState
  accountOp: AccountOp
  bundler: BUNDLER
  entryPointSig?: string
  eip7702Auth?: EIP7702Auth
  hasPendingUserOp?: boolean
}): UserOperation {
  const uniqueNonce = concat([randomBytes(24), toBeHex(0, 8)]) // 1 / 10 ^ −52 collision chance
  const nonce = hasPendingUserOp ? uniqueNonce : toBeHex(accountState.erc4337Nonce)
  const userOp: UserOperation = {
    sender: accountOp.accountAddr,
    nonce,
    callData: '0x',
    callGasLimit: toBeHex(0),
    verificationGasLimit: toBeHex(0),
    preVerificationGas: toBeHex(0),
    maxFeePerGas: toBeHex(0),
    maxPriorityFeePerGas: toBeHex(0),
    signature: '0x',
    bundler
  }

  // if the account is not deployed, prepare the deploy in the initCode
  if (entryPointSig) {
    if (!account.creation) throw new Error('Account creation properties are missing')

    const factoryInterface = new Interface(AmbireFactory.abi)
    userOp.factory = account.creation.factoryAddr
    userOp.factoryData = factoryInterface.encodeFunctionData('deployAndExecute', [
      account.creation.bytecode,
      account.creation.salt,
      [callToTuple(getActivatorCall(accountOp.accountAddr))],
      entryPointSig
    ])
  }

  userOp.eip7702Auth = eip7702Auth
  return userOp
}

// for special cases where we broadcast a 4337 operation with an EOA,
// add the activator call so the use has the entry point attached
export function shouldIncludeActivatorCall(
  network: Network,
  account: Account,
  accountState: AccountOnchainState,
  is4337Broadcast = true
) {
  return (
    account.creation &&
    account.creation.factoryAddr === AMBIRE_ACCOUNT_FACTORY &&
    accountState.isV2 &&
    !accountState.isEOA &&
    network.erc4337.enabled &&
    !accountState.isErc4337Enabled &&
    (accountState.isDeployed || !is4337Broadcast)
  )
}

export const ENTRY_POINT_AUTHORIZATION_REQUEST_ID = 'ENTRY_POINT_AUTHORIZATION_REQUEST_ID'

function getPaymasterData(paymasterData?: string) {
  if (!paymasterData || paymasterData === '0x') return '0x'

  const paymasterDataLength = paymasterData.length
  const suffixLength = PAYMASTER_SIG_MAGIC.length - 2
  if (
    paymasterDataLength > suffixLength &&
    paymasterData.slice(paymasterDataLength - suffixLength) === PAYMASTER_SIG_MAGIC
  ) {
    const sigLength = BigInt(
      `0x${paymasterData.slice(paymasterDataLength - 20, paymasterDataLength - 16)}`
    )
    const sigLengthInHex = Number(sigLength) * 2
    const dataToHash = paymasterData.slice(0, paymasterDataLength - sigLengthInHex - 20)
    return concat([dataToHash, PAYMASTER_SIG_MAGIC])
  }
  return '0x'
}

function getPackedPaymasterData(userOp: SignUserOperation) {
  return userOp.paymaster
    ? concat([
        userOp.paymaster,
        toBeHex(userOp.paymasterVerificationGasLimit!.toString(), 16),
        toBeHex(userOp.paymasterPostOpGasLimit!.toString(), 16),
        getPaymasterData(userOp.paymasterData)
      ])
    : '0x'
}

export function getPackedUserOp(userOp: SignUserOperation): PackedUserOperation {
  const initCode = userOp.factory ? concat([userOp.factory, userOp.factoryData!]) : '0x'
  const accountGasLimits = concat([
    toBeHex(userOp.verificationGasLimit.toString(), 16),
    toBeHex(userOp.callGasLimit.toString(), 16)
  ])
  const gasFees = concat([
    toBeHex(userOp.maxPriorityFeePerGas.toString(), 16),
    toBeHex(userOp.maxFeePerGas.toString(), 16)
  ])
  const paymasterAndData = getPackedPaymasterData(userOp)
  return {
    sender: userOp.sender,
    nonce: BigInt(userOp.nonce),
    initCode: initCode as Hex,
    callData: userOp.callData as Hex,
    accountGasLimits: accountGasLimits as Hex,
    preVerificationGas: BigInt(userOp.preVerificationGas),
    gasFees: gasFees as Hex,
    paymasterAndData: paymasterAndData as Hex
  }
}

export function getUserOpHash(userOp: SignUserOperation, chainId: bigint): string {
  const abiCoder = new AbiCoder()
  const packedUserOp = getPackedUserOp(userOp)
  const hashInitCode = keccak256(packedUserOp.initCode)
  const hashCallData = keccak256(packedUserOp.callData)
  const hashPaymasterAndData = keccak256(packedUserOp.paymasterAndData)
  const packed = abiCoder.encode(
    ['address', 'uint256', 'bytes32', 'bytes32', 'bytes32', 'uint256', 'bytes32', 'bytes32'],
    [
      userOp.sender,
      userOp.nonce,
      hashInitCode,
      hashCallData,
      packedUserOp.accountGasLimits,
      userOp.preVerificationGas,
      packedUserOp.gasFees,
      hashPaymasterAndData
    ]
  )
  const packedHash = keccak256(packed)
  return keccak256(
    abiCoder.encode(['bytes32', 'address', 'uint256'], [packedHash, ERC_4337_ENTRYPOINT, chainId])
  )
}

export function getEntryPoint090Hash(userOp: SignUserOperation, chainId: bigint): string {
  const abiCoder = new AbiCoder()
  const packedUserOp = getPackedUserOp(userOp)
  const hashInitCode = keccak256(packedUserOp.initCode)
  const hashCallData = keccak256(packedUserOp.callData)
  const hashPaymasterAndData = keccak256(packedUserOp.paymasterAndData)
  const domainSeparator = keccak256(
    abiCoder.encode(
      ['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
      [
        keccak256(
          toUtf8Bytes(
            'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'
          )
        ),
        keccak256(toUtf8Bytes('ERC4337')),
        keccak256(toUtf8Bytes('1')),
        chainId,
        ENTRYPOINT_0_9_0
      ]
    )
  )
  const packedUserOpDomain = keccak256(
    toUtf8Bytes(
      'PackedUserOperation(address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData)'
    )
  )
  const packed = abiCoder.encode(
    [
      'bytes32',
      'address',
      'uint256',
      'bytes32',
      'bytes32',
      'bytes32',
      'uint256',
      'bytes32',
      'bytes32'
    ],
    [
      packedUserOpDomain,
      userOp.sender,
      userOp.nonce,
      hashInitCode,
      hashCallData,
      packedUserOp.accountGasLimits,
      userOp.preVerificationGas,
      packedUserOp.gasFees,
      hashPaymasterAndData
    ]
  )
  const packedHash = keccak256(packed)
  return keccak256(
    solidityPacked(['string', 'bytes32', 'bytes32'], ['\x19\x01', domainSeparator, packedHash])
  )
}

// try to parse the UserOperationEvent to understand whether
// the user op is a success or a failure
export const parseLogs = (
  logs: readonly Log[],
  userOpHash: string,
  userOpsLength?: number // benzina only
): UserOperationEventData | null => {
  if (userOpHash === '' && userOpsLength !== 1) return null

  let userOpLog = null
  logs.forEach((log: Log) => {
    try {
      if (
        log.topics.length === 4 &&
        (log.topics[1].toLowerCase() === userOpHash.toLowerCase() || userOpsLength === 1)
      ) {
        // decode data for UserOperationEvent:
        // 'event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)'
        const coder = new AbiCoder()
        userOpLog = coder.decode(['uint256', 'bool', 'uint256', 'uint256'], log.data)
      }
    } catch (e: any) {
      /* silence is bitcoin */
    }
  })

  if (!userOpLog) return null

  return {
    nonce: userOpLog[0],
    success: userOpLog[1]
  }
}

/**
 * Get all the bundler statuses that indicate that an userOp
 * is either pending to be mined or successfully included in the blockchain
 */
export function getUserOpPendingOrSuccessStatuses(): string[] {
  return ['found', 'submitted', 'not_submitted', 'included', 'queued']
}
