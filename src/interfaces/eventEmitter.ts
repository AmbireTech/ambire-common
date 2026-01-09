import { ControllerInterfaceWithoutEventEmitter } from './controller'

export type ErrorRef = {
  /**
   * User-friendly message, ideally containing call to action
   */
  message: string
  /**
   * Logged in the console - all
   * Displayed as a banner - expected, major
   * Reported to the error tracking service by default - all, except `expected`
   */
  level: 'expected' | 'minor' | 'silent' | 'major'

  /**
   * Whether the error be reported to the error tracking service (e.g. Sentry).
   * The default value depends on the error level. See the `level` property for more info.
   */
  sendCrashReport?: boolean
  /**
   * The original error, containing technical details and stack trace
   */
  error: Error
}

export type Statuses<T extends string> = {
  [key in T]: 'INITIAL' | 'LOADING' | 'SUCCESS' | 'ERROR' | string
}

export type IEventEmitterRegistryController = ControllerInterfaceWithoutEventEmitter<
  InstanceType<
    typeof import('../controllers/eventEmitterRegistry/eventEmitterRegistry').EventEmitterRegistryController
  >
>
