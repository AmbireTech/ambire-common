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

    expect(newError.message).toContain('Invictus RPC error')
    expect(newError.message).toContain('Original error message')
    expect(newError.code).toBe('SOME_ERROR_CODE')
    expect(newError.statusCode).toBe(500)
    // @ts-ignore
    expect(newError.info).toEqual({ detail: 'Some additional info' })
    expect(newError.isProviderInvictus).toBe(true)
  })
  it('Invictus 2XX errors have a specific message prefix', () => {
    const error = new Error('Doomsday') as Error & { [key: string]: any }
    error.response = { statusCode: 200 }

    const providerError = new ProviderError({
      originalError: error,
      providerUrl: 'https://invictus.ambire.com/ethereum'
    })

    expect(providerError.message).toContain('Invictus RPC error (2XX)')
    expect(providerError.message).toContain('Doomsday')
    expect(providerError.isProviderInvictus).toBe(true)
  })
  it('Invictus non-2XX errors have a specific message prefix', () => {
    const error = new Error('Doomsday') as Error & { [key: string]: any }
    error.response = { statusCode: 500 }

    const providerError = new ProviderError({
      originalError: error,
      providerUrl: 'https://invictus.ambire.com/ethereum'
    })

    expect(providerError.message).toContain('Invictus RPC error')
    expect(providerError.message).toContain('Doomsday')
    expect(providerError.isProviderInvictus).toBe(true)
  })
  it('rpc-timeout errors are not prefixed with Invictus message', () => {
    const error = new Error('rpc-timeout. Rpc: https://invictus.ambire.com/ethereum') as Error & {
      [key: string]: any
    }

    const providerError = new ProviderError({
      originalError: error,
      providerUrl: 'https://invictus.ambire.com/ethereum'
    })

    expect(providerError.message).toBe('rpc-timeout. Rpc: https://invictus.ambire.com/ethereum')
    expect(providerError.isProviderInvictus).toBe(true)
  })
})
