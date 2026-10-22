import { Interface } from 'ethers'

import AmbireAccount from '../../contracts/compiled/AmbireAccount.json'
import { Account, AccountOnchainState } from '../interfaces/account'
import { IActivityController } from '../interfaces/activity'
import { RPCProvider } from '../interfaces/provider'
import { AccountOp } from '../libs/accountOp/accountOp'
import { SubmittedAccountOp } from '../libs/accountOp/submittedAccountOp'
import { AccountOpStatus } from '../libs/accountOp/types'
import { BROADCAST_OPTIONS } from '../libs/broadcast/broadcast'

/** How long a confirmed op still raises the local nonce floor, while RPCs may lag behind it. */
export const LOCAL_NONCE_FLOOR_CONFIRMED_WINDOW_MS = 10 * 60 * 1000

/**
 * Which nonce an op raised. `eoa` is the sender nonce of a raw txn, `ambire` the smart
 * account nonce (pass `countRelayerOps: false` for V2, where the relayer coordinates it)
 * and `safe` the Safe nonce.
 */
export type LocalNonceFloorKind =
  | { type: 'eoa' }
  | { type: 'ambire'; countRelayerOps: boolean }
  | { type: 'safe' }

type AccountNonces = Pick<AccountOnchainState, 'eoaNonce' | 'nonce' | 'erc4337Nonce'>

const isSameAddress = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

const getLastNonceOfOp = (op: SubmittedAccountOp, firstNonce: bigint) => {
  if (op.identifiedBy?.type !== 'MultipleTxns') return firstNonce
  return firstNonce + BigInt(op.calls.length - 1)
}

const isOpCountedInFloor = (op: SubmittedAccountOp, countsFailure: boolean, now: number) => {
  if (op.status === AccountOpStatus.BroadcastedButNotConfirmed) return true

  const isConfirmedRecently = now - op.timestamp <= LOCAL_NONCE_FLOOR_CONFIRMED_WINDOW_MS
  if (!isConfirmedRecently) return false
  if (op.status === AccountOpStatus.Success) return true

  return countsFailure && op.status === AccountOpStatus.Failure
}

const getOpNonceForKind = (
  op: SubmittedAccountOp,
  sender: string,
  kind: LocalNonceFloorKind
): bigint | null => {
  const broadcastOption = op.gasFeePayment?.broadcastOption
  const eoaNonce = op.eoaNonce ?? null

  if (kind.type === 'eoa') {
    const isPaidBySender = isSameAddress(op.gasFeePayment?.paidBy, sender)
    if (!isPaidBySender) return null
    return eoaNonce
  }

  const isOpOfSender = isSameAddress(op.accountAddr, sender)
  if (!isOpOfSender) return null
  if (kind.type === 'safe') return op.nonce

  // a bundler op nonce is built from the full userOp nonce and loses precision for random keys
  const isSentByBundler = broadcastOption === BROADCAST_OPTIONS.byBundler
  if (isSentByBundler) return null

  const isRelayerNonceIgnored =
    broadcastOption === BROADCAST_OPTIONS.byRelayer && !kind.countRelayerOps
  if (isRelayerNonceIgnored) return null

  const isSentByOtherEOA = broadcastOption === BROADCAST_OPTIONS.byOtherEOA
  const isRawTxnOfTheAccount = eoaNonce !== null && !isSentByOtherEOA
  if (isRawTxnOfTheAccount) return null

  return op.nonce
}

/**
 * The lowest nonce the next op of `sender` may use, based on the ops this device sent that are
 * still pending or confirmed in the last few minutes, so a lagging RPC can't make two ops share
 * a nonce. Pass the ops of every account on the chain for `eoa`, because a payer EOA can send
 * ops of another account. Returns null when no local op raised that nonce.
 */
export function getLocalNonceFloor(
  ops: SubmittedAccountOp[],
  sender: string,
  kind: LocalNonceFloorKind,
  now: number = Date.now()
): bigint | null {
  // a reverted Ambire or Safe call undoes the nonce raise, while a mined EOA txn always keeps it
  const countsFailure = kind.type === 'eoa'
  return ops.reduce<bigint | null>((floor, op) => {
    if (!isOpCountedInFloor(op, countsFailure, now)) return floor

    const opNonce = getOpNonceForKind(op, sender, kind)
    if (opNonce === null) return floor

    const nextNonce = getLastNonceOfOp(op, opNonce) + 1n
    const isAboveFloor = floor === null || nextNonce > floor
    if (!isAboveFloor) return floor
    return nextNonce
  }, null)
}

/**
 * The nonce for a new op. `rpcNonce` is already the next nonce, so the local floor is not
 * raised again, which would leave a gap and make an EOA txn wait forever.
 */
