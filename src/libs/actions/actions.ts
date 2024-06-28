// eslint-disable-next-line import/no-cycle
import { AccountOpAction, Action } from '../../controllers/actions/actions'
import { DappProviderRequest } from '../../interfaces/dapp'
import { AccountOp } from '../accountOp/accountOp'

export const dappRequestMethodToActionKind = (method: DappProviderRequest['method']) => {
  if (['call', 'calls', 'eth_sendTransaction'].includes(method)) return 'calls'
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
  return method.replace(/_(.)/g, (m, p1) => p1.toUpperCase())
}

export const getAccountOpsByNetwork = (
  accountAddr: string,
  actions: Action[]
): { [key: string]: AccountOp[] } | undefined => {
  const accountOps = (actions.filter((a) => a.type === 'accountOp') as AccountOpAction[])
    .map((a) => a.accountOp)
    .filter((op) => op.accountAddr === accountAddr)

  if (!accountOps.length) return undefined

  return accountOps.reduce((acc: any, accountOp) => {
    const { networkId } = accountOp
    if (!acc[networkId]) acc[networkId] = []

    acc[networkId].push(accountOp)
    return acc
  }, {})
}

export const getAccountOpActionsByNetwork = (
  accountAddr: string,
  actions: Action[]
): { [key: string]: AccountOpAction[] } => {
  const accountOpActions = (
    actions.filter((a) => a.type === 'accountOp') as AccountOpAction[]
  ).filter((action) => action.accountOp.accountAddr === accountAddr)

  const actionsByNetwork = accountOpActions.reduce((acc: any, accountOpAction) => {
    const { networkId } = accountOpAction.accountOp
    if (!acc[networkId]) acc[networkId] = []
    acc[networkId].push(accountOpAction)
    return acc
  }, {})
  return actionsByNetwork
}

export const getAccountOpFromAction = (
  accountOpActionId: AccountOpAction['id'],
  actions: Action[]
) => {
  const accountOpAction = actions.find((a) => a.id === accountOpActionId) as AccountOpAction
  if (!accountOpAction) return undefined
  return accountOpAction.accountOp
}

export const messageOnNewAction = (action: Action, addType: 'push' | 'unshift' | 'update') => {
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

  if (addType === 'push') {
    return `A new${requestType ? ` ${requestType} ` : ' '}request was queued.`
  }
  if (addType === 'unshift') {
    return `A new${requestType ? ` ${requestType} ` : ' '}request was added.`
  }

  return `${requestType ? ` ${requestType} ` : ' '}request was updated.`
}
