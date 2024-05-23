import { AbiCoder, concat, hexlify, Interface, keccak256, toBeHex } from 'ethers'
import { NetworkDescriptor } from 'interfaces/networkDescriptor'

import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import AmbireAccountFactory from '../../../contracts/compiled/AmbireAccountFactory.json'
import {
  AMBIRE_PAYMASTER,
  AMBIRE_PAYMASTER_SIGNER,
  ENTRY_POINT_MARKER,
  ERC_4337_ENTRYPOINT
} from '../../consts/deploy'
import { SPOOF_SIGTYPE } from '../../consts/signatures'
import { Account, AccountId, AccountOnchainState } from '../../interfaces/account'
import { AccountOp, callToTuple } from '../accountOp/accountOp'
import { UserOperation } from './types'

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

export function getPaymasterDataForEstimate(): {
  paymaster: string
  paymasterData: string
  paymasterVerificationGasLimit: string
  paymasterPostOpGasLimit: string
} {
  const abiCoder = new AbiCoder()
  return {
    paymaster: AMBIRE_PAYMASTER,
    paymasterVerificationGasLimit: toBeHex(0),
    paymasterPostOpGasLimit: toBeHex(0),
    paymasterData: abiCoder.encode(['uint48', 'uint48', 'bytes'], [0, 0, getSigForCalculations()])
  }
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

export function shouldUseOneTimeNonce(userOp: UserOperation) {
  return userOp.requestType !== 'standard'
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
    requestType: 'standard'
  }

  // if the account is not deployed, prepare the deploy in the initCode
  if (!accountState.isDeployed) {
    if (!account.creation) throw new Error('Account creation properties are missing')
    if (!entryPointSig) throw new Error('No entry point authorization signature provided')

    const factoryInterface = new Interface(AmbireAccountFactory.abi)
    userOp.factory = account.creation.factoryAddr
    userOp.factoryData = factoryInterface.encodeFunctionData('deployAndExecute', [
      account.creation.bytecode,
      account.creation.salt,
      [callToTuple(getActivatorCall(accountOp.accountAddr))],
      entryPointSig
    ])
  }

  if (accountState.isDeployed && !accountState.isErc4337Enabled) {
    userOp.activatorCall = getActivatorCall(accountOp.accountAddr)
    userOp.requestType = 'activator'
  }

  return userOp
}

export function shouldUsePaymaster(network: NetworkDescriptor): boolean {
  // if there's a paymaster on the network, we pay with it. Simple
  return !!network.erc4337.hasPaymaster
}

export function isErc4337Broadcast(
  network: NetworkDescriptor,
  accountState: AccountOnchainState
): boolean {
  // we can broadcast a 4337 if:
  // - the account is not deployed (we do deployAndExecute in the factoryData)
  // - the entry point is enabled (standard ops)
  // - we have a paymaster (through the edge case)
  const canWeBroadcast4337 =
    accountState.isErc4337Enabled || shouldUsePaymaster(network) || !accountState.isDeployed

  return network.erc4337.enabled && canWeBroadcast4337 && accountState.isV2
}

// if the account is v2 account that does not have the entry point as a signer
// and the network is a 4337 one without a paymaster, the only way to broadcast
// a txn is through EOA pays for SA. That's why we need this check to include
// the activator call and the next txn to be ERC-4337
export function shouldIncludeActivatorCall(
  network: NetworkDescriptor,
  accountState: AccountOnchainState
) {
  return (
    accountState.isV2 &&
    network.erc4337.enabled &&
    !accountState.isErc4337Enabled &&
    accountState.isDeployed
  )
}

export function getExplorerId(network: NetworkDescriptor) {
  return network.erc4337.explorerId ?? network.id
}

// if the account is v2 and the network is 4337 and the account hasn't
// authorized the entry point, he should be asked to do so
export function shouldAskForEntryPointAuthorization(
  network: NetworkDescriptor,
  accountState: AccountOnchainState
) {
  return accountState.isV2 && network.erc4337.enabled && !accountState.isErc4337Enabled
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
