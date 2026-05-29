import { expect, jest } from '@jest/globals'

import { suppressConsole, suppressConsoleBeforeEach } from '../../../test/helpers/console'
import { ErrorRef } from '../../interfaces/eventEmitter'
import EventEmitter from './eventEmitter'

describe('EventEmitter', () => {
  let eventEmitter: EventEmitter

  beforeEach(() => {
    eventEmitter = new EventEmitter()
  })

  it('should unsubscribe from update events', () => {
    const mockCallback = jest.fn()
    let unsubscribe = eventEmitter.onUpdate(mockCallback)

    // Trigger an update.
    // Using 'as any' to access protected method for testing
    ;(eventEmitter as any).emitUpdate()
    ;(eventEmitter as any).emitUpdate()
    ;(eventEmitter as any).emitUpdate()

    expect(mockCallback).toHaveBeenCalledTimes(3)
    // `callbacks` is private, change to public if you want to test it
    // expect(eventEmitter.callbacks.length).toBe(1)

    unsubscribe()

    // Trigger another update
    ;(eventEmitter as any).emitUpdate()
    // Count should remain 3, indicating the callback was not called again
    expect(mockCallback).toHaveBeenCalledTimes(3)
    // `callbacks` is private, change to public if you want to test it
    // expect(eventEmitter.callbacks.length).toBe(0)

    const mockCallback2 = jest.fn()
    unsubscribe = eventEmitter.onUpdate(mockCallback2)
    ;(eventEmitter as any).emitUpdate()
    ;(eventEmitter as any).emitUpdate()
    ;(eventEmitter as any).emitUpdate()
    ;(eventEmitter as any).emitUpdate()

    expect(mockCallback2).toHaveBeenCalledTimes(4)

    unsubscribe()
    ;(eventEmitter as any).emitUpdate()
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
    // @ts-ignore
    emitter.emitUpdate()
    expect(mockCallback).toHaveBeenCalledTimes(1)

    // Destroying the EventEmitter should remove all callbacks
    emitter.destroy()

    // Try to emit again
    // @ts-ignore
    emitter.emitUpdate()
    // @ts-ignore
    emitter.emitError({ level: 'minor', message: 'test', error: new Error() })

    // Should not have been called again
    expect(mockCallback).toHaveBeenCalledTimes(1)
    expect(mockErrorCallback).not.toHaveBeenCalled()
    restore()
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
      // @ts-ignore
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
