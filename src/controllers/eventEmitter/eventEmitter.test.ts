import { expect, jest } from '@jest/globals'

import { suppressConsole } from '../../../test/helpers/console'
import EventEmitter, { ErrorRef } from './eventEmitter'

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
})
