import { ethers } from "ethers";
import { Account, AccountOnchainState } from "../../interfaces/account";
import { AccountOp, callToTuple } from "../accountOp/accountOp";
import AmbireAccount from "../../../contracts/compiled/AmbireAccount.json";
import { EstimateResult } from "../../libs/estimate/estimate";
import { ENTRY_POINT_MARKER, ERC_4337_ENTRYPOINT } from "../../../src/consts/deploy";
import { networks } from "../../consts/networks";
import { NetworkDescriptor } from "interfaces/networkDescriptor";

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

/**
 * The logic goes like this:
 * - hardcoded FIXED_OVERHEAD of 2100
 * - 4 gas cost for each 0 byte in the callData
 * - 16 gas cost for each 1 byte in the callData
 *
 * @param callData userOperation.callData
 * @returns string hex preVerificationGas
 */
function getPreverificationGas(callData: string) {
  const FIXED_OVERHEAD = 2100
	const bytes = Buffer.from(callData.substring(2))
	const nonZeroBytes = bytes.filter(b => b).length
	const zeroBytes = bytes.length - nonZeroBytes
	const txDataGas = zeroBytes * 4 + nonZeroBytes * 16
  return ethers.toBeHex(txDataGas + FIXED_OVERHEAD)
}

/**
 * We measured the minimum gas needed for each step
 * and hardcoded it
 *
 * @param initCode is the contract going to be deployed from now
 * @returns verificationGasLimit
 */
function getVerificationGasLimit(initCode: string, network: NetworkDescriptor | undefined) {
  let initial = 10195 // validateUserOp

  if (network && network.erc4337?.hasPaymaster) {
    initial += 7671 // paymaster payment
  } else {
    initial += 29053 // native payment
  }

  if (initCode != '0x') initial += 77651 // deploy
  initial += 3000 // hardcoded gas buffer just in case
  return initial
}

export function toUserOperation(
  account: Account,
  accountState: AccountOnchainState,
  accountOp: AccountOp,
  estimation: EstimateResult
): UserOperation {
  if (!accountOp.gasFeePayment || !accountOp.gasFeePayment.amount) {
    throw new Error('no gasFeePayment')
  }

  const ambireAccount = new ethers.BaseContract(accountOp.accountAddr, AmbireAccount.abi)
  let initCode = '0x'
  let isEdgeCase = false

  // if the account is not deployed, prepare the deploy in the initCode
  if (!accountState.isDeployed) {
    if (!account.creation) throw new Error('Account creation properties are missing')

    initCode = ethers.hexlify(ethers.concat([
      account.creation.factoryAddr,
      ambireAccount.interface.encodeFunctionData(
        'deploy',
        [account.creation.bytecode, account.creation.salt]
      )
    ]))

    // give permissions to the entry point from here
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

  // if we're in the edge case scenario, we set callData to 0x
  // as callData will be executeMultiple. That will be handled at sign.
  // If not, point to executeBySender as it should be
  const callData = !isEdgeCase
    ? ambireAccount.interface.encodeFunctionData('executeBySender', [accountOp.calls.map(call => callToTuple(call))])
    : '0x'
  // if we're in the edge case scenario, we've set callData to 0x
  // we need callData for preVerificationGas
  // that's why we put a semi-correct call to executeMultiple as fake call data
  // to simulate the real one
  const preVerificationCallData = !isEdgeCase
    ? callData
    : ambireAccount.interface.encodeFunctionData('executeMultiple', [
      [
        accountOp.calls.map(call => callToTuple(call)),
        '0x0dc2d37f7b285a2243b2e1e6ba7195c578c72b395c0f76556f8961b0bca97ddc44e2d7a249598f56081a375837d2b82414c3c94940db3c1e64110108021161ca1c01'
      ]
    ])
  const preVerificationGas = getPreverificationGas(preVerificationCallData)
  const network = networks.find(net => net.id == accountOp.networkId)
  const verificationGasLimit = getVerificationGasLimit(initCode, network)
  const callGasLimit = accountOp.gasFeePayment.simulatedGasLimit
  const maxFeePerGas = (
    accountOp.gasFeePayment.amount - estimation.addedNative
  ) / accountOp.gasFeePayment.simulatedGasLimit

  return {
    sender: accountOp.accountAddr,
    nonce: accountOp.nonce ? ethers.hexlify(accountOp.nonce.toString()) : ethers.toBeHex(0,1),
    initCode,
    callData,
    callGasLimit: ethers.toBeHex(callGasLimit),
    verificationGasLimit: ethers.toBeHex(verificationGasLimit),
    preVerificationGas,
    maxFeePerGas: ethers.toBeHex(maxFeePerGas),
    maxPriorityFeePerGas: ethers.toBeHex(maxFeePerGas),
    paymasterAndData: '0x',
    signature: '0x',
    isEdgeCase
  }
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