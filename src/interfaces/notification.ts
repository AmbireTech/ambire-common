import { DappProviderRequest } from './dapp'

interface BasicNotificationRequest extends DappProviderRequest {
  id: string
  promises: {
    resolve: (data: any) => void
    reject: (data: any) => void
  }[]
}

interface SignNotificationRequest extends DappProviderRequest {
  id: string
  promises: {
    fromUserRequestId: number
    resolve: (data: any) => void
    reject: (data: any) => void
  }[]
}

export type NotificationRequest = BasicNotificationRequest | SignNotificationRequest
