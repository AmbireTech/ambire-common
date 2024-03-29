import { AbiCoder, BaseContract, concat, hexlify, Interface, keccak256, toBeHex } from 'ethers'
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
import { AccountOp, getSignableCalls } from '../accountOp/accountOp'
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
      ['bytes', 'bytes', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'bytes'],
      [
        userOperation.initCode,
        userOperation.callData,
        userOperation.callGasLimit,
        userOperation.verificationGasLimit,
        userOperation.preVerificationGas,
        userOperation.maxFeePerGas,
        userOperation.maxPriorityFeePerGas,
        userOperation.paymasterAndData
      ]
    )
  ).substring(18)}${toBeHex(0, 8).substring(2)}`
}

export function shouldUseOneTimeNonce(userOp: UserOperation) {
  return userOp.requestType !== 'standard'
}

export function getPreVerificationGas(
  userOperation: UserOperation,
  usesPaymaster: boolean,
  l1FeeAsL2Gas: bigint = 0n
): string {
  const abiCoder = new AbiCoder()
  const localUserOp = { ...userOperation }

  // set fake properties for better estimation
  localUserOp.signature = getSigForCalculations()

  if (usesPaymaster) {
    localUserOp.paymasterAndData = getPaymasterSpoof()
  }
  if (shouldUseOneTimeNonce(localUserOp)) {
    localUserOp.nonce = getOneTimeNonce(localUserOp)
  }

  const packed = abiCoder.encode(
    [
      'tuple(address, uint256, bytes, bytes, uint256, uint256, uint256, uint256, uint256, bytes, bytes)'
    ],
    [Object.values(getCleanUserOp(localUserOp)[0])]
  )
  return toBeHex(21000n + calculateCallDataCost(packed) + l1FeeAsL2Gas)
}

export function toUserOperation(
  account: Account,
  accountState: AccountOnchainState,
  accountOp: AccountOp
): UserOperation {
  let initCode = '0x'
  let requestType = 'standard'

  // if the account is not deployed, prepare the deploy in the initCode
  if (!accountState.isDeployed) {
    if (!account.creation) throw new Error('Account creation properties are missing')

    const ambireAccountFactory = new BaseContract(
      account.creation.factoryAddr,
      AmbireAccountFactory.abi
    )
    initCode = hexlify(
      concat([
        account.creation.factoryAddr,
        ambireAccountFactory.interface.encodeFunctionData('deploy', [
          account.creation.bytecode,
          account.creation.salt
        ])
      ])
    )

    requestType = 'activator'
  }

  const userOperation: any = {
    sender: accountOp.accountAddr,
    nonce: toBeHex(accountState.erc4337Nonce),
    initCode,
    callData: '0x',
    preVerificationGas: toBeHex(0),
    callGasLimit: 20000000n,
    verificationGasLimit: '0x',
    maxFeePerGas: toBeHex(1),
    maxPriorityFeePerGas: toBeHex(1),
    paymasterAndData: getPaymasterSpoof(),
    signature:
      '0x0dc2d37f7b285a2243b2e1e6ba7195c578c72b395c0f76556f8961b0bca97ddc44e2d7a249598f56081a375837d2b82414c3c94940db3c1e64110108021161ca1c01'
  }

  // give permissions to the entry if there aren't nay
  const localAccOp = { ...accountOp }
  const ambireAccount = new BaseContract(accountOp.accountAddr, AmbireAccount.abi)
  if (!accountState.isErc4337Enabled) {
    const activatorCall = getActivatorCall(accountOp.accountAddr)
    userOperation.activatorCall = activatorCall
    localAccOp.activatorCall = activatorCall
    requestType = 'activator'
  }

  // get estimation calldata
  if (requestType !== 'standard') {
    const abiCoder = new AbiCoder()
    const spoofSig = abiCoder.encode(['address'], [account.associatedKeys[0]]) + SPOOF_SIGTYPE
    userOperation.callData = ambireAccount.interface.encodeFunctionData('executeMultiple', [
      [[getSignableCalls(localAccOp), spoofSig]]
    ])
    userOperation.verificationGasLimit = 250000n
  } else {
    userOperation.callData = ambireAccount.interface.encodeFunctionData('executeBySender', [
      getSignableCalls(localAccOp)
    ])
    userOperation.verificationGasLimit = 150000n
  }

  userOperation.preVerificationGas = getPreVerificationGas(userOperation, true)
  userOperation.paymasterAndData = '0x'
  userOperation.signature = '0x'
  userOperation.requestType = requestType
  return userOperation
}

export function shouldUsePaymaster(network: NetworkDescriptor): boolean {
  // if there's a paymaster on the network, we pay with it. Simple
  return !!network.erc4337?.hasPaymaster
}

export function isErc4337Broadcast(
  network: NetworkDescriptor,
  accountState: AccountOnchainState
): boolean {
  // write long to fix typescript issues
  const isEnabled = network && network.erc4337 ? network.erc4337.enabled : false

  // if the entry point is not a signer in the account and we don't have a paymaster,
  // we cannot do an ERC-4337 broadcast as that happens either through
  // the entry point or the paymaster
  const isEntryPointSignerOrNetworkHasPaymaster =
    accountState.isErc4337Enabled || shouldUsePaymaster(network)

  return isEnabled && isEntryPointSignerOrNetworkHasPaymaster && accountState.isV2
}

// if the account is v2 account that does not have the entry point as a signer
// and the network is a 4337 one without a paymaster, the only way to broadcast
// a txn is through EOA pays for SA. That's why we need this check to include
// the activator call and the next txn to be ERC-4337
export function shouldIncludeActivatorCall(
  network: NetworkDescriptor,
  accountState: AccountOnchainState
) {
  return accountState.isV2 && network.erc4337.enabled && !accountState.isErc4337Enabled
}
