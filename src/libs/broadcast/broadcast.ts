import { Interface } from 'ethers'
import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import AmbireFactory from '../../../contracts/compiled/AmbireFactory.json'
import { Account, AccountOnchainState } from '../../interfaces/account'
import { Hex } from '../../interfaces/hex'
import { TxnRequest } from '../../interfaces/keystore'
import { Network } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import { AccountOp, GasFeePayment, getSignableCalls } from '../accountOp/accountOp'
import { Call } from '../accountOp/types'

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

export async function getTxnData(
  account: Account,
  op: AccountOp,
  accountState: AccountOnchainState,
  provider: RPCProvider,
  broadcastOption: string,
  nonce: number,
  call?: Call
): Promise<{ to: Hex; value: bigint; data: Hex; gasLimit?: bigint }> {
  if (broadcastOption === BROADCAST_OPTIONS.bySelf) {
    if (!call) throw new Error('single txn broadcast misconfig')

    // if the accountOp has more than 1 calls, we have to calculate the gas
    // for each one seperately
    let gasLimit: bigint | undefined = (op.gasFeePayment as GasFeePayment).simulatedGasLimit
    if (op.calls.length > 1) {
      gasLimit = await provider
        .estimateGas({
          from: account.addr,
          to: call.to,
          value: call.value,
          data: call.data,
          nonce,
          blockTag: 'pending'
        })
        // TODO: error handling...
        .catch(() => undefined)
    }

    const singleCallTxn = {
      to: call.to as Hex,
      value: call.value,
      data: call.data as Hex,
      gasLimit
    }

    return singleCallTxn
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

export async function buildRawTransaction(
  account: Account,
  op: AccountOp,
  accountState: AccountOnchainState,
  provider: RPCProvider,
  network: Network,
  nonce: number,
  broadcastOption: string,
  call?: Call
): Promise<TxnRequest> {
  const gasFeePayment = op.gasFeePayment as GasFeePayment

  const txnData = await getTxnData(
    account,
    op,
    accountState,
    provider,
    broadcastOption,
    nonce,
    call
  )
  const rawTxn: TxnRequest = {
    chainId: network.chainId,
    nonce,
    gasLimit: gasFeePayment.simulatedGasLimit,
    ...txnData
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
