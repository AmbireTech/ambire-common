export async function estimateWithRetries(
  fetchRequests: Function,
  counter: number = 0
): Promise<any> {
  console.log('estimateWithRetries', counter)
  // stop the execution on 5 fails;
  // the below error message is not shown to the user so we are safe
  if (counter >= 3)
    // TODO: return
    return new Error(
      'Estimation failure, retrying in a couple of seconds. If this issue persists, please change your RPC provider or contact Ambire support'
    )

  const santinelTimeoutErr = {}
  const estimationTimeout = new Promise((resolve) => {
    setTimeout(() => {
      resolve(santinelTimeoutErr)
    }, 3000) // TODO: return
  })

  // try to estimate the request with a given timeout.
  // if the request reaches the timeout, it cancels it and retries
  let result = await Promise.race([Promise.all(fetchRequests()), estimationTimeout])

  // retry on a timeout
  if (result === santinelTimeoutErr) {
    const incremented = counter + 1
    result = await estimateWithRetries(fetchRequests, incremented)
  } else {
    // if one of the calls returns an error, return it
    const error = Array.isArray(result) ? result.find((res) => res instanceof Error) : null
    if (error) return error
  }

  // success outcome
  return result
}
