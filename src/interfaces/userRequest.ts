import { TypedDataDomain, TypedDataField } from 'ethers'
import { HumanizerFragment } from 'libs/humanizer/interfaces'

import { AccountId } from './account'
import { DappProviderRequest } from './dapp'
import { NetworkId } from './networkDescriptor'

export interface Call {
  kind: 'call'
  params: {
    to: string
    value: bigint
    data: string
  }
}
export interface PlainTextMessage {
  kind: 'message'
  params: {
    message: string | Uint8Array
  }
}

export interface TypedMessage {
  kind: 'typedMessage'
  params: {
    domain: TypedDataDomain
    types: Record<string, Array<TypedDataField>>
    message: Record<string, any>
    primaryType: keyof TypedMessage['params']['types']
  }
}
// @TODO: move this type and it's deps (PlainTextMessage, TypedMessage) to another place,
// probably interfaces
export interface Message {
  id: number
  accountAddr: AccountId
  content: PlainTextMessage | TypedMessage
  signature: string | null
  fromUserRequestId?: number
  // those are the async non glabal data fragments that are obtained via the humanizer and stored
  // in the Message so we can visualize it better and fater later
  humanizerFragments?: HumanizerFragment[]
  networkId: NetworkId
}

export interface SignUserRequest {
  id: number
  action: Call | PlainTextMessage | TypedMessage
  meta: {
    isSign: true
    accountAddr: AccountId
    networkId: NetworkId
    [key: string]: any
  }
  // defined only when SignUserRequest is built from a DappRequest
  dappPromise?: {
    resolve: (data: any) => void
    reject: (data: any) => void
  }
}

export interface DappUserRequest {
  id: number
  action: {
    kind: Exclude<string, 'call' | 'message' | 'typedMessage'>
    params: any
  }
  session: DappProviderRequest['session']
  meta: {
    isSign: false
    [key: string]: any
  }
  dappPromise: {
    resolve: (data: any) => void
    reject: (data: any) => void
  }
}

export type UserRequest = DappUserRequest | SignUserRequest
