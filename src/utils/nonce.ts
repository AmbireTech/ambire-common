import { Interface } from 'ethers'

import AmbireAccount from '../../contracts/compiled/AmbireAccount.json'
import { CONFIRMED_NONCE_SETTLE_MS } from '../consts/activity'
import { Account } from '../interfaces/account'
import { IActivityController } from '../interfaces/activity'
import { RPCProvider } from '../interfaces/provider'
import { isSmartAccount } from '../libs/account/account'
import { AccountOp, getAccountOpNonce } from '../libs/accountOp/accountOp'
import { SubmittedAccountOp } from '../libs/accountOp/submittedAccountOp'
import { AccountOpStatus } from '../libs/accountOp/types'
import { BROADCAST_OPTIONS } from '../libs/broadcast/broadcast'
import isSameAddr from './isSameAddr'

/**
 * A nonce a sent op takes on its chain, worked out from what Activity saved of the op. An op can
 * take more than one, e.g. an SA op paid by an EOA (`byOtherEOA`) takes the `sender` nonce of the
 * `paidBy` EOA and the `account` nonce of the SA.
 */
export type ReservedNonce = {
  /**
   * `sender` is the txn nonce of an EOA, used by a raw txn it sends or by a 7702 authorization
   * it signs. `account` is the nonce of an Ambire account or a Safe.
   */
  kind: 'sender' | 'account'
  addr: string
  nonce: bigint
}

/** A nonce held by an op that Activity still waits for. */
export type PendingNonceReservation = { accountOpId: string; reserved: ReservedNonce }

/** A nonce an op would take, without its value. Used to find the pending ops that hold it. */
export type NonceKey = Pick<ReservedNonce, 'kind' | 'addr'>

type NonceOpFields = Pick<AccountOp, 'accountAddr' | 'nonce' | 'safeTx' | 'gasFeePayment' | 'meta'>

/** The EOA whose txn nonce a raw txn of the op takes, or null when no wallet EOA sends it. */
const getRawTxnSenderAddr = ({ accountAddr, gasFeePayment }: NonceOpFields): string | null => {
  if (!gasFeePayment) return null

  const { broadcastOption } = gasFeePayment
  if (broadcastOption === BROADCAST_OPTIONS.byOtherEOA) return gasFeePayment.paidBy
  if (
    broadcastOption === BROADCAST_OPTIONS.bySelf ||
    broadcastOption === BROADCAST_OPTIONS.bySelf7702 ||
    broadcastOption === BROADCAST_OPTIONS.delegation
  )
    return accountAddr
  return null
}

/** Whether the op raises the nonce of the account itself (an Ambire account or a Safe). */
const takesAccountNonce = ({ gasFeePayment, meta }: NonceOpFields, isSafe: boolean): boolean => {
  // A Safe deploy only calls the factory, so it doesn't use the Safe nonce
  if (isSafe) return !meta?.isSafeDeploy

  return gasFeePayment?.broadcastOption === BROADCAST_OPTIONS.byOtherEOA
}

/**
 * The nonces an op would take if sent now, without their values. Empty when it takes none of
 * the wallet's nonces, e.g. a smart account sent through a bundler.
 * `signsBundlerAuthorization` is whether a bundler send also signs a 7702 authorization, which
 * takes the next txn nonce of the account.
 */
export function getNonceKeys({
  accountOp,
  account,
  signsBundlerAuthorization = false
}: {
  accountOp: NonceOpFields
  account: Account
  signsBundlerAuthorization?: boolean
}): NonceKey[] {
  const isSafe = !!account.safeCreation
  // Without a fee option yet, an EOA can only send by itself and a Safe always uses its nonce
  if (!accountOp.gasFeePayment) {
    if (!isSmartAccount(account)) return [{ kind: 'sender', addr: account.addr }]
    return isSafe && !accountOp.meta?.isSafeDeploy ? [{ kind: 'account', addr: account.addr }] : []
  }

  const keys: NonceKey[] = []
  const senderAddr = getRawTxnSenderAddr(accountOp)
  if (senderAddr) keys.push({ kind: 'sender', addr: senderAddr })
  if (
    signsBundlerAuthorization &&
    accountOp.gasFeePayment.broadcastOption === BROADCAST_OPTIONS.byBundler
  )
    keys.push({ kind: 'sender', addr: account.addr })
  if (takesAccountNonce(accountOp, isSafe)) keys.push({ kind: 'account', addr: account.addr })
  return keys
}

/**
 * How many raw txns of the op went out. A batch sent one txn at a time saves the hashes of the
 * txns that went out, joined by `-`, so a partly sent batch counts only those.
 */
