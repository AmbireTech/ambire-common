type Warning = {
  id: string
  title: string
  text?: string
  promptBeforeSign: boolean
  displayBeforeSign: boolean
}

enum TraceCallDiscoveryStatus {
  NotStarted = 'not-started',
  InProgress = 'in-progress',
  SlowPendingResponse = 'slow-pending-response',
  Done = 'done',
  Failed = 'failed'
}

export { TraceCallDiscoveryStatus }
export type { Warning }
