import { TransactionReceipt, ZeroAddress } from 'ethers'

import { BUNDLER } from '../../consts/bundlers'
import { Fetch } from '../../interfaces/fetch'
import { Network } from '../../interfaces/network'
import { getBundlerByName, getDefaultBundler } from '../../services/bundlers/getBundler'
import { fetchUserOp } from '../../services/explorers/jiffyscan'
import { AccountOp } from './accountOp'
import { AccountOpStatus, Call } from './types'

/*
 * AccountOpIdentifiedBy
 * The txnId may not neceseraly be final on the moment of broadcast.
 * It is final when the type is Transaction. This is the case when we do
 * a regular EOA broadcast (including SA EOA broadcast)
 * The relayer and bundler work differently, though. The relayer may sometimes
 * decide not to return a txnId at all if it decides the current gas prices
 * are too high for the transaction. Also, it may return a txnId only to
 * replace it with another if the conditions meet. Here is an example:
 * - you broadcast a transaction on slow and the relayer returns a txnId
 * - at the same time another person broadcasts via the relayer, fast speed
 * - the relayer sees- that the second txn's chances of getting confirmed sooner
 * are higher and replaces the current one with the RBF logic
 * - at a later stage, the relayer re-broadcasts the first txn but since it's
 * a different nonce and signature, the txnId also differs
 * That's why we cannot rely on txnId for smart accounts in the relayer
 * broadcast case to fetch information about the transaction. Instead, the
 * relayer will return a database ID record of the transaction and we will be
 * refetching the txnId from the relayer until the transaction gets mined.
 *
 * The same logic is true for userOps and bundler broadcast. In the case of
 * userOps, the only difference is that we get a userOpHash instead of a
 * database ID record
 */
export type AccountOpIdentifiedBy = {
  type: 'Transaction' | 'UserOperation' | 'Relayer' | 'MultipleTxns'
  identifier: string
  bundler?: BUNDLER
}

export interface SubmittedAccountOp extends AccountOp {
  txnId?: string
  nonce: bigint
  success?: boolean
  timestamp: number
  isSingletonDeploy?: boolean
  identifiedBy: AccountOpIdentifiedBy
  flags?: {
    hideActivityBanner?: boolean
  }
}

export function isIdentifiedByTxn(identifiedBy: AccountOpIdentifiedBy): boolean {
  return identifiedBy && identifiedBy.type === 'Transaction'
}

export function isIdentifiedByUserOpHash(identifiedBy: AccountOpIdentifiedBy): boolean {
  return identifiedBy && identifiedBy.type === 'UserOperation'
}

export function isIdentifiedByRelayer(identifiedBy: AccountOpIdentifiedBy): boolean {
  return identifiedBy && identifiedBy.type === 'Relayer'
}

export function isIdentifiedByMultipleTxn(identifiedBy: AccountOpIdentifiedBy): boolean {
  return identifiedBy && identifiedBy.type === 'MultipleTxns'
}

export function getDappIdentifier(op: SubmittedAccountOp) {
  let hash = `${op.identifiedBy.type}:${op.identifiedBy.identifier}`
  if (op.identifiedBy?.bundler) hash = `${hash}:${op.identifiedBy.bundler}`
  return hash
}

export function getMultipleBroadcastUnconfirmedCallOrLast(op: AccountOp): {
  call: Call
  callIndex: number
} {
  // get the first BroadcastedButNotConfirmed call if any
  for (let i = 0; i < op.calls.length; i++) {
    const currentCall = op.calls[i]
    if (currentCall.status === AccountOpStatus.BroadcastedButNotConfirmed)
      return { call: currentCall, callIndex: i }
  }

  // if no BroadcastedButNotConfirmed, get the last one
  return { call: op.calls[op.calls.length - 1], callIndex: op.calls.length - 1 }
}

