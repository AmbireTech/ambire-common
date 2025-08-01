import { AccountOpAction } from './actions'

export type BannerType = 'error' | 'warning' | 'info' | 'info2' | 'success'
export type BannerCategory =
  | 'pending-to-be-signed-acc-op'
  | 'pending-to-be-confirmed-acc-op'
  | 'successful-acc-op'
  | 'failed-acc-op'
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
  actions: Action[]
  meta?: {
    accountAddr?: string
    startTime?: number
    endTime?: number
  }
}

export type MarketingBannerTypes = 'updates' | 'rewards' | 'new' | 'vote' | 'tips' | 'alert'

export type Action =
  | {
      label: 'Open'
      actionName: 'open-pending-dapp-requests'
    }
  | {
      label: 'Open'
      actionName: 'open-accountOp'
      meta: { actionId: AccountOpAction['id'] }
    }
  | {
      label: 'Reject'
      actionName: 'reject-accountOp'
      meta: {
        err: string
        actionId: AccountOpAction['id']
        shouldOpenNextAction: boolean
      }
    }
  | {
      label: 'Sync'
      actionName: 'sync-keys'
      meta: { email: string; keys: string[] }
    }
  | {
      label: string
      actionName: 'open-external-url'
      meta: { url: string }
    }
  | {
      label: string
      actionName: 'backup-keystore-secret'
    }
  | {
      label: 'Reject'
      actionName: 'reject-bridge'
      meta: { activeRouteIds: string[] }
    }
  | {
      label: 'Proceed to Next Step' | 'Open'
      actionName: 'proceed-bridge'
      meta: { activeRouteId: string }
    }
  | {
      label: 'Close'
      actionName: 'close-bridge'
      meta: { activeRouteIds: string[]; isHideStyle: boolean }
    }
  | {
      label: 'Details'
      actionName: 'open-swap-and-bridge-tab'
    }
  | {
      label: 'Hide'
      actionName: 'hide-activity-banner'
      meta: { timestamp: number; addr: string; chainId: bigint; isHideStyle: boolean }
    }
  | {
      label: 'Open'
      actionName: 'open-first-cashback-modal'
    }
  | {
      label: 'Reload'
      actionName: 'update-extension-version'
    }
  | {
      label: 'Retry'
      actionName: 'reload-selected-account'
    }
  | {
      label: 'Dismiss'
      actionName: 'dismiss-email-vault'
    }
  | {
      label: 'Dismiss'
      actionName: 'dismiss-7702-banner'
      meta: { accountAddr: string }
    }
  | {
      label: 'View'
      actionName: 'view-bridge'
    }
  | {
      label: 'Enable all'
      actionName: 'enable-networks'
      meta: { networkChainIds: bigint[] }
    }
  | {
      label: 'Enable'
      actionName: 'enable-networks'
      meta: { networkChainIds: bigint[] }
    }
  | {
      label: 'Dismiss'
      actionName: 'dismiss-defi-positions-banner'
    }
  | { label: 'Open'; actionName: 'open-link'; meta: { url: string } }
