import { ethers } from "ethers";
import { Account, AccountOnchainState } from "../../interfaces/account";
import { AccountOp, getSignableCalls } from "../accountOp/accountOp";
import AmbireAccount from "../../../contracts/compiled/AmbireAccount.json";
import AmbireAccountFactory from "../../../contracts/compiled/AmbireAccountFactory.json";
import { AMBIRE_PAYMASTER, AMBIRE_PAYMASTER_SIGNER, ENTRY_POINT_MARKER, ERC_4337_ENTRYPOINT } from "../../../src/consts/deploy";
import { NetworkDescriptor } from "interfaces/networkDescriptor";
import { SPOOF_SIGTYPE } from "../../consts/signatures";

export interface UserOperation {
  sender: string,
  nonce: string, // hex string
  initCode: string, // hex string
  callData: string, // hex string
  callGasLimit: string, // hex string
  verificationGasLimit: string, // hex string
  preVerificationGas: string, // hex string
  maxFeePerGas: string, // hex string
  maxPriorityFeePerGas: string, // hex string
  paymasterAndData: string, // hex string
  signature: string, // hex string
  // https://github.com/AmbireTech/ambire-app/wiki/Ambire-Flows-(wrap,-sign,-payment,-broadcast)#erc-4337-edge-case
  isEdgeCase: boolean,
}

export function calculateCallDataCost(callData: string): bigint {
  if (callData === '0x') return 0n
  const bytes = Buffer.from(callData.substring(2))
  const nonZeroBytes = BigInt(bytes.filter(b => b).length)
  const zeroBytes = BigInt(BigInt(bytes.length) - nonZeroBytes)
  return zeroBytes * 4n + nonZeroBytes * 16n
}

export function toUserOperation(
  account: Account,
  accountState: AccountOnchainState,
  accountOp: AccountOp
): AccountOp {
  let initCode = '0x'
  let isEdgeCase = false

  // if the account is not deployed, prepare the deploy in the initCode
  if (!accountState.isDeployed) {
    if (!account.creation) throw new Error('Account creation properties are missing')

    const ambireAccountFactory = new ethers.BaseContract(
      account.creation.factoryAddr,
      AmbireAccountFactory.abi,
    )
    initCode = ethers.hexlify(ethers.concat([
      account.creation.factoryAddr,
      ambireAccountFactory.interface.encodeFunctionData(
        'deploy',
        [account.creation.bytecode, account.creation.salt]
      )
    ]))

    isEdgeCase = true
  }

  // give permissions to the entry if there aren't nay
  const ambireAccount = new ethers.BaseContract(accountOp.accountAddr, AmbireAccount.abi)
  if (!accountState.isErc4337Enabled) {
    const givePermsToEntryPointData = ambireAccount.interface.encodeFunctionData('setAddrPrivilege', [
      ERC_4337_ENTRYPOINT,
      ENTRY_POINT_MARKER
    ])
    accountOp.calls.push({
      to: accountOp.accountAddr,
      value: 0n,
      data: givePermsToEntryPointData
    })

    isEdgeCase = true
  }

  // get estimation calldata
  let callData
  if (isEdgeCase) {
    const abiCoder = new ethers.AbiCoder()
    const spoofSig = abiCoder.encode(['address'], [account.associatedKeys[0]]) + SPOOF_SIGTYPE
    callData = ambireAccount.interface.encodeFunctionData('executeMultiple', [[[
      getSignableCalls(accountOp),
      spoofSig
    ]]])
  } else {
    callData = ambireAccount.interface.encodeFunctionData('executeBySender', [getSignableCalls(accountOp)])
  }

  // 27000n initial + deploy, callData, paymaster, signature
  let preVerificationGas = 27000n
  preVerificationGas += calculateCallDataCost(initCode)
  preVerificationGas += calculateCallDataCost(getPaymasterSpoof())
  preVerificationGas += calculateCallDataCost(
    '0x0dc2d37f7b285a2243b2e1e6ba7195c578c72b395c0f76556f8961b0bca97ddc44e2d7a249598f56081a375837d2b82414c3c94940db3c1e64110108021161ca1c01'
  ) // signature

  accountOp.asUserOperation = {
    sender: accountOp.accountAddr,
    nonce: ethers.toBeHex(accountState.erc4337Nonce),
    initCode,
    callData,
    preVerificationGas: ethers.toBeHex(preVerificationGas),
    callGasLimit: ethers.toBeHex(150000), // hardcoded fake for estimation
    verificationGasLimit: ethers.toBeHex(150000), // hardcoded fake for estimation
    maxFeePerGas: ethers.toBeHex(100),
    maxPriorityFeePerGas: ethers.toBeHex(100),
    paymasterAndData: '0x',
    signature: '0x',
    isEdgeCase
  }

  return accountOp
}

/**
 * Get the target nonce we're expecting in validateUserOp
 * when we're going through the edge case
 *
 * @param UserOperation userOperation
 * @returns hex string
 */
export function getTargetEdgeCaseNonce(userOperation: UserOperation) {
  const abiCoder = new ethers.AbiCoder()
  return '0x' + ethers.keccak256(
    abiCoder.encode([
      'bytes',
      'bytes',
      'uint256',
      'uint256',
      'uint256',
      'uint256',
      'uint256',
      'bytes',
    ], [
      userOperation.initCode,
      userOperation.callData,
      userOperation.callGasLimit,
      userOperation.verificationGasLimit,
      userOperation.preVerificationGas,
      userOperation.maxFeePerGas,
      userOperation.maxPriorityFeePerGas,
      userOperation.paymasterAndData,
    ])
  ).substring(18) + ethers.toBeHex(0, 8).substring(2)
}

export function getPaymasterSpoof() {
  const abiCoder = new ethers.AbiCoder()
  const spoofSig = abiCoder.encode(['address'], [AMBIRE_PAYMASTER_SIGNER]) + SPOOF_SIGTYPE
  const simulationData = abiCoder.encode(
    ['uint48', 'uint48', 'bytes'],
    [0, 0, spoofSig]
  )
  return ethers.hexlify(ethers.concat([
    AMBIRE_PAYMASTER,
    simulationData
  ]))
}

export function isErc4337Broadcast(network: NetworkDescriptor, accountState: AccountOnchainState): boolean {
  // write long to fix typescript issues
  const isEnabled = network && network.erc4337
    ? network.erc4337.enabled
    : false

    return (isEnabled && accountState.isV2)
}
