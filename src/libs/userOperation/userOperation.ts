import { ethers } from "hardhat";
import { Account, AccountOnchainState } from "../../interfaces/account";
import { AccountOp, callToTuple } from "../accountOp/accountOp";
import AmbireAccount from "../../../contracts/compiled/AmbireAccount.json";
import { EstimateResult } from "libs/estimate/estimate";

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
function getVerificationGasLimit(initCode: string) {
  let initial = 10195 // validateUserOp
  initial += 7671 // for using the paymaster
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
  }

  const callData = ambireAccount.interface.encodeFunctionData('executeBySender', [accountOp.calls.map(call => callToTuple(call))])
  const preVerificationGas = getPreverificationGas(callData)
  const verificationGasLimit = getVerificationGasLimit(initCode)
  const callGasLimit = estimation.gasUsed - (BigInt(verificationGasLimit) + BigInt(preVerificationGas))

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
  }
}