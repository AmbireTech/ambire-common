import { Interface, isAddress, toBeHex, TransactionReceipt, ZeroAddress } from 'ethers'

import { BUNDLER } from '../../consts/bundlers'
import { Hex } from '../../interfaces/hex'
import { Network } from '../../interfaces/network'
import {
  getAvailableBunlders,
  getBundlerByName,
  getDefaultBundler
} from '../../services/bundlers/getBundler'
import { BundlerTransactionReceipt, UserOpStatus } from '../../services/bundlers/types'
import wait from '../../utils/wait'
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

export type PortfoliosToUpdate = {
  [address: string]: Network['chainId'][]
}

export interface SubmittedAccountOp extends AccountOp {
  txnId?: string
  nonce: bigint
  success?: boolean
  timestamp: number
  isSingletonDeploy?: boolean
  identifiedBy: AccountOpIdentifiedBy
  blockNumber?: number
  blockHash?: string
  gasUsed?: string
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
    const currentCall = op.calls[i]!
    if (currentCall.status === AccountOpStatus.BroadcastedButNotConfirmed)
      return { call: currentCall, callIndex: i }
  }

  // if no BroadcastedButNotConfirmed, get the last one
  return { call: op.calls[op.calls.length - 1]!, callIndex: op.calls.length - 1 }
}

export async function fetchFrontRanTxnId(
  identifiedBy: AccountOpIdentifiedBy,
  foundTxnId: string,
  network: Network,
  counter = 0
): Promise<string> {
  // try to find the probably front ran txn id 5 times and if it can't,
  // return the already found one. It could've really failed
  if (counter >= 5) return foundTxnId

  const userOpHash = identifiedBy.identifier
  const bundler = identifiedBy.bundler
    ? getBundlerByName(identifiedBy.bundler)
    : getDefaultBundler(network)
  const bundlerResult = await bundler.getStatus(network, userOpHash)
  if (
    !bundlerResult.transactionHash ||
    bundlerResult.transactionHash.toLowerCase() === foundTxnId.toLowerCase()
  ) {
    await wait(2000)
    return fetchFrontRanTxnId(identifiedBy, foundTxnId, network, counter + 1)
  }

  return bundlerResult.transactionHash
}

export function hasTimePassedSinceBroadcast(op: SubmittedAccountOp, mins: number): boolean {
  const accountOpDate = new Date(op.timestamp)
  accountOpDate.setMinutes(accountOpDate.getMinutes() + mins)
  return accountOpDate < new Date()
}

