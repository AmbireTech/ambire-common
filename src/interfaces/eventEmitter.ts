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
