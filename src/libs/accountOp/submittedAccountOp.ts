import { CustomResponse, Fetch } from '../../interfaces/fetch'
import { Network } from '../../interfaces/network'
import { Bundler } from '../../services/bundlers/bundler'
import { fetchUserOp } from '../../services/explorers/jiffyscan'
import { AccountOp } from './accountOp'

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
type Transaction = 'txnId'
type UserOpHash = {
  userOpHash: string
}
type Relayer = {
  id: 'string'
}
export type AccountOpIdentifiedBy = Transaction | UserOpHash | Relayer

export interface SubmittedAccountOp extends AccountOp {
  txnId?: string
  nonce: bigint
  success?: boolean
  timestamp: number
  isSingletonDeploy?: boolean
  identifiedBy: AccountOpIdentifiedBy
}

export function isIdentifiedByTxn(identifiedBy: AccountOpIdentifiedBy): boolean {
  return identifiedBy === 'txnId'
}

export function isIdentifiedByUserOpHash(identifiedBy: AccountOpIdentifiedBy): boolean {
  return (identifiedBy as UserOpHash).userOpHash !== undefined
}

export function isIdentifiedByRelayer(identifiedBy: AccountOpIdentifiedBy): boolean {
  return (identifiedBy as Relayer).id !== undefined
}

export function getFetchedUserOpHash(identifiedBy: AccountOpIdentifiedBy): string {
  return (identifiedBy as UserOpHash).userOpHash
}

export function getRelayerId(identifiedBy: AccountOpIdentifiedBy): string {
  return (identifiedBy as Relayer).id
}

export async function fetchTxnId(
  op: SubmittedAccountOp | { identifiedBy: AccountOpIdentifiedBy; txnId?: string | null },
  network: Network,
  fetchFn: Fetch,
  callRelayer: Function
): Promise<{ status: string; txnId: string | null }> {
  if (isIdentifiedByTxn(op.identifiedBy))
    return {
      status: 'success',
      txnId: op.txnId as string
    }

  if (isIdentifiedByUserOpHash(op.identifiedBy)) {
    const userOpHash = (op.identifiedBy as UserOpHash).userOpHash
    const [response, bundlerResult]: [CustomResponse | null, any] = await Promise.all([
      fetchUserOp(userOpHash, fetchFn),
      Bundler.getStatusAndTxnId(userOpHash, network)
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

  const id = (op.identifiedBy as Relayer).id
  let response = null
  try {
    response = await callRelayer(`/get-txn-id/${id}`)
  } catch (e) {
    console.log(`relayer responded with an error when trying to find the txnId: ${e}`)
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
  op: SubmittedAccountOp,
  network: Network,
  fetchFn: Fetch,
  callRelayer: Function
): Promise<string | null> {
  const fetchTxnIdResult = await fetchTxnId(op, network, fetchFn, callRelayer)
  if (fetchTxnIdResult.status === 'rejected') return null

  if (fetchTxnIdResult.status === 'not_found') {
    const delayPromise = () =>
      new Promise((resolve) => {
        setTimeout(resolve, 1500)
      })
    await delayPromise()
    return pollTxnId(op, network, fetchFn, callRelayer)
  }

  return fetchTxnIdResult.txnId
}
