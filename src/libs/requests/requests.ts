import { AccountId } from '../../interfaces/account'
import { DappProviderRequest } from '../../interfaces/dapp'
import {
  CallsUserRequest,
  SignUserRequest,
  SwitchAccountRequest,
  UserRequest
} from '../../interfaces/userRequest'
import { Call } from '../accountOp/types'

export const dappRequestMethodToRequestKind = (method: DappProviderRequest['method']) => {
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
    | 'walletAddEthereumChain'
    | 'walletWatchAsset'
}

export const isSignRequest = (kind: UserRequest['kind']) =>
  kind === 'calls' ||
  kind === 'message' ||
  kind === 'typedMessage' ||
  kind === 'siwe' ||
  kind === 'authorization-7702'

export const messageOnNewRequest = (request: UserRequest, addType: 'queued' | 'updated') => {
  let requestType = ''
  if (request.kind === 'calls') requestType = 'Sign Transaction'
  if (
    request.kind === 'message' ||
    request.kind === 'typedMessage' ||
    request.kind === 'authorization-7702' ||
    request.kind === 'siwe'
  )
    requestType = 'Sign Message'

  if (request.kind === 'dappConnect') requestType = 'Dapp Connect'
  if (request.kind === 'walletAddEthereumChain') requestType = 'Add Chain'
  if (request.kind === 'walletWatchAsset') requestType = 'Watch Asset'
  if (request.kind === 'ethGetEncryptionPublicKey') requestType = 'Get Encryption Public Key'

  if (addType === 'queued') {
    return `A new${requestType ? ` ${requestType} ` : ' '}request was queued.`
  }

  if (addType === 'updated') {
    return `${requestType ? ` ${requestType} ` : ' '}request was updated.`
  }

  return null
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

export const batchCallsFromUserRequests = ({
  accountAddr,
  chainId,
  userRequests
}: {
  accountAddr: AccountId
  chainId: bigint
  userRequests: UserRequest[]
}): Call[] => {
  return (userRequests.filter((r) => r.kind === 'calls') as CallsUserRequest[]).reduce(
    (uCalls: Call[], req) => {
      if (req.accountOp.chainId === chainId && req.accountOp.accountAddr === accountAddr) {
        const { calls } = req.accountOp
        calls.forEach((call) => uCalls.push({ ...call, dapp: req.meta.dapp }))
      }
      return uCalls
    },
    []
  )
}

export const buildSwitchAccountUserRequest = ({
  nextUserRequest,
  selectedAccountAddr,
  dappPromises
}: {
  nextUserRequest: SignUserRequest
  selectedAccountAddr: string
  dappPromises: UserRequest['dappPromises']
}): SwitchAccountRequest => {
  return {
    id: new Date().getTime(),
    kind: 'switchAccount',
    meta: {
      accountAddr: selectedAccountAddr,
      switchToAccountAddr: nextUserRequest.meta.accountAddr,
      nextRequestKind: nextUserRequest.kind
    },
    dappPromises
  } as SwitchAccountRequest
}

export const sumTopUps = (userRequests: UserRequest[]): bigint | undefined => {
  return (
    userRequests
      .filter((req) => req.kind === 'calls')
      .filter((req) => req.accountOp?.meta?.topUpAmount)
      .map((req) => req.accountOp.meta!.topUpAmount)
      .reduce((a, b) => a! + b!, 0n) ?? undefined
  )
}
