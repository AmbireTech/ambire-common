import { UserRequest } from '../interfaces/userRequest'

const getCallsCount = (userRequests: UserRequest[]) => {
  return userRequests.reduce((acc, req) => {
    if (req.action.kind !== 'calls' || !('calls' in req.action)) return acc

    return acc + req.action.calls.length
  }, 0)
}

export { getCallsCount }
