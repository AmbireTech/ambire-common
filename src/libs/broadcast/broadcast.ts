import { Interface } from 'ethers'
import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import AmbireFactory from '../../../contracts/compiled/AmbireFactory.json'
import { Account, AccountOnchainState } from '../../interfaces/account'
import { Hex } from '../../interfaces/hex'
import { TxnRequest } from '../../interfaces/keystore'
import { Network } from '../../interfaces/network'
import { AccountOp, GasFeePayment, getSignableCalls } from '../accountOp/accountOp'

export const BROADCAST_OPTIONS = {
  bySelf: 'self', // standard txn
  bySelf7702: 'self7702', // executeBySender
  byBundler: 'bundler', // userOp
  byRelayer: 'relayer', // execute
  byOtherEOA: 'otherEOA' // execute + standard
}

export function getByOtherEOATxnData(
  account: Account,
  op: AccountOp,
  accountState: AccountOnchainState
): { to: Hex; value: bigint; data: Hex } {
  if (accountState.isDeployed) {
    const ambireAccount = new Interface(AmbireAccount.abi)
    return {
      to: op.accountAddr as Hex,
      value: 0n,
      data: ambireAccount.encodeFunctionData('execute', [getSignableCalls(op), op.signature]) as Hex
    }
  }

  const ambireFactory = new Interface(AmbireFactory.abi)
  return {
    to: account.creation!.factoryAddr as Hex,
    value: 0n,
    data: ambireFactory.encodeFunctionData('deployAndExecute', [
      account.creation!.bytecode,
      account.creation!.salt,
      getSignableCalls(op),
      op.signature
    ]) as Hex
  }
}

export function getTxnData(
  account: Account,
  op: AccountOp,
  accountState: AccountOnchainState,
  broadcastOption: string
): { to: Hex; value: bigint; data: Hex } {
  if (broadcastOption === BROADCAST_OPTIONS.bySelf) {
    return {
      to: op.calls[0].to as Hex,
      value: op.calls[0].value,
      data: op.calls[0].data as Hex
    }
  }

  if (broadcastOption === BROADCAST_OPTIONS.byOtherEOA) {
    return getByOtherEOATxnData(account, op, accountState)
  }

  // 7702 executeBySender
  const ambireAccount = new Interface(AmbireAccount.abi)
  return {
    to: account.addr as Hex,
    value: 0n,
    data: ambireAccount.encodeFunctionData('executeBySender', [getSignableCalls(op)]) as Hex
  }
}

export function buildRawTransaction(
  account: Account,
  op: AccountOp,
  accountState: AccountOnchainState,
  network: Network,
  nonce: number,
  broadcastOption: string
): TxnRequest {
  const gasFeePayment = op.gasFeePayment as GasFeePayment

  const rawTxn: TxnRequest = {
    chainId: network.chainId,
    nonce,
    gasLimit: gasFeePayment.simulatedGasLimit,
    ...getTxnData(account, op, accountState, broadcastOption)
  }

  if (gasFeePayment.maxPriorityFeePerGas !== undefined) {
    rawTxn.maxFeePerGas = gasFeePayment.gasPrice
    rawTxn.maxPriorityFeePerGas = gasFeePayment.maxPriorityFeePerGas
    rawTxn.type = 2
  } else {
    rawTxn.gasPrice = gasFeePayment.gasPrice
    rawTxn.type = 0
  }

  return rawTxn
}
