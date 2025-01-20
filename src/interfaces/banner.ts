import { AccountOpAction } from './actions'
import { Network } from './network'

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
  | 'activate-7702'

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
      label: 'Switch'
      actionName: 'switch-default-wallet'
      meta: {}
    }
  | {
      label: 'Select'
      actionName: 'select-rpc-url'
      meta: { network: Network }
    }
  | {
      label: 'Reject'
      actionName: 'reject-bridge'
      meta: { activeRouteId: number }
    }
  | {
      label: 'Proceed to Next Step' | 'Open'
      actionName: 'proceed-bridge'
      meta: { activeRouteId: number }
    }
  | {
      label: 'Close'
      actionName: 'close-bridge'
      meta: { activeRouteId: number }
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
      label: 'Reload'
      actionName: 'update-extension-version'
    }
  | {
      label: 'Activate'
      actionName: 'activate-7702'
    }
