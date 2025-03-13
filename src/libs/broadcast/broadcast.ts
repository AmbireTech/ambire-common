import { Interface } from 'ethers'
import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import AmbireFactory from '../../../contracts/compiled/AmbireFactory.json'
import { Account, AccountOnchainState } from '../../interfaces/account'
import { Hex } from '../../interfaces/hex'
import { TxnRequest } from '../../interfaces/keystore'
import { Network } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import wait from '../../utils/wait'
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

// estimate the gas for the call
async function estimateGas(
  provider: RPCProvider,
  from: string,
  call: Call,
  nonce: number,
  counter: number = 0
): Promise<bigint> {
  // this should happen only in the case of internet issues
  if (counter > 10) throw new Error('Failed estimating gas from broadcast')

  const gasLimit = await provider
    .estimateGas({
      from,
      to: call.to,
      value: call.value,
      data: call.data,
      nonce,
      blockTag: 'pending'
    })
    .catch((e) => e)

  // if there's an error, wait a bit and retry
  // the error is most likely because of an incorrect RPC pending state
  if (gasLimit instanceof Error) {
    await wait(1500)
    return estimateGas(provider, from, call, nonce, counter + 1)
  }

  return gasLimit
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
      gasLimit = await estimateGas(provider, account.addr, call, nonce)
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
    const otherEOACall = getByOtherEOATxnData(account, op, accountState)
    const gasLimit = await estimateGas(provider, account.addr, otherEOACall, nonce)
    return { ...otherEOACall, gasLimit }
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
