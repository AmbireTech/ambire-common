/* eslint-disable no-promise-executor-return */
function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function waitWithAbort(ms: number) {
  let timeoutId: NodeJS.Timeout

  const promise = new Promise<void>((resolve) => {
    timeoutId = setTimeout(() => {
      resolve()
    }, ms)
  })

  return {
    promise,
    abort: () => {
      clearTimeout(timeoutId)
    }
  }
}

export default wait
