import { UserRequest } from '../interfaces/userRequest'

const getCallsCount = (userRequests: UserRequest[]) => {
  return userRequests.reduce((acc, req) => {
    if (req.kind !== 'calls' || !('calls' in req.accountOp)) return acc

    return acc + req.accountOp.calls.length
  }, 0)
}

export { getCallsCount }
