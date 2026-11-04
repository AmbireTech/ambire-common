import { Key } from '../interfaces/keystore'

const getIsViewOnly = (keys: Key[], accountKeys: string[]) => {
  return keys.every((k) => !accountKeys.includes(k.addr))
}

/**
 * Whether an account controlled by `accountKeys` can pay the fee of another
 * account's transaction, which it does with a plain transaction of its own:
 * one of its imported keys must be able to sign one. A PQ1 key can't: it
 * belongs to a smart-contract wallet that sends only its own transactions,
 * as UserOperations (see `KeystoreSignerInterface.broadcastAccountOp`).
 */
const canPayFeeForOtherAccounts = (keys: Key[], accountKeys: string[]) =>
  keys.some((k) => k.type !== 'pq1' && accountKeys.includes(k.addr))

export { canPayFeeForOtherAccounts, getIsViewOnly }
