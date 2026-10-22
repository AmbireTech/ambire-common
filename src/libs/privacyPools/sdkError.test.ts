import { expect } from '@jest/globals'

import { toPrivacyPoolsSdkError } from './sdkError'

const FALLBACK = 'privacyPools: withdrawal failed'

describe('toPrivacyPoolsSdkError', () => {
  it('returns an Error as it is', () => {
    const error = new TypeError('fetch failed')

    expect(toPrivacyPoolsSdkError(error, FALLBACK)).toBe(error)
  })

  it('keeps the message, name and stack of a failure rethrown from a thunk', () => {
    const serialized = {
      name: 'Error',
      message: 'No note with sufficient balance for withdrawal',
      stack: 'Error: No note with sufficient balance for withdrawal\n    at withdrawThunk'
    }

    const error = toPrivacyPoolsSdkError(serialized, FALLBACK)

    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe(serialized.message)
    expect(error.name).toBe('Error')
    expect(error.stack).toBe(serialized.stack)
    expect(error.cause).toBe(serialized)
  })

  it('falls back for something that carries no message', () => {
    expect(toPrivacyPoolsSdkError(undefined, FALLBACK).message).toBe(FALLBACK)
    expect(toPrivacyPoolsSdkError('oops', FALLBACK).message).toBe(FALLBACK)
    expect(toPrivacyPoolsSdkError({ message: 42 }, FALLBACK).message).toBe(FALLBACK)
    expect(toPrivacyPoolsSdkError({ message: '' }, FALLBACK).message).toBe(FALLBACK)
  })

  it('keeps what it could not read as the cause', () => {
    const thrown = { code: 'UNKNOWN' }

    expect(toPrivacyPoolsSdkError(thrown, FALLBACK).cause).toBe(thrown)
  })
})
