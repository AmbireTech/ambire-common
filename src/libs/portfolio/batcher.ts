import { Fetch } from '../../interfaces/fetch'

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
          const fetchPromise = fetch(url).then(async (resp) => {
            const body = await resp.json()
            if (resp.status !== 200) throw body
            if (body.hasOwnProperty('message')) throw body
            if (body.hasOwnProperty('error')) throw body
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

          if (timeoutSettings) {
            const timeoutPromise = new Promise((_, reject) => {
              setTimeout(() => {
                reject(new Error('Request timed out'))
              }, timeoutSettings.timeoutAfter)
            })
            await Promise.race([fetchPromise, timeoutPromise])
          } else {
            await fetchPromise
          }
        } catch (e: any) {
          if (e.message === 'Request timed out' && timeoutSettings) {
            console.error(timeoutSettings.timeoutErrorMessage)
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
