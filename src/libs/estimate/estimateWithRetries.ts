import { estimationErrorEmitter } from '../../services/errorEmitter/emitter'

export async function estimateWithRetries(
  fetchRequests: Function,
  timeoutType: string,
  timeoutInMill: number = 10000,
  counter: number = 0
): Promise<any> {
  // stop the execution on 5 fails;
  // the below error message is not shown to the user so we are safe
  if (counter >= 5)
    return new Error(
      'Estimation failure, retrying in a couple of seconds. If this issue persists, please change your RPC provider or contact Ambire support'
    )

  const santinelTimeoutErr = {}
  const estimationTimeout = new Promise((resolve) => {
    setTimeout(() => {
      resolve(santinelTimeoutErr)
    }, timeoutInMill)
  })

  let result = await Promise.race([Promise.all(fetchRequests()), estimationTimeout])

  // retry on a timeout
  if (result === santinelTimeoutErr) {
    const incremented = counter + 1

    // display a timeout error only on the first try

    switch (timeoutType) {
      case 'estimation-deployless':
        estimationErrorEmitter.emit({
          level: 'major',
          message: 'Estimating gas limits from the RPC timed out. Retrying...',
          error: new Error('Estimation.sol deployless timeout')
        })
        break

      case 'estimation-bundler':
        estimationErrorEmitter.emit({
          level: 'major',
          message: 'Estimating gas limits from the bundler timed out. Retrying...',
          error: new Error('Budler gas limit estimation timeout')
        })
        break
      case 'estimation-eoa':
        estimationErrorEmitter.emit({
          level: 'major',
          message: 'Estimating gas limits for Basic Account from the RPC timed out. Retrying...',
          error: new Error('Budler gas limit estimation timeout')
        })
        break

      default:
        break
    }

    result = await estimateWithRetries(fetchRequests, timeoutType, timeoutInMill, incremented)
  } else {
    // if one of the calls returns an error, return it
    const error = Array.isArray(result) ? result.find((res) => res instanceof Error) : null
    if (error) return error
  }

  // success outcome
  return result
}
