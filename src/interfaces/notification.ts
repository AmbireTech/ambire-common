import { TypedDataDomain, TypedDataField } from 'ethers'

import { HumanizerFragment } from '../libs/humanizer/interfaces'
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
    primaryType: keyof TypedMessage['types']
  }
}

export interface DappAction {
  kind: string
  params: any
}

export interface Message {
  id: number
  accountAddr: AccountId
  networkId: NetworkId
  content: PlainTextMessage | TypedMessage
  signature: string | null
  fromUserRequestId?: number
  // those are the async non glabal data fragments that are obtained via the humanizer and stored
  // in the Message so we can visualize it better and fater later
  humanizerFragments?: HumanizerFragment[]
}

export interface SignNotificationRequest {
  id: number
  action: Call | PlainTextMessage | TypedMessage
  meta: {
    isSign: true
    accountAddr: AccountId
    networkId: NetworkId
    [key: string]: any
  }
  // defined only when SignNotificationRequest is built from a DappRequest
  dappPromise?: {
    resolve: (data: any) => void
    reject: (data: any) => void
  }
}

export interface DappNotificationRequest {
  id: number
  action: DappAction
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

export type NotificationRequest = DappNotificationRequest | SignNotificationRequest

export type CurrentNotification =
  | {
      type: 'accountOp'
      accountAddr: string
      networkId: string
    }
  | {
      type: 'message'
      accountAddr: string
    }
  | {
      type: 'benzin'
    }
  | {
      type: 'notificationRequest'
      notificationRequest: NotificationRequest
    }
