import EventEmitter from '../eventEmitter/eventEmitter'

const DEFAULT_TIMEOUT = 60000

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
    timeout?: number,
    pollingtime?: number
  ): Promise<T | null> {
    const execTimeout = pollingtime || 0
    return new Promise((resolve) =>
      // eslint-disable-next-line no-promise-executor-return
      setTimeout(async () => {
        this.state = {
          isError: false,
          error: {}
        }
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
          return resolve({ ...result, timeouted: true })
        }

        if (!result.isError) return resolve(result)

        return resolve(this.exec(fn, params, timeout || DEFAULT_TIMEOUT, this.defaultTimeout))
      }, execTimeout)
    )
  }
}
