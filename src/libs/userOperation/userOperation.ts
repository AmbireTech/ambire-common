import { ethers } from "hardhat";
import { Account, AccountOnchainState } from "../../interfaces/account";
import { AccountOp, callToTuple } from "../accountOp/accountOp";
import AmbireAccount from "../../../contracts/compiled/AmbireAccount.json";

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

export function toUserOperation(account: Account, accountState: AccountOnchainState, accountOp: AccountOp) {
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

  return {
    sender: accountOp.accountAddr,
    nonce: accountOp.nonce,
    initCode,
    callData: ambireAccount.interface.encodeFunctionData('executeBySender', [accountOp.calls.map(call => callToTuple(call))]),
    callGasLimit: '',
    verificationGasLimit: '',
    preVerificationGas: '',
    maxFeePerGas: '',
    maxPriorityFeePerGas: '',
    paymasterAndData: '0x',
    signature: '0x',
  }
}