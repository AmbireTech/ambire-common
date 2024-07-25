import { AccountOpAction, Action } from '../../controllers/actions/actions'
import { Account, AccountId } from '../../interfaces/account'
import { Network, NetworkId } from '../../interfaces/network'
import { Calls, SignUserRequest, UserRequest } from '../../interfaces/userRequest'
import generateSpoofSig from '../../utils/generateSpoofSig'
import { isSmartAccount } from '../account/account'
import { AccountOp } from '../accountOp/accountOp'
import { Call as AccountOpCall } from '../accountOp/types'
import { getAccountOpsByNetwork } from '../actions/actions'

export const batchCallsFromUserRequests = ({
  accountAddr,
  networkId,
  userRequests
}: {
  accountAddr: AccountId
  networkId: NetworkId
  userRequests: UserRequest[]
}): AccountOpCall[] => {
  return (userRequests.filter((r) => r.action.kind === 'calls') as SignUserRequest[]).reduce(
    (uCalls: AccountOpCall[], req) => {
      if (req.meta.networkId === networkId && req.meta.accountAddr === accountAddr) {
        const { calls } = req.action as Calls
        calls.forEach((call) => uCalls.push({ ...call, fromUserRequestId: req.id }))
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
    // the nonce might have changed during estimation because of
    // a nonce discrepancy issue. This makes sure we're with the
    // latest nonce should the user decide to batch
    accountOpAction.accountOp.nonce = nonce
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
  const { calls } = userRequest.action as Calls
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
    calls: calls.map((call) => ({ ...call, fromUserRequestId: userRequest.id }))
  }

  return {
    // BA accountOpAction id same as the userRequest's id because for each call we have an action
    id: userRequest.id,
    type: 'accountOp',
    accountOp
  }
}

export const getAccountOpsForSimulation = (
  account: Account,
  visibleActionsQueue: Action[],
  network?: Network,
  op?: AccountOp | null
): {
  [key: string]: AccountOp[]
} => {
  const isSmart = isSmartAccount(account)

  // if there's an op and the account is either smart or the network supports
  // state override, we pass it along. We do not support simulation for
  // EOAs on networks without state override (but it works for SA)
  if (op && (isSmart || (network && !network.rpcNoStateOverride))) return { [op.networkId]: [op] }

  if (isSmart) return getAccountOpsByNetwork(account.addr, visibleActionsQueue) || {}

  return {}
}
