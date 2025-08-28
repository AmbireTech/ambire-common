import { RecurringTimeout } from './recurringTimeout'

describe('RecurringTimeout', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.spyOn(global.console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
    ;(console.error as jest.Mock).mockRestore()
  })

  const createDeferred = () => {
    let resolve!: () => void
    let reject!: (e?: any) => void
    const promise = new Promise<void>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }
  test('start should schedule the execution of the fn and run after timeout (no runImmediately)', async () => {
    const callOrder: string[] = []
    const deferred = createDeferred()
    const fn = jest.fn(() => {
      callOrder.push('fn-start')
      return deferred.promise.finally(() => callOrder.push('fn-end'))
    })

    const t = new RecurringTimeout(fn, 1000)
    t.start()

    await jest.advanceTimersByTimeAsync(0) // wait for the debounce timeout
    expect(fn).not.toHaveBeenCalled() // not run immediately by default

    await jest.advanceTimersByTimeAsync(999)
    expect(fn).not.toHaveBeenCalled()

    await jest.advanceTimersByTimeAsync(1)
    expect(fn).toHaveBeenCalledTimes(1) // loop() started and awaited fn()

    deferred.resolve() // complete the execution of the fn
    await Promise.resolve() // this await the promise of the fn to run its .then/.catch/.finally

    await jest.advanceTimersByTimeAsync(999)
    expect(fn).toHaveBeenCalledTimes(1)

    await jest.advanceTimersByTimeAsync(1)
    expect(fn).toHaveBeenCalledTimes(2)

    deferred.resolve() // complete the execution of the fn
    await Promise.resolve() // this await the promise of the fn to run its .then/.catch/.finally
    expect(callOrder).toEqual(['fn-start', 'fn-end', 'fn-start', 'fn-end'])
  })
  test('start with runImmediately should call the fn without initial delay', async () => {
    const deferred = createDeferred()
    const fn = jest.fn(() => deferred.promise)

    const t = new RecurringTimeout(fn, 500)
    t.start({ runImmediately: true })

    await jest.advanceTimersByTimeAsync(0) // wait for the debounce timeout
    expect(fn).toHaveBeenCalledTimes(1)

    deferred.resolve()
    await Promise.resolve() // this await the promise of the fn to run its .then/.catch/.finally

    await jest.advanceTimersByTimeAsync(499)
    expect(fn).toHaveBeenCalledTimes(1)

    await jest.advanceTimersByTimeAsync(1)
    expect(fn).toHaveBeenCalledTimes(2)
  })
  test('should not overlap: next fn run waits until the previous one resolves', async () => {
    const first = createDeferred()
    const second = createDeferred()
    const fn = jest
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)

    const t = new RecurringTimeout(fn, 200)
    t.start({ runImmediately: true })

    await jest.advanceTimersByTimeAsync(0) // wait for the debounce timeout
    expect(fn).toHaveBeenCalledTimes(1)

    // Advance much more than 200ms; should not start again until first resolves
    await jest.advanceTimersByTimeAsync(1000)
    expect(fn).toHaveBeenCalledTimes(1)

    // Resolve first; only now the next setTimeout is scheduled
    first.resolve()
    await Promise.resolve() // this await the promise of the fn to run its .then/.catch/.finally

    // Now advance to trigger the second run
    await jest.advanceTimersByTimeAsync(200)
    expect(fn).toHaveBeenCalledTimes(2)
  })
  test('stop should prevent further fn runs and clears timer', async () => {
    const d1 = createDeferred()
    const fn = jest.fn(() => d1.promise)

    const t = new RecurringTimeout(fn, 300)
    t.start({ runImmediately: true })

    await jest.advanceTimersByTimeAsync(0) // wait for the debounce timeout
    expect(fn).toHaveBeenCalledTimes(1)

    t.stop() // call stop while in progress

    d1.resolve()
    await Promise.resolve() // this await the promise of the fn to run its .then/.catch/.finally

    await jest.advanceTimersByTimeAsync(10000)
    expect(fn).toHaveBeenCalledTimes(1) // no new run should be scheduled
  })
  test('restart should apply new timeout and force restart the timer', async () => {
    const d1 = createDeferred()
    const d2 = createDeferred()
    const fn = jest
      .fn()
      .mockImplementationOnce(() => d1.promise)
      .mockImplementationOnce(() => d2.promise)

    const t = new RecurringTimeout(fn, 1000)
    t.start({ runImmediately: true })

    await jest.advanceTimersByTimeAsync(0) // wait for the debounce timeout
    expect(fn).toHaveBeenCalledTimes(1)

    t.restart({ timeout: 100, runImmediately: false }) // restart while fn is in progress

    d1.resolve()
    await Promise.resolve() // this await the promise of the fn to run its .then/.catch/.finally

    await jest.advanceTimersByTimeAsync(99)
    expect(fn).toHaveBeenCalledTimes(1)

    await jest.advanceTimersByTimeAsync(1)
    expect(fn).toHaveBeenCalledTimes(2)

    d2.resolve()
    await Promise.resolve() // this await the promise of the fn to run its .then/.catch/.finally
  })
  test('updateTimeout should change next wait but not current pending fn run', async () => {
    const d1 = createDeferred()
    const d2 = createDeferred()
    const fn = jest
      .fn()
      .mockImplementationOnce(() => d1.promise)
      .mockImplementationOnce(() => d2.promise)

    const t = new RecurringTimeout(fn, 1000)
    t.start({ runImmediately: true })

    await jest.advanceTimersByTimeAsync(0) // wait for the debounce timeout
    expect(fn).toHaveBeenCalledTimes(1)

    t.updateTimeout({ timeout: 200 }) // update timeout while the fn is in progress

    d1.resolve()
    await Promise.resolve() // this await the promise of the fn to run its .then/.catch/.finally

    await jest.advanceTimersByTimeAsync(199)
    expect(fn).toHaveBeenCalledTimes(1)

    await jest.advanceTimersByTimeAsync(1)
    expect(fn).toHaveBeenCalledTimes(2)

    d2.resolve()
    await Promise.resolve() // this await the promise of the fn to run its .then/.catch/.finally
  })
  test('debounce should collapse multiple start/restart calls within same tick', async () => {
    const d = createDeferred()
    const fn = jest.fn(() => d.promise)
    const t = new RecurringTimeout(fn, 100)

    t.start()
    t.start()
    t.restart()
    t.restart({ runImmediately: true })
    t.restart({ runImmediately: true })

    await jest.advanceTimersByTimeAsync(0) // wait for the debounce timeout

    expect(fn).toHaveBeenCalledTimes(1)

    d.resolve()
    await Promise.resolve() // this await the promise of the fn to run its .then/.catch/.finally
  })
  test('errors should be reported via emitError and should not break the loop', async () => {
    const err = new Error('Recurring task error')
    const fn = jest.fn().mockRejectedValueOnce(err).mockResolvedValueOnce(undefined)

    const emitError = jest.fn()
    const t = new RecurringTimeout(fn, 250, emitError)

    t.start({ runImmediately: true })

    await jest.advanceTimersByTimeAsync(0) // wait for the debounce timeout

    await Promise.resolve() // this await the promise of the fn to run its .then/.catch/.finally

    expect(emitError).toHaveBeenCalledWith(
      expect.objectContaining({ error: err, message: 'Recurring task failed', level: 'minor' })
    )

    // after failure, next run still schedules
    await jest.advanceTimersByTimeAsync(250)
    expect(fn).toHaveBeenCalledTimes(2)
  })
})
