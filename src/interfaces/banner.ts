import { AccountOpAction } from 'controllers/actions/actions'

import { NetworkDescriptor } from './networkDescriptor'

export type BannerType = 'error' | 'warning' | 'info' | 'success'

export interface Banner {
  id: number | string
  accountAddr?: string
  type: BannerType
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
      meta: {
        actionId: AccountOpAction['id']
        shouldActivateInactiveActions: true
      }
    }
  | {
      label: 'Reject'
      actionName: 'reject-accountOp'
      meta: {
        err: string
        actionId: AccountOpAction['id']
      }
    }
  | {
      label: 'Sync'
      actionName: 'sync-keys'
      meta: {
        email: string
        keys: string[]
      }
    }
  | {
      label: string
      actionName: 'open-external-url'
      meta: {
        url: string
      }
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
      meta: {
        network: NetworkDescriptor
      }
    }
