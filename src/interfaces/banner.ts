export const BANNER_TOPICS = {
  TRANSACTION: 'TRANSACTION',
  ANNOUNCEMENT: 'ANNOUNCEMENT',
  WARNING: 'WARNING'
} as const

export type BannerTopic = 'TRANSACTION' | 'ANNOUNCEMENT' | 'WARNING'

export interface Banner {
  id: number
  topic: BannerTopic
  title: string
  text: string
  actions: {
    label: string
    onPress: () => void
  }[]
}
