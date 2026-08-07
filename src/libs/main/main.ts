import { CallsUserRequest } from '../../interfaces/userRequest'

export const ACCOUNT_SWITCH_USER_REQUEST = 'ACCOUNT_SWITCH_USER_REQUEST'

/**
 * Whether to simulate account ops if the request window is closed or the current
 * request is different.
 */
export const getShouldSimulateInTheBackground = (currentReq: CallsUserRequest) => {
  // simulations should get persisted for all non-Safe accounts
  if (!currentReq.signAccountOp.account.safeCreation) return true

  // OK, so why we do override the current simulation each time for safe accounts?
  // because Safe accounts might have a queue waiting and we want to do:
  // - if there's a next request, simulate only the next request as
  // we want to show only that simulation in signAccountOp
  // - if there isn't a next request, simulate all eligible txns in the queue for
  // this network. That means all not rejected txns from the current nonce until
  // we hit a nonce that's rejected or non-existent. The goal is to have a
  // snapshot on the dashboard until the latest nonce so you could continue
  // chaining.
  // Let's say we have txns with nonces 131, 132, 133 - if you want to prepare
  // from the dashboard a txn for nonce 134, you would like to do so from the
  // snapshot after 133. Also, if you want to do for 132, you can first reject
  // the txn with nonce 132, making the simulation execute until 131, and do
  // from the snapshot from there
  //
  // There exists a world where we could optimize this: if this is the only
  // eligible req for the network, persist it. However, eligible means making
  // tons of checks and introducing the possibility for bugs. I would rather
  // re-simulate each time a request has changed then try to micro-manage
  return false
}
