import { CallsUserRequest } from '../../interfaces/userRequest'

export const ACCOUNT_SWITCH_USER_REQUEST = 'ACCOUNT_SWITCH_USER_REQUEST'

const getNonce = (req: CallsUserRequest): bigint | null => {
  const nonce = req.signAccountOp.accountOp.safeTx?.nonce ?? req.signAccountOp.accountOp.nonce

  return nonce === null || typeof nonce === 'undefined' ? null : BigInt(nonce)
}

/**
 * Whether to simulate account ops if the request window is closed or the current
 * request is different.
 */
export const getShouldSimulateInTheBackground = (
  currentReq: CallsUserRequest,
  callUserRequests: CallsUserRequest[]
) => {
  // simulations should get persisted for all non-Safe accounts
  if (!currentReq.signAccountOp.account.safeCreation) return true

  // check if there are other requests with a conflicting nonce to this one.
  // If there are, do not simulate this in the background
  const currentReqNonce = getNonce(currentReq)
  const hasConflictingNonceUserRequest = callUserRequests.some((r) => {
    const nonce = getNonce(r)

    return (
      currentReqNonce !== null &&
      nonce !== null &&
      r.id !== currentReq.id &&
      r.signAccountOp.accountOp.chainId === currentReq.signAccountOp.accountOp.chainId &&
      nonce === currentReqNonce
    )
  })

  return !hasConflictingNonceUserRequest
}
