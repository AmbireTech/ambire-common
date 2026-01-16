import { UserRequest } from '../interfaces/userRequest'

const getCallsCount = (userRequests: UserRequest[]) => {
  return userRequests.reduce((acc, req) => {
    if (req.kind !== 'calls' || !('calls' in req.signAccountOp.accountOp)) return acc

    return acc + req.signAccountOp.accountOp.calls.length
  }, 0)
}

export { getCallsCount }
