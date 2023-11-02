import { ethers } from "ethers";
import { Account, AccountOnchainState } from "../../interfaces/account";
import { AccountOp, callToTuple } from "../accountOp/accountOp";
import AmbireAccount from "../../../contracts/compiled/AmbireAccount.json";
import AmbireAccountFactory from "../../../contracts/compiled/AmbireAccountFactory.json";
import { EstimateResult } from "../../libs/estimate/estimate";
import { ENTRY_POINT_MARKER, ERC_4337_ENTRYPOINT } from "../../../src/consts/deploy";
import { networks } from "../../consts/networks";
import { NetworkDescriptor } from "interfaces/networkDescriptor";
import { getCallDataAdditional } from "../../libs/gasPrice/gasPrice";

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
function getVerificationGasLimit(initCode: string, network: NetworkDescriptor | undefined): bigint {
  // TODO<Bobby>: review all the gas calculations once again

  let initial = 10195n // validateUserOp
  initial += 21000n // smart contract call

  if (network && network.erc4337?.hasPaymaster) {
    initial += 23013n // paymaster payment
  } else {
    initial += 29053n // native payment
  }

  if (initCode != '0x') initial += 77651n // deploy
  initial += 3000n // hardcoded gas buffer just in case
  return initial
}

export function toUserOperation(
  account: Account,
  accountState: AccountOnchainState,
  accountOp: AccountOp,
  estimation: EstimateResult
): AccountOp {
  if (!accountOp.gasFeePayment || !accountOp.gasFeePayment.amount) {
    throw new Error('no gasFeePayment')
  }

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

  // if we're in the edge case scenario, we set callData to 0x
  // as callData will be executeMultiple. That will be handled at sign.
  // If not, point to executeBySender as it should be
  const callData = !isEdgeCase
    ? ambireAccount.interface.encodeFunctionData('executeBySender', [accountOp.calls.map(call => callToTuple(call))])
    : '0x'
  const network = networks.find(net => net.id == accountOp.networkId)
  const preVerificationGas = getCallDataAdditional(accountOp, network!, accountState.isDeployed)
  const verificationGasLimit = getVerificationGasLimit(initCode, network)
  const maxFeePerGas = (
    accountOp.gasFeePayment.amount - estimation.addedNative
  ) / accountOp.gasFeePayment.simulatedGasLimit

  accountOp.asUserOperation = {
    sender: accountOp.accountAddr,
    nonce: ethers.toBeHex(accountState.erc4337Nonce),
    initCode,
    callData,
    callGasLimit: ethers.toBeHex(accountOp.gasFeePayment.simulatedGasLimit),
    verificationGasLimit: ethers.toBeHex(verificationGasLimit),
    preVerificationGas: ethers.toBeHex(preVerificationGas),
    maxFeePerGas: ethers.toBeHex(maxFeePerGas),
    maxPriorityFeePerGas: ethers.toBeHex(maxFeePerGas),
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