export async function fetchTxnId(
  identifiedBy: AccountOpIdentifiedBy,
  network: Network,
  fetchFn: Fetch,
  callRelayer: Function,
  op?: AccountOp
): Promise<{ status: string; txnId: string | null }> {
  if (isIdentifiedByTxn(identifiedBy))
    return {
      status: 'success',
      txnId: identifiedBy.identifier
    }

  if (isIdentifiedByMultipleTxn(identifiedBy)) {
    if (op) {
      return {
        status: 'success',
        txnId: getMultipleBroadcastUnconfirmedCallOrLast(op).call.txnId as string
      }
    }

    // always return the last txn id if no account op
    const txnIds = identifiedBy.identifier.split('-')
    return {
      status: 'success',
      txnId: txnIds[txnIds.length - 1]
    }
  }

  if (isIdentifiedByUserOpHash(identifiedBy)) {
    const userOpHash = identifiedBy.identifier

    const bundler = identifiedBy.bundler
      ? getBundlerByName(identifiedBy.bundler)
      : getDefaultBundler(network)

    const [response, bundlerResult]: [any, any] = await Promise.all([
      fetchUserOp(userOpHash, fetchFn),
      bundler.getStatus(network, userOpHash)
    ])

    if (bundlerResult.status === 'rejected')
      return {
        status: 'rejected',
        txnId: null
      }

    if (bundlerResult.transactionHash)
      return {
        status: 'success',
        txnId: bundlerResult.transactionHash
      }

    // on custom networks the response is null
    if (!response)
      return {
        status: 'not_found',
        txnId: null
      }

    // nothing we can do if we don't have information
    if (response.status !== 200)
      return {
        status: 'not_found',
        txnId: null
      }

    const data = await response.json()
    const userOps = data.userOps

    // if there are not user ops, it means the userOpHash is not
    // indexed, yet, so we wait
    if (userOps.length)
      return {
        status: 'success',
        txnId: userOps[0].transactionHash
      }

    return {
      status: 'not_found',
      txnId: null
    }
  }

  const id = identifiedBy.identifier
  let response = null
  try {
    response = await callRelayer(`/v2/get-txn-id/${id}`)
  } catch (e) {
    // eslint-disable-next-line no-console
    console.log(`relayer responded with an error when trying to find the txnId: ${e}`)
    return {
      status: 'not_found',
      txnId: null
    }
  }

  if (!response.data.txId) {
    if (op && op.txnId)
      return {
        status: 'success',
        txnId: op.txnId
      }
    return {
      status: 'not_found',
      txnId: null
    }
  }

  return {
    status: 'success',
    txnId: response.data.txId
  }
}

export async function pollTxnId(
  identifiedBy: AccountOpIdentifiedBy,
  network: Network,
  fetchFn: Fetch,
  callRelayer: Function,
  failCount = 0
): Promise<string | null> {
  // allow 8 retries and declate fetching the txnId a failure after
  if (failCount >= 8) return null

  const fetchTxnIdResult = await fetchTxnId(identifiedBy, network, fetchFn, callRelayer)
  if (fetchTxnIdResult.status === 'rejected') return null

  if (fetchTxnIdResult.status === 'not_found') {
    const delayPromise = () =>
      new Promise((resolve) => {
        setTimeout(resolve, 1500)
      })
    await delayPromise()
    const increase = failCount + 1
    return pollTxnId(identifiedBy, network, fetchFn, callRelayer, increase)
  }

  return fetchTxnIdResult.txnId
}

export function updateOpStatus(
  // IMPORTANT: pass a reference to this.#accountsOps[accAddr][networkId][index]
  // so we could mutate it from inside this method
  opReference: SubmittedAccountOp,
  status: AccountOpStatus,
  receipt?: TransactionReceipt
): SubmittedAccountOp | null {
  if (opReference.identifiedBy.type === 'MultipleTxns') {
    const callIndex = getMultipleBroadcastUnconfirmedCallOrLast(opReference).callIndex
    // eslint-disable-next-line no-param-reassign
    opReference.calls[callIndex].status = status

    // if there's a receipt, add the fee
    if (receipt) {
      // eslint-disable-next-line no-param-reassign
      opReference.calls[callIndex].fee = {
        inToken: ZeroAddress,
        amount: receipt.fee
      }
    }

    if (callIndex === opReference.calls.length - 1) {
      // eslint-disable-next-line no-param-reassign
      opReference.status = status
      return opReference
    }

    // returning null here means the accountOp as a whole is still not ready
    // to be updated as there are still pending transaction to be confirmed
    return null
  }

  // eslint-disable-next-line no-param-reassign
  opReference.status = status
  return opReference
}
