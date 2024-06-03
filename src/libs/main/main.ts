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

// ERC-7677: paymaster sponsorship
// add to the meta of the accountOp a paymasterService if available. It is if:
// - passed in one userRequest (length of calls doesn't matter)
// - passed in multiple userRequest (same paymaster url)
const getPaymasterMetaCapabilities = (
  userRequests: UserRequest[],
  accountAddr: string,
  networkId: string
) => {
  const userRequestsForAccountOp = userRequests.filter(
    (req) =>
      req.action.kind === 'call' &&
      req.meta.accountAddr === accountAddr &&
      req.meta.networkId === networkId
  )
  const userRequestWithPaymasterService = userRequestsForAccountOp.filter(
    (req) => req.meta.capabilities?.paymasterService?.url
  )
  // if all the user requests don't have a paymasterService attached, a sponsorship cannot happen
  if (userRequestsForAccountOp.length !== userRequestWithPaymasterService.length) return undefined

  // if all the requests don't point to the same URL, a sponsorship cannot happen
  const paymasterServiceUrl =
    userRequestWithPaymasterService[0].meta.capabilities.paymasterService.url
  const areAllUrlsTheSame = userRequestWithPaymasterService.every(
    (x) => x.meta.capabilities.paymasterService.url === paymasterServiceUrl
  )
  if (!areAllUrlsTheSame) return undefined

  return { paymasterService: { url: paymasterServiceUrl } }
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
  const capabilities = getPaymasterMetaCapabilities(userRequests, account.addr, networkId)

  if (accountOpAction) {
    accountOpAction.accountOp.calls = batchCallsFromUserRequests({
      accountAddr: account.addr,
      networkId,
      userRequests
    })

    // set the meta.capabilities
    if (!accountOpAction.accountOp.meta)
      accountOpAction.accountOp.meta = capabilities ? { capabilities } : undefined
    else accountOpAction.accountOp.meta.capabilities = capabilities ?? undefined

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
    }),
    meta: capabilities ? { capabilities } : undefined
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
