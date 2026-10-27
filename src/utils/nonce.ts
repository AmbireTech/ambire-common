import { Interface } from 'ethers'

import AmbireAccount from '../../contracts/compiled/AmbireAccount.json'
import { Account, AccountOnchainState } from '../interfaces/account'
import { IActivityController } from '../interfaces/activity'
import { RPCProvider } from '../interfaces/provider'
import { isSmartAccount } from '../libs/account/account'
import { AccountOp, getAccountOpNonce } from '../libs/accountOp/accountOp'
import { SubmittedAccountOp } from '../libs/accountOp/submittedAccountOp'
import { AccountOpStatus } from '../libs/accountOp/types'
import { BROADCAST_OPTIONS } from '../libs/broadcast/broadcast'
import isSameAddr from './isSameAddr'

/** A nonce an op takes on its chain, recorded when the op is sent. */
export type ReservedNonce = {
  /**
   * `sender` is the txn nonce of an EOA, used by a raw txn it sends or by a 7702 authorization
   * it signs. `account` is the nonce of an Ambire account or a Safe.
   */
  kind: 'sender' | 'account'
  addr: string
  nonce: bigint
}

/** The nonces one sent op takes on its chain, held until the RPC counts them. */
export type NonceReservation = {
  chainId: bigint
  nonces: ReservedNonce[]
  /** Set once the op has a final status, so a latest state read that counts a nonce frees it. */
  isSettled: boolean
  /**
   * When the reservation was made, in ms. It is reset when the op is settled, and the reservation
   * expires ACCOUNT_OP_PENDING_TIMEOUT_MINS after that. While the op is pending in Activity it
   * does not expire.
   */
  createdAt: number
}

/** A reserved nonce of an op that is still waiting for a final status. */
export type PendingNonceReservation = { accountOpId: string; reserved: ReservedNonce }

/** A nonce an op would take, without its value. Used to find the reservations that hold it back. */
export type NonceKey = Pick<ReservedNonce, 'kind' | 'addr'>

/** Whether a txn with this status was mined, so it raised the sender nonce. */
export const isMinedStatus = (status?: AccountOpStatus) =>
  status === AccountOpStatus.Success || status === AccountOpStatus.Failure

/** Whether `state` already counts the reserved nonce, i.e. its next nonce is past it. */
export const isNonceCounted = (state: AccountOnchainState, { kind, nonce }: ReservedNonce) =>
  kind === 'sender' ? state.eoaNonce !== null && state.eoaNonce > nonce : state.nonce > nonce

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
 * The nonces an op takes on its chain. `sender` describes the raw txns that went out, if any.
 * `bundlerAuthorizationNonce` is the nonce of a 7702 authorization that a bundler sends.
 */
export function getNoncesToReserve({
  accountOp,
  isSafe,
  sender,
  bundlerAuthorizationNonce
}: {
  accountOp: NonceOpFields
  isSafe: boolean
  sender?: { addr: string; firstNonce: bigint; sentTxnCount: number }
  bundlerAuthorizationNonce?: bigint
}): ReservedNonce[] {
  const reservedNonces: ReservedNonce[] = []
  const broadcastOption = accountOp.gasFeePayment?.broadcastOption

  if (sender) {
    for (let i = 0; i < sender.sentTxnCount; i++) {
      reservedNonces.push({
        kind: 'sender',
        addr: sender.addr,
        nonce: sender.firstNonce + BigInt(i)
      })
    }

    // A self-sent delegation raises the nonce once more for its authorization
    if (
      broadcastOption === BROADCAST_OPTIONS.delegation &&
      isSameAddr(sender.addr, accountOp.accountAddr) &&
      sender.sentTxnCount > 0
    ) {
      reservedNonces.push({
        kind: 'sender',
        addr: sender.addr,
        nonce: sender.firstNonce + BigInt(sender.sentTxnCount)
      })
    }
  }

  if (bundlerAuthorizationNonce !== undefined) {
    reservedNonces.push({
      kind: 'sender',
      addr: accountOp.accountAddr,
      nonce: bundlerAuthorizationNonce
    })
  }

  let accountNonce: bigint | null = null
  if (takesAccountNonce(accountOp, isSafe))
    accountNonce = isSafe ? getAccountOpNonce(accountOp) : accountOp.nonce
  if (accountNonce !== null) {
    reservedNonces.push({ kind: 'account', addr: accountOp.accountAddr, nonce: accountNonce })
  }

  return reservedNonces
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
