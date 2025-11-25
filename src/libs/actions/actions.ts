import { AccountOpAction, Action, DappRequestAction } from '../../interfaces/actions'
import { DappProviderRequest } from '../../interfaces/dapp'
import { CallsUserRequest, UserRequest } from '../../interfaces/userRequest'

export const dappRequestMethodToActionKind = (method: DappProviderRequest['method']) => {
  if (['call', 'calls', 'eth_sendTransaction', 'wallet_sendCalls'].includes(method)) return 'calls'
  if (
    [
      'eth_signTypedData',
      'eth_signTypedData_v1',
      'eth_signTypedData_v3',
      'eth_signTypedData_v4'
    ].includes(method)
  )
    return 'typedMessage'
  if (['personal_sign'].includes(method)) return 'message'
  // method to camelCase
  return method.replace(/_(.)/g, (m, p1) => p1.toUpperCase()) as
    | 'dappConnect'
    | 'unlock'
    | 'switchAccount'
    | 'walletAddEthereumChain'
    | 'walletWatchAsset'
}

export const getCallsUserRequestsByNetwork = (
  accountAddr: string,
  userRequests: UserRequest[]
): { [key: string]: CallsUserRequest[] } => {
  const callsUserRequests = (
    userRequests.filter((r) => r.kind === 'calls') as CallsUserRequest[]
  ).filter((req) => req.accountOp.accountAddr === accountAddr)

  const requestsByNetwork = callsUserRequests.reduce((acc: any, req) => {
    const { chainId } = req.accountOp
    if (!acc[chainId.toString()]) acc[chainId.toString()] = []
    acc[chainId.toString()].push(req)
    return acc
  }, {})
  return requestsByNetwork
}

export const getAccountOpFromAction = (
  accountOpActionId: AccountOpAction['id'],
  actions: Action[]
) => {
  const accountOpAction = actions.find((a) => a.id === accountOpActionId) as AccountOpAction
  if (!accountOpAction) return undefined
  return accountOpAction.accountOp
}

export const messageOnNewAction = (action: Action, addType: 'queued' | 'updated') => {
  let requestType = ''
  if (action.type === 'accountOp') requestType = 'Sign Transaction'
  if (action.type === 'signMessage') requestType = 'Sign Message'
  if (action.type === 'dappRequest') {
    if (action.userRequest.action.kind === 'dappConnect') requestType = 'Dapp Connect'
    if (action.userRequest.action.kind === 'walletAddEthereumChain') requestType = 'Add Chain'
    if (action.userRequest.action.kind === 'walletWatchAsset') requestType = 'Watch Asset'
    if (action.userRequest.action.kind === 'ethGetEncryptionPublicKey')
      requestType = 'Get Encryption Public Key'
  }

  if (addType === 'queued') {
    return `A new${requestType ? ` ${requestType} ` : ' '}request was queued.`
  }

  if (addType === 'updated') {
    return `${requestType ? ` ${requestType} ` : ' '}request was updated.`
  }

  return null
}

/** Type guard helper to check if an action is a DappRequestAction */
export const isDappRequestAction = (action?: Action | null): action is DappRequestAction =>
  action?.type === 'dappRequest'
