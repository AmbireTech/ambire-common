export interface NotificationManager {
  createNotification: ({
    title,
    description,
    timeout
  }: {
    title: string
    description: string
    timeout?: number
  }) => void
}
