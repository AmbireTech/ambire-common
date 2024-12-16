import { AbiCoder, concat, getAddress, hexlify, Interface, keccak256, toBeHex } from 'ethers'
import { Network } from 'interfaces/network'

import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import AmbireFactory from '../../../contracts/compiled/AmbireFactory.json'
import {
  AMBIRE_ACCOUNT_FACTORY,
  AMBIRE_PAYMASTER,
  AMBIRE_PAYMASTER_SIGNER,
  ENTRY_POINT_MARKER,
  ERC_4337_ENTRYPOINT
} from '../../consts/deploy'
import { SPOOF_SIGTYPE } from '../../consts/signatures'
import { Account, AccountId, AccountOnchainState } from '../../interfaces/account'
import { AccountOp, callToTuple } from '../accountOp/accountOp'
import { UserOperation, UserOpRequestType } from './types'

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
  return [(({ requestType, activatorCall, ...o }) => o)(userOp)]
}

/**
 * Get the nonce we're expecting in validateUserOp
 * when we're going through the activation | recovery
 *
 * @param UserOperation userOperation
 * @returns hex string
 */
export function getOneTimeNonce(userOperation: UserOperation) {
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
          userOperation.paymaster!,
          toBeHex(userOperation.paymasterVerificationGasLimit!, 16),
          toBeHex(userOperation.paymasterPostOpGasLimit!, 16),
          userOperation.paymasterData!
        ])
      ]
    )
  ).substring(18)}${toBeHex(0, 8).substring(2)}`
}

export function getRequestType(accountState: AccountOnchainState): UserOpRequestType {
  return accountState.isDeployed && !accountState.isErc4337Enabled ? 'activator' : 'standard'
}

export function shouldUseOneTimeNonce(accountState: AccountOnchainState): boolean {
  return getRequestType(accountState) !== 'standard'
}

export function getUserOperation(
  account: Account,
  accountState: AccountOnchainState,
  accountOp: AccountOp,
  entryPointSig?: string
): UserOperation {
  const userOp: UserOperation = {
    sender: accountOp.accountAddr,
    nonce: toBeHex(accountState.erc4337Nonce),
    callData: '0x',
    callGasLimit: toBeHex(0),
    verificationGasLimit: toBeHex(0),
    preVerificationGas: toBeHex(0),
    maxFeePerGas: toBeHex(1),
    maxPriorityFeePerGas: toBeHex(1),
    signature: '0x',
    requestType: getRequestType(accountState)
  }

  // if the account is not deployed, prepare the deploy in the initCode
  if (!accountState.isDeployed) {
    if (!account.creation) throw new Error('Account creation properties are missing')
    if (!entryPointSig) throw new Error('No entry point authorization signature provided')

    const factoryInterface = new Interface(AmbireFactory.abi)
    userOp.factory = account.creation.factoryAddr
    userOp.factoryData = factoryInterface.encodeFunctionData('deployAndExecute', [
      account.creation.bytecode,
      account.creation.salt,
      [callToTuple(getActivatorCall(accountOp.accountAddr))],
      entryPointSig
    ])
  }

  // if the request type is activator, add the activator call
  if (userOp.requestType === 'activator')
    userOp.activatorCall = getActivatorCall(accountOp.accountAddr)

  return userOp
}

export function isErc4337Broadcast(
  acc: Account,
  network: Network,
  accountState: AccountOnchainState
): boolean {
  // a special exception for gnosis which was a hardcoded chain but
  // now it's not. The bundler doesn't support state override on gnosis
  // so if the account IS deployed AND does NOT have 4337 privileges,
  // it won't be able to use the edge case as the bundler will block
  // the estimation. That's why we will use the relayer in this case
  const canBroadcast4337 =
    network.chainId !== 100n || accountState.isErc4337Enabled || !accountState.isDeployed

  return (
    canBroadcast4337 &&
    network.erc4337.enabled &&
    accountState.isV2 &&
    !!acc.creation &&
    getAddress(acc.creation.factoryAddr) === AMBIRE_ACCOUNT_FACTORY
  )
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
    network.erc4337.enabled &&
    !accountState.isErc4337Enabled &&
    (accountState.isDeployed || !is4337Broadcast)
  )
}

// if the account is v2 and the network is 4337 and the account hasn't
// authorized the entry point, he should be asked to do so
//
// addition: if the account is the 0.7.0 one
export function shouldAskForEntryPointAuthorization(
  network: Network,
  account: Account,
  accountState: AccountOnchainState,
  alreadySigned: boolean
) {
  if (alreadySigned) return false

  return (
    account.creation &&
    account.creation.factoryAddr === AMBIRE_ACCOUNT_FACTORY &&
    accountState.isV2 &&
    !accountState.isDeployed &&
    network.erc4337.enabled &&
    !accountState.isErc4337Enabled
  )
}

export const ENTRY_POINT_AUTHORIZATION_REQUEST_ID = 'ENTRY_POINT_AUTHORIZATION_REQUEST_ID'

export function getUserOpHash(userOp: UserOperation, chainId: bigint) {
  const abiCoder = new AbiCoder()
  const initCode = userOp.factory ? concat([userOp.factory, userOp.factoryData!]) : '0x'
  const hashInitCode = keccak256(initCode)
  const hashCallData = keccak256(userOp.callData)
  const accountGasLimits = concat([
    toBeHex(userOp.verificationGasLimit.toString(), 16),
    toBeHex(userOp.callGasLimit.toString(), 16)
  ])
  const gasFees = concat([
    toBeHex(userOp.maxPriorityFeePerGas.toString(), 16),
    toBeHex(userOp.maxFeePerGas.toString(), 16)
  ])
  const paymasterAndData = userOp.paymaster
    ? concat([
        userOp.paymaster,
        toBeHex(userOp.paymasterVerificationGasLimit!.toString(), 16),
        toBeHex(userOp.paymasterPostOpGasLimit!.toString(), 16),
        userOp.paymasterData!
      ])
    : '0x'
  const hashPaymasterAndData = keccak256(paymasterAndData)
  const packed = abiCoder.encode(
    ['address', 'uint256', 'bytes32', 'bytes32', 'bytes32', 'uint256', 'bytes32', 'bytes32'],
    [
      userOp.sender,
      userOp.nonce,
      hashInitCode,
      hashCallData,
      accountGasLimits,
      userOp.preVerificationGas,
      gasFees,
      hashPaymasterAndData
    ]
  )
  const packedHash = keccak256(packed)
  return keccak256(
    abiCoder.encode(['bytes32', 'address', 'uint256'], [packedHash, ERC_4337_ENTRYPOINT, chainId])
  )
}
