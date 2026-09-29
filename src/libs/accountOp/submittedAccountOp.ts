import { getAddress, toBeHex, TransactionReceipt, ZeroAddress } from 'ethers'
import { decodeFunctionData, parseAbi, toFunctionSelector } from 'viem'

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

import type { TokenResult } from '../portfolio/interfaces'
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

export type BalanceChange = Pick<
  TokenResult,
  | 'symbol'
  | 'name'
  | 'decimals'
  | 'address'
  | 'chainId'
  | 'priceIn'
  | 'marketDataIn'
  | 'meta'
  | 'flags'
> & {
  amount: bigint
  amountBefore: bigint
  amountAfter: bigint
  balanceChange: bigint
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
  balanceChanges?: BalanceChange[]
  balanceChangesFetchRetryCount?: number
}

type SubmittedAccountOpActionFields = Pick<
  SubmittedAccountOp,
  | 'signingKeyAddr'
  | 'signingKeyType'
  | 'nonce'
  | 'eoaNonce'
  | 'feeCall'
  | 'activatorCall'
  | 'gasLimit'
  | 'signature'
  | 'asUserOperation'
  | 'signers'
  | 'signed'
  | 'safeTx'
  | 'flags'
>

export interface SubmittedAccountOpLike
  extends Pick<
      SubmittedAccountOp,
      | 'id'
      | 'accountAddr'
      | 'chainId'
      | 'calls'
      | 'gasFeePayment'
      | 'txnId'
      | 'status'
      | 'meta'
      | 'timestamp'
      | 'identifiedBy'
      | 'blockNumber'
      | 'blockHash'
      | 'gasUsed'
      | 'balanceChanges'
      | 'balanceChangesFetchRetryCount'
    >,
    Partial<SubmittedAccountOpActionFields> {
  activitySource?: 'internal' | 'external'
}

/**
 * Rebuilds a full `AccountOp` from a `SubmittedAccountOpLike` - e.g. to re-run `humanizeAccountOp`
 * against a past activity item, which only carries the looser `SubmittedAccountOpLike` shape.
 * Fields absent from `SubmittedAccountOpLike` (because they were optional on
 * `SubmittedAccountOpActionFields`, or never persisted) fall back to `AccountOp`'s own defaults.
 */
export function submittedAccountOpToAccountOp(
  submittedAccountOp: SubmittedAccountOpLike
): AccountOp {
  return {
    id: submittedAccountOp.id,
    accountAddr: submittedAccountOp.accountAddr,
    chainId: submittedAccountOp.chainId,
    signingKeyAddr: submittedAccountOp.signingKeyAddr ?? null,
    signingKeyType: submittedAccountOp.signingKeyType ?? null,
    nonce: submittedAccountOp.nonce ?? null,
    eoaNonce: submittedAccountOp.eoaNonce,
    calls: submittedAccountOp.calls,
    feeCall: submittedAccountOp.feeCall,
    activatorCall: submittedAccountOp.activatorCall,
    gasLimit: submittedAccountOp.gasLimit ?? null,
    signature: submittedAccountOp.signature ?? null,
    gasFeePayment: submittedAccountOp.gasFeePayment,
    txnId: submittedAccountOp.txnId,
    status: submittedAccountOp.status,
    asUserOperation: submittedAccountOp.asUserOperation,
    signers: submittedAccountOp.signers,
    signed: submittedAccountOp.signed,
    safeTx: submittedAccountOp.safeTx,
    meta: submittedAccountOp.meta,
    flags: submittedAccountOp.flags
  }
}

/**
 * Returns the account-level nonce to store in Activity. Safe transactions broadcast through a
 * bundler have an unrelated, random UserOperation nonce, which remains available on
 * `accountOp.asUserOperation.nonce` and must not replace the Safe transaction nonce.
 */
