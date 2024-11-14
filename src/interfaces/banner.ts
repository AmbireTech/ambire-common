import { AccountOpAction } from 'controllers/actions/actions'

import { Network } from './network'

export type BannerType = 'error' | 'warning' | 'info' | 'info2' | 'success'
export type BannerCategory =
  | 'pending-to-be-signed-acc-op'
  | 'pending-to-be-confirmed-acc-op'
  | 'bridge-in-progress'
  | 'bridge-ready'
  | 'bridge-completed'
  | 'temp-seed-not-confirmed'

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
      label: 'Got it' | 'Close'
      actionName: 'close-bridge'
      meta: { activeRouteId: number }
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