export const applyLocalNonceFloor = (rpcNonce: bigint, localFloor: bigint | null): bigint => {
  const isFloorAboveRpc = localFloor !== null && localFloor > rpcNonce
  if (!isFloorAboveRpc) return rpcNonce
  return localFloor
}

export async function getRelayerNonce(
  activity: IActivityController,
  op: AccountOp,
  provider: RPCProvider
): Promise<bigint> {
  const accountChainOps = activity.getAccountOpsForChain(op.chainId, op.accountAddr)
  // the nonce after the biggest one of the pending or recently confirmed activity
  const localFloor = getLocalNonceFloor(accountChainOps, op.accountAddr, {
    type: 'ambire',
    countRelayerOps: true
  })
  const isOpNonceAboveLocalOps =
    localFloor === null || (op.nonce !== null && localFloor <= op.nonce)
  if (isOpNonceAboveLocalOps) return op.nonce as bigint

  const ambireInterface = new Interface(AmbireAccount.abi)
  const pendingAccountNonce = await provider
    .send('eth_call', [
      {
        to: op.accountAddr,
        data: ambireInterface.encodeFunctionData('nonce')
      },
      'pending'
    ])
    .catch((e) => {
      // the local activity below is enough to pick the nonce without it
      console.error('Failed to read the pending account nonce', e)
      return null
    })

  const isPendingNonceAboveLocalOps =
    !!pendingAccountNonce && BigInt(pendingAccountNonce) >= localFloor
  if (isPendingNonceAboveLocalOps) return BigInt(pendingAccountNonce)

  // if there's a failure in the last 5 txns
  // get the failure and check if we have a confirmed txn after
  // if we don't, the latest nonce should be equal to the failed one
  const lastFiveTxns = [...accountChainOps].sort((a, b) => b.timestamp - a.timestamp).slice(0, 5)
  const failure = lastFiveTxns.find((subOp) => subOp.status === AccountOpStatus.Failure)
  if (!failure) return localFloor

  // failed in the last 5, check if we have replayed the nonce
  // and if we haven't, replay it
  const failedNonce = failure.nonce
  const sameNonceBroadcast = lastFiveTxns.filter(
    (subOp) => subOp.nonce === failedNonce && subOp.status !== AccountOpStatus.Failure
  )
  if (!sameNonceBroadcast.length) return failedNonce

  // just go +1
  return localFloor
}

const isLowerNonce = (next: bigint | null, saved: bigint | null) =>
  next !== null && saved !== null && next < saved

/** Whether any nonce of `next` is lower than in `saved`, which only a lagging RPC or a reorg causes. */
export const hasLowerNonce = (next: AccountNonces, saved: AccountNonces): boolean => {
  const isEoaNonceLower = isLowerNonce(next.eoaNonce, saved.eoaNonce)
  const isAccountNonceLower = isLowerNonce(next.nonce, saved.nonce)
  const isErc4337NonceLower = isLowerNonce(next.erc4337Nonce, saved.erc4337Nonce)
  return isEoaNonceLower || isAccountNonceLower || isErc4337NonceLower
}

/** The highest receipt block per chain id of `ops`. Ops without a receipt are left out. */
export const getHighestBlockNumberByChainId = (
  ops: SubmittedAccountOp[]
): { [chainId: string]: number } =>
  ops.reduce<{ [chainId: string]: number }>((byChainId, op) => {
    if (!op.blockNumber) return byChainId

    const chainId = op.chainId.toString()
    const highestBlockNumber = byChainId[chainId]
    const isHigher = highestBlockNumber === undefined || op.blockNumber > highestBlockNumber
    if (!isHigher) return byChainId
    return { ...byChainId, [chainId]: op.blockNumber }
  }, {})

/**
 * The account nonce for a new op of a smart account or a Safe, never lower than the ops this
 * device already sent. Pass the ops of the account on the op's chain. Returns `rpcNonce`
 * unchanged for EOAs, whose sender nonce is picked on broadcast.
 */
export function getAccountNonceWithLocalFloor(
  account: Pick<Account, 'addr' | 'creation' | 'safeCreation'>,
  isV2: boolean,
  accountOps: SubmittedAccountOp[],
  rpcNonce: bigint
): bigint {
  if (account.safeCreation) {
    const safeNonceFloor = getLocalNonceFloor(accountOps, account.addr, { type: 'safe' })
    return applyLocalNonceFloor(rpcNonce, safeNonceFloor)
  }
  if (!account.creation) return rpcNonce

  const ambireNonceFloor = getLocalNonceFloor(accountOps, account.addr, {
    type: 'ambire',
    countRelayerOps: !isV2
  })
  return applyLocalNonceFloor(rpcNonce, ambireNonceFloor)
}
