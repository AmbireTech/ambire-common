import EventEmitter from '../../controllers/eventEmitter/eventEmitter'

const DEFAULT_TIMEOUT = 60000
// DOCS
// the purpouse ofthis class is to make requests until a specific case is satisfied, unallowed error occures or the time runs out
// used for checking if the magicLink, sent to the email, has been clicked, making the emailAddress confirmed and eligible for email vult
export class Polling extends EventEmitter {
  state: {
    isError: boolean
    error?: any
  }

  defaultTimeout: number = 2000

  allowableErrors: number[] = [401]

  startTime: number = new Date().getTime()

  constructor(allowableErrors?: number[]) {
    super()
    this.state = {
      isError: false
    }
    if (allowableErrors) this.allowableErrors = allowableErrors
  }

  async exec<T>(
    fn: Function,
    params: any,
    cleanup: Function | null,
    shouldStop: Function | null,
    timeout?: number,
    pollingtime?: number
  ): Promise<T | null> {
    const execTimeout = pollingtime || 0
    const promise: T | null = await new Promise((resolve) =>
      // eslint-disable-next-line no-promise-executor-return
      setTimeout(async () => {
        this.state = {
          isError: false,
          error: {}
        }
        if (shouldStop && shouldStop()) return resolve(null)
        const result = await fn(...params)
          .catch((error: any) => ({ isError: true, error }))
          .then((res: any) => ({ isError: false, ...res }))
        if (result.isError && this.allowableErrors.includes(result?.error?.output?.res?.status)) {
          this.state = result
          this.emitUpdate()
        } else if (result.isError) {
          return resolve(result)
        }

        if (new Date().getTime() - this.startTime >= (timeout || DEFAULT_TIMEOUT)) {
          return resolve({ ...result, error: new Error('timeout') })
        }

        if (!result.isError) return resolve(result)

        return resolve(
          await this.exec(
            fn,
            params,
            () => null,
            shouldStop,
            timeout || DEFAULT_TIMEOUT,
            this.defaultTimeout
          )
        )
      }, execTimeout)
    )
    cleanup && cleanup()
    return promise
  }
}
