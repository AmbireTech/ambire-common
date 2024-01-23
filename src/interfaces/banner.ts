export const BANNER_TOPICS = {
  TRANSACTION: 'TRANSACTION',
  ANNOUNCEMENT: 'ANNOUNCEMENT',
  WARNING: 'WARNING'
} as const

export type BannerTopic = 'TRANSACTION' | 'ANNOUNCEMENT' | 'WARNING'

export interface Banner {
  id: number | string
  topic: BannerTopic
  title: string
  text: string
  actions: Action[]
}

export type Action =
  | {
      label: 'Open'
      actionName: 'open'
      meta: {
        ids: number[]
      }
    }
  | {
      label: 'Reject'
      actionName: 'reject'
      meta: {
        ids: number[]
        err: string
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
      label: 'Enable'
      actionName: 'enable-default-wallet'
      meta: {}
    }
