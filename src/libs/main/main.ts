import { AccountOpAction, Action } from '../../controllers/actions/actions'
import { Account, AccountId } from '../../interfaces/account'
import { NetworkId } from '../../interfaces/networkDescriptor'
import { Call, SignUserRequest, UserRequest } from '../../interfaces/userRequest'
import generateSpoofSig from '../../utils/generateSpoofSig'
import { Call as AccountOpCall } from '../accountOp/types'

export const batchCallsFromUserRequests = ({
  accountAddr,
  networkId,
  userRequests
}: {
  accountAddr: AccountId
  networkId: NetworkId
  userRequests: UserRequest[]
}): AccountOpCall[] => {
  return (userRequests.filter((r) => r.action.kind === 'call') as SignUserRequest[]).reduce(
    (uCalls: AccountOpCall[], req) => {
      if (req.meta.networkId === networkId && req.meta.accountAddr === accountAddr) {
        const action = (req as SignUserRequest).action as Call
        action.txns.forEach((txn) => {
          const { to, value, data } = txn
          uCalls.push({ to, value, data, fromUserRequestId: req.id })
        })
      }
      return uCalls
    },
    []
  )
}

export const makeSmartAccountOpAction = ({
  account,
  networkId,
  nonce,
  actionsQueue,
  userRequests
}: {
  account: Account
  networkId: string
  nonce: bigint | null
  actionsQueue: Action[]
  userRequests: UserRequest[]
}): AccountOpAction => {
  const accountOpAction = actionsQueue.find(
    (a) => a.type === 'accountOp' && a.id === `${account.addr}-${networkId}`
  ) as AccountOpAction | undefined

  if (accountOpAction) {
    accountOpAction.accountOp.calls = batchCallsFromUserRequests({
      accountAddr: account.addr,
      networkId,
      userRequests
    })
    return accountOpAction
  }

  const accountOp = {
    accountAddr: account.addr,
    networkId,
    signingKeyAddr: null,
    signingKeyType: null,
    gasLimit: null,
    gasFeePayment: null,
    nonce,
    signature: account.associatedKeys[0] ? generateSpoofSig(account.associatedKeys[0]) : null,
    accountOpToExecuteBefore: null, // @TODO from pending recoveries
    calls: batchCallsFromUserRequests({
      accountAddr: account.addr,
      networkId,
      userRequests
    })
  }
  return {
    id: `${account.addr}-${networkId}`, // SA accountOpAction id
    type: 'accountOp',
    accountOp
  }
}

export const makeBasicAccountOpAction = ({
  account,
  networkId,
  nonce,
  userRequest
}: {
  account: Account
  networkId: string
  nonce: bigint | null
  userRequest: UserRequest
}): AccountOpAction => {
  const action = userRequest.action as Call
  const uCalls: AccountOpCall[] = []
  action.txns.forEach((txn) => {
    const { to, value, data } = txn
    uCalls.push({ to, value, data, fromUserRequestId: userRequest.id })
  })
  const accountOp = {
    accountAddr: account.addr,
    networkId,
    signingKeyAddr: null,
    signingKeyType: null,
    gasLimit: null,
    gasFeePayment: null,
    nonce,
    signature: account.associatedKeys[0] ? generateSpoofSig(account.associatedKeys[0]) : null,
    accountOpToExecuteBefore: null, // @TODO from pending recoveries
    calls: uCalls
  }

  return {
    // BA accountOpAction id same as the userRequest's id because for each call we have an action
    id: userRequest.id,
    type: 'accountOp',
    accountOp
  }
}
