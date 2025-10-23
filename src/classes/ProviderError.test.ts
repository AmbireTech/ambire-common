import { ProviderError } from './ProviderError'

describe('ProviderError', () => {
  it('All properties from the old error object are passed to ProviderError', () => {
    const oldError = new Error('Original error message') as Error & { [key: string]: any }
    oldError.code = 'SOME_ERROR_CODE'
    oldError.response = { statusCode: 500 }
    oldError.info = { detail: 'Some additional info' }

    const newError = new ProviderError({
      originalError: oldError,
      providerUrl: 'https://invictus.ambire.com/ethereum'
    })

    expect(newError.message).toContain('Original error message')
    expect(newError.code).toBe('SOME_ERROR_CODE')
    expect(newError.statusCode).toBe(500)
    // @ts-ignore
    expect(newError.info).toEqual({ detail: 'Some additional info' })
    expect(newError.isProviderInvictus).toBe(true)
    expect(newError.providerUrl).toBe('https://invictus.ambire.com/ethereum')
  })
})
