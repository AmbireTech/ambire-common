import { SignMessageAction } from 'controllers/actions/actions'
import { TypedDataDomain, TypedDataField } from 'ethers'

import { Call as AccountOpCall } from '../libs/accountOp/types'
import { AccountId } from './account'
import { DappProviderRequest } from './dapp'
import { HumanizerFragment } from './humanizer'
import { NetworkId } from './network'

export interface Calls {
  kind: 'calls'
  calls: {
    to: string
    value: bigint
    data: string
  }[]
}
export interface PlainTextMessage {
  kind: 'message'
  message: string | Uint8Array
}

export interface TypedMessage {
  kind: 'typedMessage'
  domain: TypedDataDomain
  types: Record<string, Array<TypedDataField>>
  message: Record<string, any>
  primaryType: keyof TypedMessage['types']
}
// @TODO: move this type and it's deps (PlainTextMessage, TypedMessage) to another place,
// probably interfaces
export interface Message {
  fromActionId: SignMessageAction['id']
  accountAddr: AccountId
  networkId: NetworkId
  content: PlainTextMessage | TypedMessage
  signature: string | null
  // those are the async non global data fragments that are obtained via the humanizer and stored
  // in the Message so we can visualize it better and fatter later
  humanizerFragments?: HumanizerFragment[]
}

export interface SignUserRequest {
  id: string | number
  action: Calls | PlainTextMessage | TypedMessage | { kind: 'benzin' }
  session?: DappProviderRequest['session']
  meta: {
    isSignAction: true
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
  id: string | number
  action: {
    kind: Exclude<string, 'calls' | 'message' | 'typedMessage' | 'benzin'>
    params: any
  }
  session: DappProviderRequest['session']
  meta: {
    isSignAction: false
    [key: string]: any
  }
  dappPromise: {
    resolve: (data: any) => void
    reject: (data: any) => void
  }
}

export type UserRequest = DappUserRequest | SignUserRequest
