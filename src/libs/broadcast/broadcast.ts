import { Interface, toQuantity, TransactionResponse } from 'ethers'

import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import AmbireFactory from '../../../contracts/compiled/AmbireFactory.json'
import ERC20 from '../../../contracts/compiled/IERC20.json'
import { Account, AccountOnchainState } from '../../interfaces/account'
import { Hex } from '../../interfaces/hex'
import { TxnRequest } from '../../interfaces/keystore'
import { Network } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import { getSafeBroadcastTxn } from '../../libs/safe/helpers'
import wait from '../../utils/wait'
import { AccountOp, GasFeePayment, getSignableCalls } from '../accountOp/accountOp'
import { Call } from '../accountOp/types'
import { getErrorCodeStringFromReason } from '../errorDecoder/helpers'

const erc20interface = new Interface(ERC20.abi)

export const BROADCAST_OPTIONS = {
  bySelf: 'self', // standard txn
  bySelf7702: 'self7702', // executeBySender
  byBundler: 'bundler', // userOp
  byRelayer: 'relayer', // execute
  byOtherEOA: 'otherEOA', // execute + standard
  delegation: 'delegation' // txn type 4
}

async function waitBeforeRetry(chainId: bigint) {
  // block time at ethereum is bigger, so we wait 3s per failures
  await wait(chainId === 1n ? 3000 : 1500)
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
  chainId: bigint,
  error?: Error,
  counter: number = 0
): Promise<bigint> {
  // this should happen only in the case of internet issues
  if (counter > 10) {
    throw new Error(
      `Failed estimating gas for broadcast${
        error ? `: ${getErrorCodeStringFromReason(error.message)}` : ''
      }`
    )
  }

  const callEstimateGas = provider
    .send('eth_estimateGas', [
      {
        from,
        to: call.to,
        value: toQuantity(call.value),
        data: call.data,
        nonce: toQuantity(nonce)
      },
      'pending'
    ])
    .catch((e) => e)
  const callGetNonce = provider.getTransactionCount(from).catch(() => null)
  const [gasLimit, foundNonce] = await Promise.all([callEstimateGas, callGetNonce])

  // imagine a batch with two swaps, 4 txns total. Both swaps have the same from token
  // and from token amount. So #1 & #3 is an approval. #2 spends the approval.
  // when it's time to estimate #3, if the RPC doesn't know about #2, it will return
  // a lower gas for the transaction as the old state hasn't spent the approval =>
  // no storage writing. This results in an out of gas error on the #3 txn broadacst.
  // To fix this, we ensure there's no nonce discrepancy upon broadcast, meaning
  // the RPC knows about the previous txn that spends the approval, hence returning
  // the correct gasLimit for the call
  let hasNonceDiscrepancyOnApproval = nonce !== foundNonce
  if (hasNonceDiscrepancyOnApproval) {
    try {
      hasNonceDiscrepancyOnApproval =
        call.data !== '0x' && !!erc20interface.decodeFunctionData('approve', call.data)
    } catch (e) {
      hasNonceDiscrepancyOnApproval = false
    }
  }

  // if there's an error, wait a bit and retry
  // the error is most likely because of an incorrect RPC pending state
  if (gasLimit instanceof Error || hasNonceDiscrepancyOnApproval) {
    // if the gasLimit is throwing because the smart account is returning INSUFFICIENT_PRIVILEGE,
    // return the error without retrying
    if (gasLimit instanceof Error && gasLimit.message.includes('INSUFFICIENT_PRIVILEGE'))
      throw gasLimit

    await waitBeforeRetry(chainId)
    return estimateGas(provider, from, call, nonce, chainId, gasLimit, counter + 1)
  }

  // add a 10% overhead to prevent OOG
  return BigInt(gasLimit) + BigInt(gasLimit) / 10n
}

export async function getTxnData(
  account: Account,
  op: AccountOp,
  accountState: AccountOnchainState,
  provider: RPCProvider,
  broadcastOption: string,
  nonce: number,
  call?: Call
): Promise<{ to: Hex | undefined; value: bigint; data: Hex; gasLimit?: bigint }> {
  if (account.safeCreation) {
    const safeData = getSafeBroadcastTxn(op, accountState)
    return {
      ...safeData,
      gasLimit: (op.gasFeePayment as GasFeePayment).simulatedGasLimit
    }
  }

  // no need to estimate gas for delegation, it's already estimated
  if (broadcastOption === BROADCAST_OPTIONS.delegation) {
    if (op.calls.length > 1) {
      const ambireAccount = new Interface(AmbireAccount.abi)
      return {
        to: account.addr as Hex,
        value: 0n,
        data: ambireAccount.encodeFunctionData('executeBySender', [getSignableCalls(op)]) as Hex
      }
    }

    if (!call) throw new Error('single txn broadcast misconfig')
    return {
      to: call.to as Hex | undefined,
      value: call.value,
      data: call.data as Hex,
      gasLimit: (op.gasFeePayment as GasFeePayment).simulatedGasLimit
    }
  }

  if (broadcastOption === BROADCAST_OPTIONS.bySelf) {
    if (!call) throw new Error('single txn broadcast misconfig')

    // if the accountOp has more than 1 calls, we have to calculate the gas
    // for each one seperately
    let gasLimit: bigint | undefined = (op.gasFeePayment as GasFeePayment).simulatedGasLimit
    if (op.calls.length > 1) {
      gasLimit = await estimateGas(provider, account.addr, call, nonce, op.chainId)
    }

    const singleCallTxn = {
      to: call.to as Hex | undefined,
      value: call.value,
      data: call.data as Hex,
      gasLimit
    }

    return singleCallTxn
  }

  if (broadcastOption === BROADCAST_OPTIONS.byOtherEOA) {
    const otherEOACall = getByOtherEOATxnData(account, op, accountState)
    const gasLimit = await estimateGas(
      provider,
      (op.gasFeePayment as GasFeePayment).paidBy,
      otherEOACall,
      nonce,
      op.chainId
    )
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
    ...txnData,
    ...(gasFeePayment.isCustomGasLimit ? { gasLimit: gasFeePayment.simulatedGasLimit } : {})
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

export async function broadcastTransaction(
  provider: RPCProvider,
  signedTx: string,
  chainId: bigint,
  counter: number = 0
): Promise<TransactionResponse> {
  if (counter > 2) throw new Error('broadcast failed')
  try {
    return provider.broadcastTransaction(signedTx)
  } catch (e) {
    console.log('broadcast failed: ', e)
    await waitBeforeRetry(chainId)
    return broadcastTransaction(provider, signedTx, chainId, counter + 1)
  }
}
