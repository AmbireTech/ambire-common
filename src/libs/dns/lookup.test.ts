import { describe, expect, jest, test } from '@jest/globals'

import lookup from './lookup'

describe('Lookup', () => {
  beforeEach(() => {
    // Don't spam the console with logs
    console.info = jest.fn()
  })
  test('should generated a valid lookup to a DNS address that has DNS SEC', async () => {
    const res = await lookup('Google', 'Ambire.com')
    expect(res).toHaveProperty('answer')
  })
  test('should return null for a domain the does not have a SignedSet', async () => {
    const res = await lookup('20221208', 'gmail.com')
    expect(res).toEqual(null)
  })
  test('should throw an error if the domain itself cannot be found', async () => {
    expect.assertions(1)
    try {
      const res = await lookup('20221208', 'sahdaksdashdua.com')
    } catch (e: any) {
      expect(e.message).toEqual('DNS server responded with NXDOMAIN')
    }
  })
})
