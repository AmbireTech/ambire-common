import { afterEach, describe, expect, jest, test } from '@jest/globals'

import { setPerfRecorder, startPerfSpan } from './perf'

describe('perf', () => {
  afterEach(() => {
    setPerfRecorder(null)
  })

  test('startPerfSpan is a no-op while no recorder is registered', () => {
    const endSpan = startPerfSpan('nothing')

    expect(() => endSpan()).not.toThrow()
  })

  test('startPerfSpan hands the span to the registered recorder', () => {
    const recorded: string[] = []
    setPerfRecorder({
      startSpan: (name) => {
        recorded.push(`start:${name}`)
        return () => recorded.push(`end:${name}`)
      }
    })

    const endSpan = startPerfSpan('dapps.load.normalize')
    expect(recorded).toEqual(['start:dapps.load.normalize'])

    endSpan()
    expect(recorded).toEqual(['start:dapps.load.normalize', 'end:dapps.load.normalize'])
  })

  test('a recorder that is unregistered records nothing afterwards', () => {
    const startSpan = jest.fn(() => () => {})
    setPerfRecorder({ startSpan })
    setPerfRecorder(null)

    startPerfSpan('after-unregister')()

    expect(startSpan).not.toHaveBeenCalled()
  })
})
