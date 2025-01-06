import { Fetch } from '../../interfaces/fetch'
import { Network } from '../../interfaces/network'
import { getDefaultBundler } from '../../services/bundlers/getBundler'
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
export type AccountOpIdentifiedBy = {
  type: 'Transaction' | 'UserOperation' | 'Relayer'
  identifier: string
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
  return identifiedBy.type === 'Transaction'
}

export function isIdentifiedByUserOpHash(identifiedBy: AccountOpIdentifiedBy): boolean {
  return identifiedBy.type === 'UserOperation'
}

export function isIdentifiedByRelayer(identifiedBy: AccountOpIdentifiedBy): boolean {
  return identifiedBy.type === 'Relayer'
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

  if (isIdentifiedByUserOpHash(identifiedBy)) {
    const userOpHash = identifiedBy.identifier
    const bundler = getDefaultBundler(network)
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