export async function fetchTxnId(
  identifiedBy: AccountOpIdentifiedBy,
  network: Network,
  callRelayer: Function,
  op?: SubmittedAccountOp
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
      txnId: txnIds[txnIds.length - 1]!
    }
  }

  if (isIdentifiedByUserOpHash(identifiedBy)) {
    const userOpHash = identifiedBy.identifier

    const bundler = identifiedBy.bundler
      ? getBundlerByName(identifiedBy.bundler)
      : getDefaultBundler(network)

    // leave a 10s window to fetch the status from the broadcasting bundler
    let timeoutId
    const bundlerStatus = await Promise.race([
      bundler.getStatus(network, userOpHash),
      new Promise((_resolve, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error('bundler gas price fetch fail, request too slow')),
          10000
        )
      })
    ]).catch(() => {
      // upon error or timeout, we return not_found and we fallback to receipt
      // from all our available bundlers
      return {
        status: 'not_found'
      }
    })
    clearTimeout(timeoutId)
    let bundlerResult = bundlerStatus as UserOpStatus

    // upon reject or failure to find/fetch, take the receipt from all available bundlers
    if (bundlerResult.status === 'rejected' || bundlerResult.status === 'not_found') {
      // sometimes the bundlers return rejected by mistake
      // if that's the case, make the user wait a bit longer, but then query
      // all bundlers for the user op receipt to make sure it's really not mined
      if (bundlerResult.status === 'rejected') await wait(10000)
      const bundlers = getAvailableBunlders(network)
      const bundlerResults = await Promise.all(
        bundlers.map((b) => {
          let innerTimeoutId: any
          const result = Promise.race([
            b.getReceipt(userOpHash, network),
            new Promise((_resolve, reject) => {
              innerTimeoutId = setTimeout(
                () => reject(new Error('bundler gas price fetch fail, request too slow')),
                10000
              )
            })
          ])
            .catch(() => {
              // upon timeout or error, just return null and let the logic continue
              return null
            })
            .finally(() => {
              clearTimeout(innerTimeoutId)
            })
          return result
        })
      )
      bundlerResults.forEach((bundlerResponse) => {
        const res = bundlerResponse as BundlerTransactionReceipt | null
        if (res && res.receipt && res.receipt.transactionHash) {
          bundlerResult = {
            status: 'found',
            transactionHash: res.receipt.transactionHash as Hex
          }
        }
      })
      // if it's rejected even after searching all the bundlers,
      // we return rejected
      if (bundlerResult.status === 'rejected') {
        return {
          status: 'rejected',
          txnId: null
        }
      }
    }

    if (bundlerResult.transactionHash)
      return {
        status: 'success',
        txnId: bundlerResult.transactionHash
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

export function updateOpStatus(
  // IMPORTANT: pass a reference to this.#accountsOps[accAddr][chainId][index]
  // so we could mutate it from inside this method
  opReference: SubmittedAccountOp,
  status: AccountOpStatus,
  receipt?: TransactionReceipt
): SubmittedAccountOp | null {
  if (opReference.identifiedBy.type === 'MultipleTxns') {
    const callIndex = getMultipleBroadcastUnconfirmedCallOrLast(opReference).callIndex
    // eslint-disable-next-line no-param-reassign
    opReference.calls[callIndex]!.status = status

    // if there's a receipt, add the fee
    if (receipt) {
      // eslint-disable-next-line no-param-reassign
      opReference.calls[callIndex]!.fee = {
        inToken: ZeroAddress,
        amount: receipt.fee
      }

      // eslint-disable-next-line no-param-reassign
      opReference.calls[callIndex]!.blockHash = receipt.blockHash

      // eslint-disable-next-line no-param-reassign
      opReference.calls[callIndex]!.blockNumber = receipt.blockNumber

      // eslint-disable-next-line no-param-reassign
      opReference.calls[callIndex]!.blockHash = receipt.blockHash

      // eslint-disable-next-line no-param-reassign
      opReference.calls[callIndex]!.gasUsed = toBeHex(receipt.gasUsed)
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

const transferIface = new Interface(['function transfer(address,uint256)'])

/**
 * Returns all addresses that the SubmittedAccountOp has calls sent to.
 *
 * @param whitelist Optional list of addresses to filter the results.
 */
export function getAccountOpRecipients(op: SubmittedAccountOp, whitelist?: string[]): string[] {
  const sentTo = new Set<string>()
  const lowercaseWhitelist = whitelist?.map((addr) => addr.toLowerCase())

  op.calls.forEach((call) => {
    // 1) Direct call.to match
    if (call.to && isAddress(call.to)) {
      if (!lowercaseWhitelist || lowercaseWhitelist.includes(call.to.toLowerCase())) {
        sentTo.add(call.to)
      }
    }

    // 2) If this is an ERC-20 transfer(address,uint256), decode the recipient from call.data
    const data = (call as Call).data as string | undefined

    if (!data || typeof data !== 'string' || data.length < 10) return

    const selector = transferIface.getFunction('transfer')?.selector
    if (selector && data.startsWith(selector)) {
      try {
        const decoded = transferIface.decodeFunctionData('transfer', data)
        const recipient = decoded[0] as string
        if (isAddress(recipient)) {
          if (lowercaseWhitelist && !lowercaseWhitelist.includes(recipient.toLowerCase())) return

          sentTo.add(recipient)
        }
      } catch {
        // ignore decode errors and continue
      }
    }
  })

  return Array.from(sentTo)
}

/**
 * Checks if the SubmittedAccountOp has a call that was sent to the specified address.
 *
 * @returns the timestamp of the operation if found, otherwise null.
 */
export function checkIsRecipientOfAccountOp(op: SubmittedAccountOp, to: string): number | null {
  const hasSentTo = getAccountOpRecipients(op, [to]).length > 0

  if (!hasSentTo) return null

  return op.timestamp
}
