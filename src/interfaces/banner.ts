import { AccountOpAction } from './actions'

export type BannerType = 'error' | 'warning' | 'info' | 'info2' | 'success'
export type BannerCategory =
  | 'pending-to-be-signed-acc-op'
  | 'pending-to-be-confirmed-acc-op'
  | 'bridge-in-progress'
  | 'bridge-waiting-approval-to-resolve'
  | 'bridge-ready'
  | 'bridge-completed'
  | 'bridge-failed'
  | 'temp-seed-not-confirmed'
  | 'old-account'

export interface Banner {
  id: number | string
  accountAddr?: string
  type: BannerType
  category?: BannerCategory
  title: string
  text: string
  actions: Action[]
}

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
      meta: { activeRouteIds: string[] }
    }
  | {
      label: 'Details'
      actionName: 'open-swap-and-bridge-tab'
    }
  | {
      label: 'Hide'
      actionName: 'hide-activity-banner'
      meta: { timestamp: number; addr: string; network: string; isHideStyle: boolean }
    }
  | {
      label: 'Check'
      actionName: 'confirm-temp-seed'
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
