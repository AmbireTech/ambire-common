import { ZeroAddress } from 'ethers'

import { generateUuid } from '../../utils/uuid'
import { BROADCAST_OPTIONS } from '../broadcast/broadcast'
import { AccountOp } from './accountOp'

/**
 * Whether the account op cancels a pending transaction: a speed up (see `meta.speedUp`) whose
 * calls are swapped for empty ones (see `toCancelAccountOp`)
 */
export function isCancelAccountOp(accountOp: Partial<Pick<AccountOp, 'meta'>>): boolean {
  const speedUp = accountOp.meta?.speedUp

  return !!speedUp?.enabled && !!speedUp.isCancel
}

/** The empty, 0-value call to the zero address a cancel is made of */
const isEmptyCancelCall = (call: AccountOp['calls'][number]) =>
  call.to?.toLowerCase() === ZeroAddress && call.value === 0n && call.data === '0x'

/**
 * Whether the calls are already the empty ones a cancel replaces a pending transaction with,
 * i.e. they belong to a pending cancel
 */
export function hasCancelCalls(calls: AccountOp['calls']): boolean {
  return calls.length > 0 && calls.every(isEmptyCancelCall)
}

/**
 * Turns the replacement of a pending transaction (see `meta.speedUp`) into a cancel of it.
 * Every call becomes an empty, 0-value call to the zero address - the same "do nothing"
 * call a Safe rejection uses. A batch broadcast as one transaction per call (`MultipleTxns`)
 * gets one empty call per transaction, so each of their places (nonces) is taken.
 *
 * Whatever was made for the replaced calls - signatures, the Safe transaction, the gas limit,
 * a delegation, a swap quote and the rest of `meta` - is dropped, as it doesn't apply to the
 * empty calls. The signing key is dropped too: it's the key that signed the replaced calls last
 * (for a Safe, the last owner who signed), so the cancel picks its signer like a new transaction.
 * The nonces, the fee payment and `meta.speedUp` stay, as they are what makes it a replacement.
 *
 * If the calls are already a cancel's empty calls, it's a pending cancel being sped up (or
 * the same cancel built again), so everything made for them stays: its signatures still
 * apply to the same calls in the same place, and they don't have to be made again
 */
export function toCancelAccountOp(accountOp: AccountOp): AccountOp {
  const isBroadcastAsTxnPerCall =
    accountOp.meta?.speedUp?.replacedIdentifiedBy?.type === 'MultipleTxns'
  const cancelCallsCount = isBroadcastAsTxnPerCall ? Math.max(accountOp.calls.length, 1) : 1
  const speedUp = accountOp.meta?.speedUp
  // Kept if already set, so building the same cancel again (e.g. after switching to its
  // account) never picks up a nonce that was changed for the cancel in the meantime
  const replacedNonce =
    speedUp?.replacedNonce !== undefined ? speedUp.replacedNonce : accountOp.nonce
  const cancelMeta = { speedUp: { ...speedUp, enabled: true, isCancel: true, replacedNonce } }

  if (hasCancelCalls(accountOp.calls)) return { ...accountOp, meta: cancelMeta }

  return {
    ...accountOp,
    calls: Array.from({ length: cancelCallsCount }, () => ({
      id: generateUuid(),
      to: ZeroAddress,
      value: 0n,
      data: '0x'
    })),
    signingKeyAddr: null,
    signingKeyType: null,
    feeCall: undefined,
    activatorCall: undefined,
    gasLimit: null,
    signature: null,
    signed: [],
    txnId: undefined,
    safeTx: undefined,
    asUserOperation: undefined,
    meta: cancelMeta
  }
}

/**
 * The nonce of the pending transaction a cancel takes the place of, as shown to the user:
 * - sent by the account itself (EOA, 7702 EOA): its own transaction count (`eoaNonce`). A 7702
 *   EOA doesn't use its smart account nonce for a transaction it sends itself
 * - sent by another account (Ambire v1/v2 smart accounts, Safes): the smart account nonce
 *   the account signed in `execute()` / the Safe transaction
 *
 * Null if the account op isn't a cancel or the nonce isn't known.
 */
export function getCancelledNonce(
  accountOp: Partial<Pick<AccountOp, 'nonce' | 'eoaNonce' | 'gasFeePayment' | 'meta'>>
): bigint | null {
  const speedUp = accountOp.meta?.speedUp
  if (!speedUp || !isCancelAccountOp(accountOp)) return null

  const sentByAccountItselfOptions = [
    BROADCAST_OPTIONS.bySelf,
    BROADCAST_OPTIONS.bySelf7702,
    BROADCAST_OPTIONS.delegation
  ]
  const broadcastOption = accountOp.gasFeePayment?.broadcastOption
  if (broadcastOption && sentByAccountItselfOptions.includes(broadcastOption)) {
    return accountOp.eoaNonce ?? null
  }

  return speedUp.replacedNonce ?? accountOp.nonce ?? null
}
