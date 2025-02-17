import { Fetch } from '../../interfaces/fetch'
import { fetchWithTimeout } from '../../utils/fetch'

export interface QueueElement {
  resolve: Function
  reject: Function
  fetch: Fetch
  data: any
}

export interface Request {
  url: string
  queueSegment: QueueElement[]
}

export type RequestGenerator = (queue: QueueElement[]) => Request[]

export default function batcher(
  fetch: Fetch,
  requestGenerator: RequestGenerator,
  timeoutSettings?: {
    timeoutAfter: number
    timeoutErrorMessage: string
  },
  batchDebounce: number = 0
): Function {
  let queue: QueueElement[] = []

  async function resolveQueue() {
    // Note: intentionally just using the first values in the queue
    if (queue.length === 0) return
    const queueCopy = queue
    queue = []
    await Promise.all(
      // we let the requestGenerator split the queue into parts, each of it will be resolved with it's own url
      // this allows the possibility of one queue being resolved with multiple requests, for example if the API needs to be called
      // separately for each network
      // useful also if the API is limited to a certain # and we want to paginate
      requestGenerator(queueCopy).map(async ({ url, queueSegment }) => {
        try {
          const fetchPromise = fetchWithTimeout(
            fetch,
            url,
            {},
            timeoutSettings?.timeoutAfter || 20000
          ).then(async (resp) => {
            const body = await resp.json()
            if (resp.status !== 200) throw body
            if (Object.prototype.hasOwnProperty.call(body, 'message')) throw body
            if (Object.prototype.hasOwnProperty.call(body, 'error')) throw body
            if (Array.isArray(body)) {
              if (body.length !== queueSegment.length)
                throw new Error('internal error: queue length and response length mismatch')
              queueSegment.forEach(({ resolve }, i) => resolve(body[i]))
            } else if (queueSegment.every((x) => typeof x.data.responseIdentifier === 'string')) {
              queueSegment.forEach(({ resolve, data }) =>
                resolve(body[data.responseIdentifier as string])
              )
            } else throw body
          })

          await fetchPromise
        } catch (e: any) {
          if (e.message === 'request-timeout' && timeoutSettings) {
            console.error('Batcher error: ', timeoutSettings.timeoutErrorMessage)
          } else {
            console.log('Batcher error:', e)
          }
          queueSegment.forEach(({ reject }) => reject(e))
        }
      })
    )
  }
  return async (data: any): Promise<any> => {
    // always do the setTimeout - if it's a second or third batchedCall within a tick, all setTimeouts will fire but only the first will perform work
    setTimeout(resolveQueue, batchDebounce)
    return new Promise((resolve, reject) => {
      queue.push({ resolve, reject, fetch, data })
    })
  }
}
