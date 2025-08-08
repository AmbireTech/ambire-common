export interface IEventEmitter {
  statuses: Statuses<string>
  onUpdateIds: (string | null)[]
  onErrorIds: (string | null)[]
  emittedErrors: ErrorRef[]
  forceEmitUpdate(): Promise<void>
  emitUpdate(): void
  emitError(error: ErrorRef): void
  withStatus(
    callName: string,
    fn: Function,
    allowConcurrentActions?: boolean,
    errorLevel?: ErrorRef['level']
  ): Promise<void>
  onUpdate(cb: (forceUpdate?: boolean) => void, id?: string): () => void
  onError(cb: (error: ErrorRef) => void, id?: string): () => void
}

export type Statuses<T extends string> = {
  [key in T]: 'INITIAL' | 'LOADING' | 'SUCCESS' | 'ERROR' | string
}

export type ErrorRef = {
  // user-friendly message, ideally containing call to action
  message: string
  // error level, used for filtering
  level: 'fatal' | 'major' | 'minor' | 'silent'
  // error containing technical details and stack trace
  error: Error
}
