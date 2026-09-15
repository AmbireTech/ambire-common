import { Fetch } from '../interfaces/fetch'
import { fetchWithTimeout } from './fetch'

export interface QueueElement {
  resolve: Function
  reject: Function
  fetch: Fetch
  data: {
    [key: string]: any
  }
  // Keep track of duplicates that should be resolved together
  linkedDuplicates?: QueueElement[]
}

export interface Request {
  url: string
  queueSegment: QueueElement[]
}

export type RequestGenerator = (queue: QueueElement[]) => Request[]

export default function batcher(
  fetch: Fetch,
  requestGenerator: RequestGenerator,
  options: {
    timeoutSettings?: {
      timeoutAfter: number
      timeoutErrorMessage: string
    }
    batchDebounce?: number
    dedupeByKeys?: string[]
    /**
     * Send a timed out request one more time before giving up on the whole batch. Meant for
     * mobile, where a cold start has nothing cached to fall back on, so giving up leaves every
     * caller in the batch without its data until the next update, minutes later.
     */
    retryTimedOutRequests?: boolean
  }
): Function {
  const {
    timeoutSettings,
    batchDebounce = 0,
    dedupeByKeys = [],
    retryTimedOutRequests = false
  } = options
  let queue: QueueElement[] = []
  let timeoutId: NodeJS.Timeout | null = null

  // Helper function to deduplicate queue elements
  function deduplicateQueue(inputQueue: QueueElement[]): QueueElement[] {
    if (!dedupeByKeys.length) return inputQueue

    const uniqueElements: QueueElement[] = []
    const seen = new Map<string, QueueElement>()

    inputQueue.forEach((element) => {
      // Create a key based on specified fields to identify duplicates
      const keyParts = dedupeByKeys.map((key) => {
        const value = element.data[key]
        return typeof value === 'object' ? JSON.stringify(value) : String(value)
      })

      const uniqueKey = keyParts.join(':')

      if (seen.has(uniqueKey)) {
        // Link the duplicate to the original request
        const original = seen.get(uniqueKey)
        if (!original) return

        if (!original.linkedDuplicates) {
          original.linkedDuplicates = []
        }
        original.linkedDuplicates.push(element)
      } else {
        // New unique element
        seen.set(uniqueKey, element)
        uniqueElements.push(element)
      }
    })

    return uniqueElements
  }

  async function resolveQueue() {
    // Note: intentionally just using the first values in the queue
    if (queue.length === 0) return

    // Process duplicates before generating requests
    const deduplicatedQueue = deduplicateQueue(queue)

    const queueCopy = deduplicatedQueue
    queue = []

    await Promise.all(
      // we let the requestGenerator split the queue into parts, each of it will be resolved with it's own url
      // this allows the possibility of one queue being resolved with multiple requests, for example if the API needs to be called
      // separately for each network
      // useful also if the API is limited to a certain # and we want to paginate
      requestGenerator(queueCopy).map(async ({ url, queueSegment }) => {
        const sendRequest = async () => {
          const resp = await fetchWithTimeout(
            fetch,
            url,
            {},
            timeoutSettings?.timeoutAfter || 20000
          )
          const body = await resp.json()
          if (resp.status !== 200) throw body
          if (Object.prototype.hasOwnProperty.call(body, 'message')) throw body
          if (Object.prototype.hasOwnProperty.call(body, 'error')) throw body

          return body
        }

        try {
          let body: any

          try {
            body = await sendRequest()
          } catch (e: any) {
            // Only a timeout is retried. Every other failure (a bad request, a server error)
            // would fail the same way a second time, so it is passed on straight away.
            if (!retryTimedOutRequests || e?.message !== 'request-timeout') throw e

            console.error(
              'Batcher timed out, retrying once: ',
              timeoutSettings?.timeoutErrorMessage
            )
            body = await sendRequest()
          }

          if (Array.isArray(body)) {
            if (body.length !== queueSegment.length)
              throw new Error('internal error: queue length and response length mismatch')
            queueSegment.forEach(({ resolve, linkedDuplicates }, i) => {
              resolve(body[i])
              // Resolve linked duplicates with the same result
              linkedDuplicates?.forEach((duplicate) => duplicate.resolve(body[i]))
            })
          } else if (queueSegment.every((x) => typeof x.data.responseIdentifier === 'string')) {
            queueSegment.forEach(({ resolve, data, linkedDuplicates }) => {
              const result = body[data.responseIdentifier as string]
              resolve(result)
              // Resolve linked duplicates with the same result
              linkedDuplicates?.forEach((duplicate) => duplicate.resolve(result))
            })
          } else throw body
        } catch (e: any) {
          if (e.message === 'request-timeout' && timeoutSettings) {
            console.error('Batcher error: ', timeoutSettings.timeoutErrorMessage)
          } else {
            console.log('Batcher error:', e)
          }
          queueSegment.forEach(({ reject, linkedDuplicates }) => {
            reject(e)
            // Reject linked duplicates with the same error
            linkedDuplicates?.forEach((duplicate) => duplicate.reject(e))
          })
        }
      })
    )
  }

  return async (data: any): Promise<any> => {
    // always do the setTimeout - if it's a second or third batchedCall within a tick, all setTimeouts will fire but only the first will perform work
    // Clear the existing timeout to avoid multiple resolveQueue calls
    if (timeoutId) {
      clearTimeout(timeoutId)
    }

    // Set a new timeout for the resolveQueue call
    timeoutId = setTimeout(resolveQueue, batchDebounce)

    return new Promise((resolve, reject) => {
      queue.push({ resolve, reject, fetch, data })
    })
  }
}
