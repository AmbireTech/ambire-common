import { Interface } from 'ethers'

import AmbireAccount from '../../contracts/compiled/AmbireAccount.json'
import { Account } from '../interfaces/account'
import { IActivityController } from '../interfaces/activity'
import { RPCProvider } from '../interfaces/provider'
import { isSmartAccount } from '../libs/account/account'
import { AccountOp, getAccountOpNonce } from '../libs/accountOp/accountOp'
import { SubmittedAccountOp } from '../libs/accountOp/submittedAccountOp'
import { AccountOpStatus } from '../libs/accountOp/types'
import { BROADCAST_OPTIONS } from '../libs/broadcast/broadcast'
import isSameAddr from './isSameAddr'

/** A nonce a sent op takes on its chain, worked out from what Activity saved of the op. */
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

  const broadcastOption = gasFeePayment?.broadcastOption
  return (
    broadcastOption === BROADCAST_OPTIONS.byOtherEOA ||
    broadcastOption === BROADCAST_OPTIONS.byRelayer
  )
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
    if (broadcastOption === BROADCAST_OPTIONS.delegation && isSameAddr(senderAddr, op.accountAddr))
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
 * The nonce for a new op of `addr`: `chainNonce`, raised past the nonces the pending ops hold, as
 * the RPC may not count them (e.g. a stuck txn dropped by the node the RPC asked). Taking one of
 * them would replace that pending op without the user choosing to. `chainNonce` must already be
 * the next nonce (a txn count or a contract nonce).
 */
export function getNextNonce({
  addr,
  kind,
  chainId,
  chainNonce,
  pendingAccountOps,
  accounts
}: NonceKey & {
  chainId: bigint
  chainNonce: bigint
  pendingAccountOps: SubmittedAccountOp[]
  accounts: Account[]
}): bigint {
  return getPendingNonceReservations({
    chainId,
    keys: [{ kind, addr }],
    pendingAccountOps,
    accounts
  }).reduce(
    (next, { reserved }) => (reserved.nonce >= next ? reserved.nonce + 1n : next),
    chainNonce
  )
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
