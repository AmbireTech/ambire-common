import { expect, jest } from '@jest/globals'

import { suppressConsole, suppressConsoleBeforeEach } from '../../../test/helpers/console'
import { ErrorRef } from '../../interfaces/eventEmitter'
import EventEmitter from './eventEmitter'

describe('EventEmitter', () => {
  let eventEmitter: EventEmitter

  beforeEach(() => {
    eventEmitter = new EventEmitter()
  })

  it('should unsubscribe from update events', async () => {
    const mockCallback = jest.fn()
    let unsubscribe = eventEmitter.onUpdate(mockCallback)

    await eventEmitter.forceEmitUpdate()
    await eventEmitter.forceEmitUpdate()
    await eventEmitter.forceEmitUpdate()

    expect(mockCallback).toHaveBeenCalledTimes(3)
    // `callbacks` is private, change to public if you want to test it
    // expect(eventEmitter.callbacks.length).toBe(1)

    unsubscribe()

    await eventEmitter.forceEmitUpdate()
    // Count should remain 3, indicating the callback was not called again
    expect(mockCallback).toHaveBeenCalledTimes(3)
    // `callbacks` is private, change to public if you want to test it
    // expect(eventEmitter.callbacks.length).toBe(0)

    const mockCallback2 = jest.fn()
    unsubscribe = eventEmitter.onUpdate(mockCallback2)
    await eventEmitter.forceEmitUpdate()
    await eventEmitter.forceEmitUpdate()
    await eventEmitter.forceEmitUpdate()
    await eventEmitter.forceEmitUpdate()

    expect(mockCallback2).toHaveBeenCalledTimes(4)

    unsubscribe()
    await eventEmitter.forceEmitUpdate()
    expect(mockCallback2).toHaveBeenCalledTimes(4)
    // `callbacks` is private, change to public if you want to test it
    // expect(eventEmitter.callbacks.length).toBe(0)
  })

  it('should unsubscribe from error events', () => {
    const consoleSuppressor = suppressConsole()

    const mockErrorCallback = jest.fn()
    const unsubscribe = eventEmitter.onError(mockErrorCallback)

    const sampleError: ErrorRef = {
      message: 'Something went wrong',
      level: 'major',
      error: new Error('Sample error')
    }

    // Trigger an error.
    // Using 'as any' to access protected method for testing
    ;(eventEmitter as any).emitError(sampleError)
    ;(eventEmitter as any).emitError(sampleError)

    expect(mockErrorCallback).toHaveBeenCalledWith(sampleError)
    expect(mockErrorCallback).toHaveBeenCalledTimes(2)

    unsubscribe()

    // Trigger another error
    ;(eventEmitter as any).emitError(sampleError)
    // Count should remain 2, indicating the callback was not called again
    expect(mockErrorCallback).toHaveBeenCalledTimes(2)

    consoleSuppressor.restore()
  })
  it('should not execute callbacks after destroy', () => {
    const { restore } = suppressConsole()
    const emitter = new EventEmitter()
    const mockCallback = jest.fn()
    const mockErrorCallback = jest.fn()

    emitter.onUpdate(mockCallback)
    emitter.onError(mockErrorCallback)

    // Verify they work before destroy
    // @ts-expect-error
    emitter.emitUpdate()
    expect(mockCallback).toHaveBeenCalledTimes(1)

    // Destroying the EventEmitter should remove all callbacks
    emitter.destroy()

    // Try to emit again
    // @ts-expect-error
    emitter.emitUpdate()
    // @ts-expect-error
    emitter.emitError({ level: 'minor', message: 'test', error: new Error() })

    // Should not have been called again
    expect(mockCallback).toHaveBeenCalledTimes(1)
    expect(mockErrorCallback).not.toHaveBeenCalled()
    restore()
  })
  describe('throttled emitUpdate', () => {
    const THROTTLE_MS = 100

    beforeEach(() => {
      jest.useFakeTimers()
    })

    afterEach(() => {
      jest.clearAllTimers()
      jest.useRealTimers()
    })

    const emit = (options?: { throttleMs?: number }) =>
      // Accessing the protected method for testing
      (eventEmitter as any).emitUpdate(options)

    it('should emit immediately on the leading edge', () => {
      const cb = jest.fn()
      eventEmitter.onUpdate(cb)

      emit({ throttleMs: THROTTLE_MS })

      expect(cb).toHaveBeenCalledTimes(1)
    })

    it('should coalesce multiple throttled emits within the window into one trailing emit', () => {
      const cb = jest.fn()
      eventEmitter.onUpdate(cb)

      emit({ throttleMs: THROTTLE_MS }) // leading -> 1
      emit({ throttleMs: THROTTLE_MS })
      emit({ throttleMs: THROTTLE_MS })
      expect(cb).toHaveBeenCalledTimes(1)

      jest.advanceTimersByTime(THROTTLE_MS) // trailing -> 2
      expect(cb).toHaveBeenCalledTimes(2)

      // Window is reopened after a trailing emit; with nothing pending it must
      // not fire again and must release the timer.
      jest.advanceTimersByTime(THROTTLE_MS)
      expect(cb).toHaveBeenCalledTimes(2)
    })

    it('should keep throttling a continuous stream to one emit per window', () => {
      const cb = jest.fn()
      eventEmitter.onUpdate(cb)

      emit({ throttleMs: THROTTLE_MS }) // leading -> 1
      emit({ throttleMs: THROTTLE_MS })
      jest.advanceTimersByTime(THROTTLE_MS) // trailing -> 2

      emit({ throttleMs: THROTTLE_MS })
      jest.advanceTimersByTime(THROTTLE_MS) // trailing -> 3

      expect(cb).toHaveBeenCalledTimes(3)
    })

    it('should flush a pending throttled emit immediately on a plain emitUpdate', () => {
      const cb = jest.fn()
      eventEmitter.onUpdate(cb)

      emit({ throttleMs: THROTTLE_MS }) // leading -> 1
      emit({ throttleMs: THROTTLE_MS }) // pending trailing

      emit() // plain emit supersedes the pending trailing -> 2
      expect(cb).toHaveBeenCalledTimes(2)

      // The superseded trailing emit must not fire afterwards
      jest.advanceTimersByTime(THROTTLE_MS)
      expect(cb).toHaveBeenCalledTimes(2)
    })

    it('should cancel a pending throttled emit on forceEmitUpdate', async () => {
      const cb = jest.fn()
      eventEmitter.onUpdate(cb)

      emit({ throttleMs: THROTTLE_MS }) // leading -> 1
      emit({ throttleMs: THROTTLE_MS }) // pending trailing

      const forced = eventEmitter.forceEmitUpdate()
      await jest.advanceTimersByTimeAsync(1) // forceEmitUpdate awaits wait(1)
      await forced
      expect(cb).toHaveBeenCalledTimes(2)

      jest.advanceTimersByTime(THROTTLE_MS)
      expect(cb).toHaveBeenCalledTimes(2)
    })

    it('should not fire a pending throttled emit after destroy', () => {
      const cb = jest.fn()
      eventEmitter.onUpdate(cb)

      emit({ throttleMs: THROTTLE_MS }) // leading -> 1
      emit({ throttleMs: THROTTLE_MS }) // pending trailing

      eventEmitter.destroy()

      jest.advanceTimersByTime(THROTTLE_MS)
      expect(cb).toHaveBeenCalledTimes(1)
    })
  })

  describe('EventEmitter memory leak with nested controllers', () => {
    suppressConsoleBeforeEach()
    const externalClosure = {}
    it('should leak memory when sub-controller is nullified without destroy()', () => {
      // Simulate a callback that captures the controller in its closure
      function addCallbackThatCapturesController(ctrl: EventEmitter) {
        ctrl.onError(() => {
          console.log('Error in controller:', ctrl, externalClosure)
        }, 'background')
      }

      // Create a controller and add a callback
      let controller = new EventEmitter()
      addCallbackThatCapturesController(controller)

      // Keep a reference to verify the leak
      const oldController = controller

      // Wrong: Nullify without calling destroy()
      controller = null as any

      // The problem: Old controller still has the callback
      // This creates a circular reference: EventEmitter -> callback -> closure(ctrl) -> EventEmitter
      expect(oldController.onErrorIds).toContain('background')

      // The callback can still be executed, proving the old controller is kept alive
      const mockCallback = jest.fn()
      oldController.onError(mockCallback, 'test')
      // @ts-expect-error
      oldController.emitError({
        level: 'minor',
        message: 'test error',
        error: new Error('test')
      })
      expect(mockCallback).toHaveBeenCalled()
    })

    it('should NOT leak memory when destroy() is called before nullifying', () => {
      // Simulate a callback that captures the controller in its closure
      function addCallbackThatCapturesController(ctrl: EventEmitter) {
        ctrl.onError(() => {
          console.log('Error in controller:', ctrl, externalClosure)
        }, 'background')
      }

      // Create a controller and add a callback
      let controller = new EventEmitter()
      addCallbackThatCapturesController(controller)

      // Keep a reference to verify no leak
      const oldController = controller

      // Correct: Call destroy() before nullifying
      controller.destroy()
      controller = null as any

      // Verify the fix: Old controller has no callbacks
      // The old 'background' callback is gone, breaking the circular reference
      // The old controller can now be garbage collected
      expect(oldController.onErrorIds).toHaveLength(0)
    })
  })
})
