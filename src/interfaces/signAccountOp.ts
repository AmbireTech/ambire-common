type Warning = {
  id: string
  title: string
  text?: string
  promptBeforeSign: boolean
}

type SignAccountOpError = {
  title: string
  code?: string
  text?: string
}

enum TraceCallDiscoveryStatus {
  NotStarted = 'not-started',
  InProgress = 'in-progress',
  SlowPendingResponse = 'slow-pending-response',
  Done = 'done',
  Failed = 'failed'
}

export { TraceCallDiscoveryStatus }
export type { Warning, SignAccountOpError }