const getSentTxnCount = ({ identifiedBy }: SubmittedAccountOp) =>
  identifiedBy.type === 'MultipleTxns' ? identifiedBy.identifier.split('-').length : 1

/**
 * The nonces a sent op takes on its chain, worked out from what Activity saved of it: the txn
 * nonces of the EOA that sent its raw txns (`eoaNonce` onwards), the nonce of a 7702
 * authorization, and the nonce of the account itself (an Ambire account or a Safe).
 */
export function getSubmittedAccountOpNonces(
  op: SubmittedAccountOp,
  account: Account
): ReservedNonce[] {
  const nonces: ReservedNonce[] = []
  const isSafe = !!account.safeCreation
  const broadcastOption = op.gasFeePayment?.broadcastOption
  const senderAddr = getRawTxnSenderAddr(op)

  if (senderAddr && op.eoaNonce !== null && op.eoaNonce !== undefined) {
    const sentTxnCount = getSentTxnCount(op)
    for (let i = 0; i < sentTxnCount; i++) {
      nonces.push({ kind: 'sender', addr: senderAddr, nonce: op.eoaNonce + BigInt(i) })
    }

    // A self-sent delegation raises the nonce once more for its authorization
    if (broadcastOption === BROADCAST_OPTIONS.delegation)
      nonces.push({ kind: 'sender', addr: senderAddr, nonce: op.eoaNonce + BigInt(sentTxnCount) })
  }

  const bundlerAuthorization = op.asUserOperation?.eip7702Auth
  if (broadcastOption === BROADCAST_OPTIONS.byBundler && bundlerAuthorization) {
    nonces.push({
      kind: 'sender',
      addr: op.accountAddr,
      nonce: BigInt(bundlerAuthorization.nonce)
    })
  }

  if (!takesAccountNonce(op, isSafe)) return nonces

  const accountNonce = isSafe ? getAccountOpNonce(op) : op.nonce
  if (accountNonce !== null)
    nonces.push({ kind: 'account', addr: op.accountAddr, nonce: accountNonce })
  return nonces
}

/**
 * The nonces on `chainId` that the pending ops hold, for any of `keys`. `pendingAccountOps` are
 * the ops Activity waits for, of every account, as an EOA may send the txns of another account.
 * Empty when nothing holds them.
 */
export function getPendingNonceReservations({
  chainId,
  keys,
  pendingAccountOps,
  accounts
}: {
  chainId: bigint
  keys: NonceKey[]
  pendingAccountOps: SubmittedAccountOp[]
  accounts: Account[]
}): PendingNonceReservation[] {
  return pendingAccountOps
    .filter((op) => op.chainId === chainId)
    .flatMap((op) => {
      const account = accounts.find((acc) => isSameAddr(acc.addr, op.accountAddr))
      if (!account) return []

      return getSubmittedAccountOpNonces(op, account)
        .filter((reserved) =>
          keys.some((key) => key.kind === reserved.kind && isSameAddr(key.addr, reserved.addr))
        )
        .map((reserved) => ({ accountOpId: op.id, reserved }))
    })
}

/**
 * Whether a txn with this status is in a block. A reverted txn (`Failure`) is mined too, so it
 * still used up the nonce of the EOA that sent it.
 */
export const isMinedStatus = (status?: AccountOpStatus) =>
  status === AccountOpStatus.Success || status === AccountOpStatus.Failure

/**
 * The nonces a mined op really used up, out of the ones it took when it was sent. When an SA op
 * paid by an EOA (`paidBy`) reverts, the EOA nonce is used up, but the revert also undoes the
 * raise of the SA nonce. So the SA nonce counts only on `Success`. A batch that an EOA sends one
 * txn at a time takes the status of its last txn, and only its mined txns used their nonces. The
 * chain mines them in nonce order, so if 2 of the txns with nonces 7, 8 and 9 were mined, the
 * batch used 7 and 8.
 */
const getUsedNonces = (op: SubmittedAccountOp, account: Account): ReservedNonce[] => {
  const nonces = getSubmittedAccountOpNonces(op, account)
  const minedTxnCount =
    op.identifiedBy.type === 'MultipleTxns'
      ? op.calls.filter((call) => isMinedStatus(call.status)).length
      : undefined
  const senderNonces = nonces.filter((reserved) => reserved.kind === 'sender')

  return nonces.filter((reserved) => {
    if (reserved.kind === 'account') return op.status === AccountOpStatus.Success
    if (minedTxnCount === undefined) return isMinedStatus(op.status)

    const lowerNonceCount = senderNonces.filter((other) => other.nonce < reserved.nonce).length
    return lowerNonceCount < minedTxnCount
  })
}

