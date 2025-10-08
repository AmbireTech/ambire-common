import { ControllerInterface } from './controller'

export type ISignAccountOpController = ControllerInterface<
  InstanceType<typeof import('../controllers/signAccountOp/signAccountOp').SignAccountOpController>
>

type Warning = {
  id: string
  title: string
  text?: string
  promptBefore?: ('sign' | 'one-click-sign')[]
  type?: Type
}

type Type = 'error' | 'warning' | 'info3'

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
