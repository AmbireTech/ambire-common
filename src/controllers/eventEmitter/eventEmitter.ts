/* eslint-disable no-restricted-syntax */
import { v4 as uuidv4 } from 'uuid'

import { ErrorRef, IEventEmitterRegistryController, Statuses } from '../../interfaces/eventEmitter'
import wait from '../../utils/wait'

const LIMIT_ON_THE_NUMBER_OF_ERRORS = 100

export default class EventEmitter {
  id: string

  #registry: IEventEmitterRegistryController | null = null

  #callbacksWithId: {
    id: string | null
    cb: (forceEmit?: boolean) => void
  }[] = []

  #callbacks: ((forceEmit?: boolean) => void)[] = []

  #errorCallbacksWithId: {
    id: string | null
    cb: (error: ErrorRef) => void
  }[] = []

  #errorCallbacks: ((error: ErrorRef) => void)[] = []

  #errors: ErrorRef[] = []

  statuses: Statuses<string> = {}

  /**
   *
   * @param registry - EventEmitterRegistryController instance to be used by this controller. Controllers
   * added to the registry will have their updates and errors propagated to the front-end.
   * @param registerImmediately - Most of the time we want to register the controller in the registry
   * immediately upon construction. However, there are some dynamic controllers (like SignAccountOpController)
   * that should be registered only after a condition is met (e.g. when the request is open)
   */
  constructor(registry?: IEventEmitterRegistryController, registerImmediately: boolean = true) {
    this.id = uuidv4()

    if (registry) {
      this.#registry = registry

      if (registerImmediately) {
        this.registerInRegistry()
      }
    }
  }

  get name(): string {
    return this.constructor.name
  }

  get onUpdateIds() {
    return this.#callbacksWithId.map((item) => item.id)
  }

  get onErrorIds() {
    return this.#errorCallbacksWithId.map((item) => item.id)
  }

  // called emittedErrors and not just errors because some of the other controllers
  // that extend this one have errors defined already
  get emittedErrors() {
    return this.#errors
  }

  /**
   * Emits an update immediately, bypassing both background batching
   * (where updates on the same tick are debounced and batched for performance)
   * and React batching (where rapid state updates are merged).
   *
   * This ensures the state change is applied instantly at the React application level.
   * It is especially useful when multiple status flags change in quick succession.
   *
   * For example, if a flow updates a status from INITIAL -> LOADING -> SUCCESS -> INITIAL,
   * normal batching may skip intermediate states and only emit the first and last ones.
   */
  async forceEmitUpdate() {
    // Bypassing background batching on the same tick
    await wait(1)

    // Passing `true` to the cb will bypass React batching
    // eslint-disable-next-line no-restricted-syntax
    for (const i of this.#callbacksWithId) i.cb(true)
    // eslint-disable-next-line no-restricted-syntax
    for (const cb of this.#callbacks) cb(true)
  }

  protected emitUpdate() {
    // eslint-disable-next-line no-restricted-syntax
    for (const i of this.#callbacksWithId) i.cb()
    // eslint-disable-next-line no-restricted-syntax
    for (const cb of this.#callbacks) cb()
  }

  /**
   * Propagates updates from a child controller to its parent in a parent -> child setup,
   * ensuring child state updates reach the application without being lost due to batching.
   *
   * Used when a parent controller (e.g. swapAndBridgeController) subscribes to child updates:
   *
   *   this.#signAccountOpController.onUpdate((forceEmit) => {
   *     this.propagateUpdate(forceEmit)
   *   })
   *
   * Child controllers may update their status very quickly
   * (e.g. INITIAL -> LOADING -> SUCCESS -> INITIAL).
   * If the parent propagates these updates via `forceEmitUpdate()`,
   * the update is scheduled in a new tick and intermediate states may be lost.
   *
   * `propagateUpdate` forwards the update in the same tick while preserving the
   * `forceEmit` behavior, ensuring all states are correctly propagated.
   *
   * Notes:
   *  - If `forceEmit` is falsy, this behaves the same as calling `emitUpdate()`.
   *    For consistency and clarity, parent -> child setups should always use
   *    `propagateUpdate()` instead of mixing `emitUpdate()` and `propagateUpdate()`.
   *
   *  -  For all direct controller updates (i.e. when there is no child controller involved
   *     and the controller updates its own state), use `emitUpdate()` or `forceEmitUpdate()`.
   */
  protected propagateUpdate(forceEmit?: boolean) {
    // eslint-disable-next-line no-restricted-syntax
    for (const i of this.#callbacksWithId) i.cb(forceEmit)
    // eslint-disable-next-line no-restricted-syntax
    for (const cb of this.#callbacks) cb(forceEmit)
  }

  protected emitError(error: ErrorRef) {
    this.#errors.push(error)
    this.#trimErrorsIfNeeded()
    console.log(
      `[Еmitted error in controller ${this.constructor.name}] ${error.message}`,
      this.#errors
    )

    // eslint-disable-next-line no-restricted-syntax
    for (const i of this.#errorCallbacksWithId) i.cb(error)
    // eslint-disable-next-line no-restricted-syntax
    for (const cb of this.#errorCallbacks) cb(error)
  }

  protected async withStatus(
    callName: string,
    fn: Function,
    allowConcurrentActions = false,
    // Silence this error in prod to avoid displaying wired error messages.
    // The only benefit of displaying it is for devs to see when an action is dispatched twice.
    // TODO: If this happens on PROD, ideally we should get an error report somehow somewhere.
    errorLevel: ErrorRef['level'] = process.env.APP_ENV === 'production' &&
    process.env.IS_TESTING !== 'true'
      ? 'silent'
      : 'minor'
  ) {
    const someStatusIsLoading = Object.values(this.statuses).some((status) => status !== 'INITIAL')

    if (!this.statuses[callName]) {
      console.error(`${callName} is not defined in "statuses".`)
    }

    // By default, concurrent actions are disallowed to maintain consistency, particularly within sub-controllers where
    // simultaneous actions can lead to unintended side effects. The 'allowConcurrentActions' flag is provided to enable
    // concurrent execution at the main controller level. This is useful when multiple actions need to modify the state
    // of different sub-controllers simultaneously.
    if ((someStatusIsLoading && !allowConcurrentActions) || this.statuses[callName] !== 'INITIAL') {
      this.emitError({
        level: errorLevel,
        message: `Please wait for the completion of the previous action before initiating another one.', ${callName}`,
        error: new Error(
          'Another function is already being handled by withStatus refrain from invoking a second function.'
        )
      })

      return
    }

    this.statuses[callName] = 'LOADING'
    await this.forceEmitUpdate()

    try {
      await fn()

      this.statuses[callName] = 'SUCCESS'
      await this.forceEmitUpdate()
    } catch (error: any) {
      this.statuses[callName] = 'ERROR'
      if ('message' in error && 'level' in error && 'error' in error) {
        this.emitError(error)

        // Sometimes we don't want to show an error message to the user. For example, if the user cancels a request
        // we don't want to go through the SUCCESS state, but we also don't want to show an error message.
      } else if (error?.message) {
        this.emitError({
          message: error?.message || 'An unexpected error occurred',
          level: 'major',
          error
        })
      }
      await this.forceEmitUpdate()
    }

    this.statuses[callName] = 'INITIAL'
    await this.forceEmitUpdate()
  }

  // Prevents memory leaks and storing huge amount of errors
  #trimErrorsIfNeeded() {
    if (this.#errors.length > LIMIT_ON_THE_NUMBER_OF_ERRORS) {
      const excessErrors = this.#errors.length - LIMIT_ON_THE_NUMBER_OF_ERRORS
      this.#errors = this.#errors.slice(excessErrors)
    }
  }

  // returns an unsub function
  onUpdate(cb: (forceUpdate?: boolean) => void, id?: string): () => void {
    if (id) {
      this.#callbacksWithId.push({ id, cb })
    } else {
      this.#callbacks.push(cb)
    }

    return () => {
      if (id) {
        this.#callbacksWithId = this.#callbacksWithId.filter(
          (callbackItem) => callbackItem.id !== id
        )
      } else {
        this.#callbacks.splice(this.#callbacks.indexOf(cb), 1)
      }
    }
  }

  // returns an unsub function for error events
  onError(cb: (error: ErrorRef) => void, id?: string): () => void {
    if (id) {
      this.#errorCallbacksWithId.push({ id, cb })
    } else {
      this.#errorCallbacks.push(cb)
    }

    return () => {
      if (id) {
        this.#errorCallbacksWithId = this.#errorCallbacksWithId.filter(
          (callbackItem) => callbackItem.id !== id
        )
      } else {
        this.#errorCallbacks.splice(this.#errorCallbacks.indexOf(cb), 1)
      }
    }
  }

  destroy() {
    this.unregisterFromRegistry()
    this.#callbacks = []
    this.#callbacksWithId = []
    this.#errorCallbacks = []
    this.#errorCallbacksWithId = []
    this.#errors = []
  }

  /**
   * Registers the controller into the registry (if set) to propagate its updates and errors to the front-end.
   */
  registerInRegistry() {
    if (!this.#registry) {
      this.emitError({
        level: 'silent',
        message: `EventEmitter: Trying to register a controller while the registry is not set. Controller: ${this.name}`,
        error: new Error(
          'EventEmitter: Trying to register a controller while the registry is not set.'
        )
      })
      return
    }
    console.log('Debug: EventEmitter registered in registry', this.name)

    this.#registry.set(this.id, this)
  }

  /**
   * Unregisters the controller from the registry (if set). Used when controllers are destroyed
   * or by dynamic controllers.
   */
  unregisterFromRegistry() {
    if (!this.#registry) return
    console.log('Debug: EventEmitter unregistered from registry', this.name)

    this.#registry?.delete(this.id)
  }

  toJSON() {
    return {
      ...this,
      name: this.name,
      emittedErrors: this.emittedErrors // includes the getter in the stringified instance
    }
  }
}