/**
 * The nonces that a new op must skip because of `op` at `now`. A pending op holds all the nonces
 * it took. A mined op holds only the ones it used, and only for `CONFIRMED_NONCE_SETTLE_MS` after
 * its receipt. Any other op, like a stuck or dropped one, holds none.
 */
const getHeldNonces = (op: SubmittedAccountOp, account: Account, now: number): ReservedNonce[] => {
  if (op.status === AccountOpStatus.BroadcastedButNotConfirmed)
    return getSubmittedAccountOpNonces(op, account)

  const isSettling =
    isMinedStatus(op.status) &&
    op.confirmedAt !== undefined &&
    now - op.confirmedAt < CONFIRMED_NONCE_SETTLE_MS
  return isSettling ? getUsedNonces(op, account) : []
}

/**
 * The nonce for a new op of `addr`. It is `chainNonce`, raised past every nonce that the ops in
 * `accountOps` still hold (see `getHeldNonces`). The RPC can miss those nonces, e.g. when its node
 * dropped a stuck txn or has not seen the latest block yet. Reusing one would replace a pending op
 * or give a txn that is never mined. Say an EOA has pending txns with nonces 5 and 6 and the RPC
 * says 5, the result is 7. Pass the ops of every account, because an EOA can pay for the ops of
 * an SA (`paidBy`). `chainNonce` must already be the next nonce (a txn count or a contract nonce).
 */
export function getNextNonce({
  addr,
  kind,
  chainId,
  chainNonce,
  accountOps,
  now,
  accounts
}: NonceKey & {
  chainId: bigint
  chainNonce: bigint
  accountOps: SubmittedAccountOp[]
  now: number
  accounts: Account[]
}): bigint {
  return accountOps
    .filter((op) => op.chainId === chainId)
    .flatMap((op) => {
      const account = accounts.find((acc) => isSameAddr(acc.addr, op.accountAddr))
      return account ? getHeldNonces(op, account, now) : []
    })
    .filter((held) => held.kind === kind && isSameAddr(held.addr, addr))
    .reduce((next, held) => (held.nonce >= next ? held.nonce + 1n : next), chainNonce)
}

/** The highest receipt block per chain of the finalized ops, as `{ [chainId]: blockNumber }`. */
export const getReceiptBlockNumberByChainId = (ops: SubmittedAccountOp[]) =>
  ops.reduce<{ [chainId: string]: number }>((blockNumberByChainId, op) => {
    if (op.blockNumber === undefined) return blockNumberByChainId

    const chainId = op.chainId.toString()
    const current = blockNumberByChainId[chainId]
    if (current === undefined || op.blockNumber > current)
      blockNumberByChainId[chainId] = op.blockNumber
    return blockNumberByChainId
  }, {})

export async function getRelayerNonce(
  activity: IActivityController,
  op: AccountOp,
  provider: RPCProvider
): Promise<bigint> {
  // find the pending activity with the biggest nonce
  const accountBroadcastedButNotConfirmed =
    activity.broadcastedButNotConfirmed[op.accountAddr] || []
  const pendingActivityOps = accountBroadcastedButNotConfirmed.filter(
    (accOp) => accOp.chainId === op.chainId
  )
  const pendingActivityOp = pendingActivityOps.length
    ? pendingActivityOps.reduce((prev, current) => (current.nonce > prev.nonce ? current : prev))
    : null
  if (!pendingActivityOp || (op.nonce && pendingActivityOp.nonce < op.nonce))
    return op.nonce as bigint

  const ambireInterface = new Interface(AmbireAccount.abi)
  const pendingAccountNonce = await provider
    .send('eth_call', [
      {
        to: op.accountAddr,
        data: ambireInterface.encodeFunctionData('nonce')
      },
      'pending'
    ])
    .catch(null)

  if (pendingAccountNonce && BigInt(pendingAccountNonce) > pendingActivityOp.nonce)
    return BigInt(pendingAccountNonce)

  // if there's a failure in the last 5 txns
  // get the failure and check if we have a confirmed txn after
  // if we don't, the latest nonce should be equal to the failed one
  const lastFiveTxns = activity.getAccountOpsForAccount({ from: 0, numberOfItems: 5 })
  const failure = lastFiveTxns.find((subOp) => subOp.status === AccountOpStatus.Failure)
  if (!failure) return pendingActivityOp.nonce + 1n

  // failed in the last 5, check if we have replayed the nonce
  // and if we haven't, replay it
  const failedNonce = failure.nonce
  const sameNonceBroadcast = lastFiveTxns.filter(
    (subOp) => subOp.nonce === failedNonce && subOp.status !== AccountOpStatus.Failure
  )
  if (!sameNonceBroadcast.length) return failedNonce

  // just go +1
  return pendingActivityOp.nonce + 1n
}
