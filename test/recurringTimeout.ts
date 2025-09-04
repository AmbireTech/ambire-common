/* eslint-disable no-await-in-loop */
import { IRecurringTimeout } from '../src/classes/recurringTimeout/recurringTimeout'

export const waitForFnToBeCalledAndExecuted = async (
  recurringTimeout: IRecurringTimeout,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  id: string = '' // for testing
): Promise<{ fnExecutionsCount: number }> => {
  const initialFnExecutionsCount = recurringTimeout.fnExecutionsCount
  while (recurringTimeout.startScheduled) {
    await jest.advanceTimersByTimeAsync(1)
  }
  expect(recurringTimeout.running).toBe(true)
  let sessionId = recurringTimeout.sessionId
  await jest.advanceTimersByTimeAsync(recurringTimeout.currentTimeout)
  // can be restarted while in progress
  while (sessionId !== recurringTimeout.sessionId) {
    sessionId = recurringTimeout.sessionId
    await jest.advanceTimersByTimeAsync(
      recurringTimeout.currentTimeout - (Date.now() - recurringTimeout.startedRunningAt)
    )
  }

  // promise might be undefined if it is terminated from within the fn
  if (recurringTimeout.promise)
    while (recurringTimeout.promise) {
      await jest.advanceTimersByTimeAsync(1)
    }
  expect(recurringTimeout.promise).toBe(undefined)
  await Promise.resolve()

  return { fnExecutionsCount: recurringTimeout.fnExecutionsCount - initialFnExecutionsCount }
}
