import { ethers } from 'ethers'
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
import { Account, AccountOnchainState } from '../../interfaces/account'
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
  const abiCoder = new ethers.AbiCoder()
  const spoofSig = abiCoder.encode(['address'], [AMBIRE_PAYMASTER_SIGNER]) + SPOOF_SIGTYPE
  const simulationData = abiCoder.encode(['uint48', 'uint48', 'bytes'], [0, 0, spoofSig])
  return ethers.hexlify(ethers.concat([AMBIRE_PAYMASTER, simulationData]))
}

export function getSigForCalculations() {
  return '0x0dc2d37f7b285a2243b2e1e6ba7195c578c72b395c0f76556f8961b0bca97ddc44e2d7a249598f56081a375837d2b82414c3c94940db3c1e64110108021161ca1c01'
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
  const abiCoder = new ethers.AbiCoder()
  return `0x${ethers
    .keccak256(
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
    )
    .substring(18)}${ethers.toBeHex(0, 8).substring(2)}`
}

export function getPreVerificationGas(
  userOperation: UserOperation,
  usesPaymaster: boolean,
  l1FeeAsL2Gas: bigint = 0n
): string {
  const abiCoder = new ethers.AbiCoder()
  const localUserOp = { ...userOperation }

  // set fake properties for better estimation
  localUserOp.signature = getSigForCalculations()

  if (usesPaymaster) {
    localUserOp.paymasterAndData = getPaymasterSpoof()
  }
  if (userOperation.requestType !== 'standard') {
    localUserOp.nonce = getOneTimeNonce(localUserOp)
  }

  const packed = abiCoder.encode(
    [
      'tuple(address, uint256, bytes, bytes, uint256, uint256, uint256, uint256, uint256, bytes, bytes)'
    ],
    [Object.values(getCleanUserOp(localUserOp)[0])]
  )
  return ethers.toBeHex(21000n + calculateCallDataCost(packed) + l1FeeAsL2Gas)
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

    const ambireAccountFactory = new ethers.BaseContract(
      account.creation.factoryAddr,
      AmbireAccountFactory.abi
    )
    initCode = ethers.hexlify(
      ethers.concat([
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
    nonce: ethers.toBeHex(accountState.erc4337Nonce),
    initCode,
    callData: '0x',
    preVerificationGas: ethers.toBeHex(0),
    callGasLimit: 20000000n,
    verificationGasLimit: '0x',
    maxFeePerGas: ethers.toBeHex(1),
    maxPriorityFeePerGas: ethers.toBeHex(1),
    paymasterAndData: getPaymasterSpoof(),
    signature:
      '0x0dc2d37f7b285a2243b2e1e6ba7195c578c72b395c0f76556f8961b0bca97ddc44e2d7a249598f56081a375837d2b82414c3c94940db3c1e64110108021161ca1c01'
  }

  // give permissions to the entry if there aren't nay
  const ambireAccount = new ethers.BaseContract(accountOp.accountAddr, AmbireAccount.abi)
  if (!accountState.isErc4337Enabled) {
    const givePermsToEntryPointData = ambireAccount.interface.encodeFunctionData(
      'setAddrPrivilege',
      [ERC_4337_ENTRYPOINT, ENTRY_POINT_MARKER]
    )
    userOperation.activatorCall = {
      to: accountOp.accountAddr,
      value: 0n,
      data: givePermsToEntryPointData
    }

    requestType = 'activator'
  }

  // get estimation calldata
  const localAccOp = { ...accountOp }
  localAccOp.asUserOperation = userOperation
  if (requestType !== 'standard') {
    const abiCoder = new ethers.AbiCoder()
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

export function isErc4337Broadcast(
  network: NetworkDescriptor,
  accountState: AccountOnchainState
): boolean {
  // write long to fix typescript issues
  const isEnabled = network && network.erc4337 ? network.erc4337.enabled : false

  return isEnabled && accountState.isV2
}

export function shouldUseOneTimeNonce(userOp: UserOperation) {
  return userOp.requestType !== 'standard'
}

export function shouldUsePaymaster(userOp: UserOperation, feeTokenAddr: string) {
  return (
    userOp.requestType !== 'standard' ||
    feeTokenAddr !== '0x0000000000000000000000000000000000000000'
  )
}
