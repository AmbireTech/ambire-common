import { Interface } from 'ethers'

import AmbireAccount from '../../contracts/compiled/AmbireAccount.json'
import { AccountOnchainState } from '../interfaces/account'
import { IActivityController } from '../interfaces/activity'
import { RPCProvider } from '../interfaces/provider'
import { AccountOp, getAccountOpNonce } from '../libs/accountOp/accountOp'
import { SubmittedAccountOp } from '../libs/accountOp/submittedAccountOp'
import { AccountOpStatus } from '../libs/accountOp/types'
import { BROADCAST_OPTIONS } from '../libs/broadcast/broadcast'
import isSameAddr from './isSameAddr'

/** A nonce an op takes on its chain, recorded when the op is sent. */
export type TakenNonce = {
  /**
   * `sender` is the txn nonce of an EOA, used by a raw txn it sends or by a 7702 authorization
   * it signs. `account` is the nonce of an Ambire account or a Safe.
   */
  kind: 'sender' | 'account'
  addr: string
  nonce: bigint
}

/** The nonces one sent op takes on its chain, held until the RPC counts them. */
export type NonceLock = {
  chainId: bigint
  nonces: TakenNonce[]
  /** Set once the op has a final status, so a latest state read that counts a nonce frees it. */
  isSettled: boolean
}

/** Whether a txn with this status was mined, so it raised the sender nonce. */
export const isMinedStatus = (status?: AccountOpStatus) =>
  status === AccountOpStatus.Success || status === AccountOpStatus.Failure

/** Whether `state` already counts the taken nonce, i.e. its next nonce is past it. */
export const isNonceCounted = (state: AccountOnchainState, { kind, nonce }: TakenNonce) =>
  kind === 'sender' ? state.eoaNonce !== null && state.eoaNonce > nonce : state.nonce > nonce

/**
 * The nonces an op takes on its chain. `sender` describes the raw txns that went out, if any.
 * `bundlerAuthorizationNonce` is the nonce of a 7702 authorization that a bundler sends.
 */
export function getTakenNonces({
  accountOp,
  isSafe,
  sender,
  bundlerAuthorizationNonce
}: {
  accountOp: Pick<AccountOp, 'accountAddr' | 'nonce' | 'safeTx' | 'gasFeePayment' | 'meta'>
  isSafe: boolean
  sender?: { addr: string; firstNonce: bigint; sentTxnCount: number }
  bundlerAuthorizationNonce?: bigint
}): TakenNonce[] {
  const takenNonces: TakenNonce[] = []
  const broadcastOption = accountOp.gasFeePayment?.broadcastOption

  if (sender) {
    for (let i = 0; i < sender.sentTxnCount; i++) {
      takenNonces.push({ kind: 'sender', addr: sender.addr, nonce: sender.firstNonce + BigInt(i) })
    }

    // A self-sent delegation raises the nonce once more for its authorization
    if (
      broadcastOption === BROADCAST_OPTIONS.delegation &&
      isSameAddr(sender.addr, accountOp.accountAddr) &&
      sender.sentTxnCount > 0
    ) {
      takenNonces.push({
        kind: 'sender',
        addr: sender.addr,
        nonce: sender.firstNonce + BigInt(sender.sentTxnCount)
      })
    }
  }

  if (bundlerAuthorizationNonce !== undefined) {
    takenNonces.push({
      kind: 'sender',
      addr: accountOp.accountAddr,
      nonce: bundlerAuthorizationNonce
    })
  }

  // A Safe deploy only calls the factory, so it doesn't use the Safe nonce
  const accountNonce = isSafe
    ? accountOp.meta?.isSafeDeploy
      ? null
      : getAccountOpNonce(accountOp)
    : broadcastOption === BROADCAST_OPTIONS.byOtherEOA ||
        broadcastOption === BROADCAST_OPTIONS.byRelayer
      ? accountOp.nonce
      : null
  if (accountNonce !== null) {
    takenNonces.push({ kind: 'account', addr: accountOp.accountAddr, nonce: accountNonce })
  }

  return takenNonces
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
