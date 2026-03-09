import { ControllerInterface } from './controller'
import { UserRequest } from './userRequest'

export type IBannerController = ControllerInterface<
  InstanceType<typeof import('../controllers/banner/banner').BannerController>
>

export type BannerType = 'error' | 'warning' | 'info' | 'success'
export type BannerCategory =
  | 'pending-to-be-signed-acc-op'
  | 'pending-to-be-confirmed-acc-ops'
  | 'successful-acc-op'
  | 'failed-acc-ops'
  | 'bridge-in-progress'
  | 'bridge-waiting-approval-to-resolve'
  | 'bridge-ready'
  | 'bridge-completed'
  | 'bridge-failed'
  | 'temp-seed-not-confirmed'
  | 'old-account'

export interface Banner {
  id: number | string
  type: BannerType | MarketingBannerTypes
  category?: BannerCategory
  title: string
  text?: string
  // Force a single action on purpose
  actions: [Action] | []
  dismissAction?: Action
  meta?: {
    accountAddr?: string
    startTime?: number
    endTime?: number
    [key: string]: any
  }
}

export type MarketingBannerTypes = 'updates' | 'rewards' | 'new' | 'vote' | 'tips' | 'alert'

export type Action =
  | {
      actionName: 'open-pending-dapp-requests'
    }
  | {
      actionName: 'open-accountOp'
      meta: { requestId: UserRequest['id'] }
    }
  | {
      actionName: 'reject-accountOp'
      meta: {
        err: string
        requestId: UserRequest['id']
        shouldOpenNextAction: boolean
      }
    }
  | {
      actionName: 'sync-keys'
      meta: { email: string; keys: string[] }
    }
  | {
      actionName: 'open-external-url'
      meta: { url: string }
    }
  | {
      actionName: 'backup-keystore-secret'
    }
  | {
      actionName: 'reject-bridge'
      meta: { activeRouteIds: string[] }
    }
  | {
      actionName: 'proceed-bridge'
      meta: { activeRouteId: string }
    }
  | {
      actionName: 'close-bridge'
      meta: { activeRouteIds: string[]; isHideStyle: boolean }
    }
  | {
      actionName: 'open-swap-and-bridge-tab'
    }
  | {
      actionName: 'hide-activity-banner'
      meta: { timestamp: number; addr: string; chainId: bigint; isHideStyle: boolean }
    }
  | {
      actionName: 'update-extension-version'
    }
  | {
      actionName: 'reload-selected-account'
    }
  | {
      actionName: 'dismiss-email-vault'
    }
  | {
      actionName: 'dismiss-7702-banner'
      meta: { accountAddr: string }
    }
  | {
      actionName: 'view-bridge'
    }
  | {
      actionName: 'enable-networks'
      meta: { networkChainIds: bigint[] }
    }
  | {
      actionName: 'enable-networks'
      meta: { networkChainIds: bigint[] }
    }
  | {
      actionName: 'dismiss-defi-positions-banner'
    }
  | { actionName: 'open-link'; meta: { url: string } }
