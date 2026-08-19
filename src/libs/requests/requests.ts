import { generateUuid } from '@/utils/uuid'

import { DappProviderRequest } from '../../interfaces/dapp'
import { getAccountOpNonce } from '../accountOp/accountOp'
import {
  CallsUserRequest,
  SignUserRequest,
  SwitchAccountRequest,
  UserRequest
} from '../../interfaces/userRequest'

/** Describes a queued Safe transaction that uses the nonce of the current request. */
export interface SafeNonceConflict {
  requestId: CallsUserRequest['id']
  chainId: bigint
  nonce: bigint
  nextNonce: bigint
}

/** Finds a nonce conflict for an unsigned Safe request and the next nonce available in its queue. */
export const getSafeNonceConflict = (
  currentRequest: CallsUserRequest,
  userRequests: UserRequest[]
): SafeNonceConflict | null => {
  const { account, accountOp } = currentRequest.signAccountOp

  if (
    !account.safeCreation ||
    accountOp.meta?.isOnchainSafeRejection ||
    accountOp.signed?.length ||
    accountOp.safeTx?.confirmations?.length
  )
    return null

  const currentNonce = getAccountOpNonce(accountOp)
  if (currentNonce === null) return null

  const queuedNonces = userRequests.reduce<bigint[]>((nonces, request) => {
    if (
      request.kind !== 'calls' ||
      request.id === currentRequest.id ||
      !request.signAccountOp.account.safeCreation ||
      request.signAccountOp.accountOp.accountAddr !== accountOp.accountAddr ||
      request.signAccountOp.accountOp.chainId !== accountOp.chainId
    )
      return nonces

    const nonce = getAccountOpNonce(request.signAccountOp.accountOp)
    if (nonce !== null) nonces.push(nonce)
    return nonces
  }, [])

  if (!queuedNonces.includes(currentNonce)) return null

  const highestQueuedNonce = queuedNonces.reduce(
    (highestNonce, nonce) => (nonce > highestNonce ? nonce : highestNonce),
    currentNonce
  )

  return {
    requestId: currentRequest.id,
    chainId: accountOp.chainId,
    nonce: currentNonce,
    nextNonce: highestQueuedNonce + 1n
  }
}

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
  ).filter((req) => req.signAccountOp.accountOp.accountAddr === accountAddr)

  const requestsByNetwork = callsUserRequests.reduce((acc: any, req) => {
    const { chainId } = req.signAccountOp.accountOp
    if (!acc[chainId.toString()]) acc[chainId.toString()] = []
    acc[chainId.toString()].push(req)
    return acc
  }, {})
  return requestsByNetwork
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
    id: generateUuid(),
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
      .filter((req) => req.signAccountOp.accountOp?.meta?.topUpAmount)
      .map((req) => req.signAccountOp.accountOp.meta!.topUpAmount)
      .reduce((a, b) => a! + b!, 0n) ?? undefined
  )
}
