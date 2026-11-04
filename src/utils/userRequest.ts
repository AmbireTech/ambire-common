import { UserRequest } from '../interfaces/userRequest'

/**
 * How many calls are waiting in the batch. Requests that are not part of the batch are left out:
 * Safe transactions that are already signed, and speed ups, which are requests of their own
 */
const getCallsCount = (userRequests: UserRequest[]) => {
  return userRequests.reduce((acc, req) => {
    if (req.kind !== 'calls' || !('calls' in req.signAccountOp.accountOp)) return acc
    if (req.signAccountOp.account.safeCreation && req.signAccountOp.accountOp.signed?.length)
      return acc
    if (req.signAccountOp.accountOp.meta?.speedUp?.enabled) return acc

    return acc + req.signAccountOp.accountOp.calls.length
  }, 0)
}

export { getCallsCount }
