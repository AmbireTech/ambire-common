import { DappProviderRequest } from './dapp'

export interface BasicNotificationRequest extends DappProviderRequest {
  id: string
  promises: {
    resolve: (data: any) => void
    reject: (data: any) => void
  }[]
}

export interface SignNotificationRequest extends DappProviderRequest {
  id: string
  promises: {
    fromUserRequestId: number
    resolve: (data: any) => void
    reject: (data: any) => void
  }[]
}

export type NotificationRequest = BasicNotificationRequest | SignNotificationRequest