export function getSubmittedAccountOpNonce(
  accountOpNonce: AccountOp['nonce'],
  broadcastNonce: number | bigint,
  isSafeAccount: boolean
): bigint {
  if (isSafeAccount && accountOpNonce !== null) return accountOpNonce

  return BigInt(broadcastNonce)
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
  let lastWithTxId
  let callIndex = 0

  // get the first BroadcastedButNotConfirmed call if any
  for (let i = 0; i < op.calls.length; i++) {
    const currentCall = op.calls[i]!
    if (currentCall.status === AccountOpStatus.BroadcastedButNotConfirmed)
      return { call: currentCall, callIndex: i }

    lastWithTxId = currentCall
    callIndex = i
  }

  // if no BroadcastedButNotConfirmed, get the last one
  return { call: lastWithTxId!, callIndex }
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
  const bundler = getDefaultBundler(network) // rely on pimlico for front running
  const bundlerResult = await bundler.getReceipt(userOpHash, network)
  if (
    !bundlerResult.receipt ||
    bundlerResult.receipt.transactionHash.toLowerCase() === foundTxnId.toLowerCase()
  ) {
    await wait(2000)
    return fetchFrontRanTxnId(identifiedBy, foundTxnId, network, counter + 1)
  }

  return bundlerResult.receipt.transactionHash
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

    opReference.calls[callIndex]!.status = status

    // if there's a receipt, add the fee
    if (receipt) {
      opReference.calls[callIndex]!.fee = {
        inToken: ZeroAddress,
        amount: receipt.fee
      }

      opReference.calls[callIndex]!.blockHash = receipt.blockHash

      opReference.calls[callIndex]!.blockNumber = receipt.blockNumber

      opReference.calls[callIndex]!.blockHash = receipt.blockHash

      opReference.calls[callIndex]!.gasUsed = toBeHex(receipt.gasUsed)
    }

    const left = !!opReference.calls.find(
      (c) => c.status === AccountOpStatus.BroadcastedButNotConfirmed
    )
    if (!left) {
      opReference.status = status
      return opReference
    }

    // returning null here means the accountOp as a whole is still not ready
    // to be updated as there are still pending transaction to be confirmed
    return null
  }

  opReference.status = status
  return opReference
}

// `transferFrom(address,address,uint256)` is shared by ERC20 and ERC721, so one entry covers both
const transferAbi = parseAbi(['function transfer(address to, uint256 amountOrTokenId)'])
const transferFromAbi = parseAbi([
  'function transferFrom(address from, address to, uint256 amountOrTokenId)'
])
const safeTransferFromAbi = parseAbi([
  'function safeTransferFrom(address from, address to, uint256 tokenId)'
])
const safeTransferFromWithDataAbi = parseAbi([
  'function safeTransferFrom(address from, address to, uint256 tokenId, bytes data)'
])

/**
 * Which decoded argument holds the recipient, per function that moves funds to someone else.
 * Everything not listed here is a contract interaction rather than a send.
 */
const RECIPIENT_ARG_INDEX_BY_SELECTOR: Record<string, { abi: any; index: number; args: number }> = {
  [toFunctionSelector(transferAbi[0])]: { abi: transferAbi, index: 0, args: 2 },
  [toFunctionSelector(transferFromAbi[0])]: { abi: transferFromAbi, index: 1, args: 3 },
  [toFunctionSelector(safeTransferFromAbi[0])]: { abi: safeTransferFromAbi, index: 1, args: 3 },
  [toFunctionSelector(safeTransferFromWithDataAbi[0])]: {
    abi: safeTransferFromWithDataAbi,
    index: 1,
    args: 3
  }
}

const getRecipientFromCall = (call: Call): string | null => {
  const data = (call.data || '0x') as Hex

  // A plain value transfer - the call target is the recipient
  if (data === '0x') return call.value > 0n && call.to ? call.to : null

  const decoder = RECIPIENT_ARG_INDEX_BY_SELECTOR[data.slice(0, 10)]
  if (!decoder) return null

  try {
    // Some tokens send shorter calldata than the ABI expects, the same way the humanizer pads it
    const expectedLength = 2 + 8 + decoder.args * 64
    const { args } = decodeFunctionData({
      abi: decoder.abi,
      data: data.padEnd(expectedLength, '0') as Hex
    })

    return (args[decoder.index] as string) || null
  } catch {
    // Not actually the function the selector suggests, so there is no recipient to read
    return null
  }
}

/**
 * Returns the addresses an account op sends funds to - native transfers plus ERC20/ERC721
 * `transfer`, `transferFrom` and both `safeTransferFrom` overloads - checksummed, deduplicated
 * and in call order. Contract interactions are left out: calling a contract is not sending to it.
 *
 * @param whitelist Optional list of addresses to filter the results (case-insensitive).
 */
export function getAccountOpRecipients(
  op: Pick<AccountOp, 'calls'>,
  whitelist?: string[]
): {
  address: string
  domain?: string
}[] {
  const domainByRecipient = new Map<string, string | undefined>()
  const lowercaseWhitelist = whitelist?.map((addr) => addr.toLowerCase())

  op.calls.forEach((call) => {
    const recipient = getRecipientFromCall(call)
    if (!recipient) return

    let address: string
    try {
      address = getAddress(recipient)
    } catch {
      // A malformed address can never have been sent to, so it is not a recipient
      return
    }

    if (lowercaseWhitelist && !lowercaseWhitelist.includes(address.toLowerCase())) return

    const domain = call.recipientDomain?.toLowerCase()?.trim()
    if (domain || !domainByRecipient.has(address))
      domainByRecipient.set(address, domain || undefined)
  })

  return Array.from(domainByRecipient, ([address, domain]) => ({ address, domain }))
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
