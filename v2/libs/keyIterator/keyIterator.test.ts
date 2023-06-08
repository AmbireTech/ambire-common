/* eslint-disable no-new */
import { describe, expect, test } from '@jest/globals'

import { KeyIterator } from './keyIterator'

const seedPhrase =
  'brisk rich glide impose category stuff company you appear remain decorate monkey'
const privKey = '0x574f261b776b26b1ad75a991173d0e8ca2ca1d481bd7822b2b58b2ef8a969f12'
const keyPublicAddress = '0x9188fdd757Df66B4F693D624Ed6A13a15Cf717D7'

describe('KeyIterator', () => {
  test('should initialize keyIterator', () => {
    expect.assertions(2)
    const keyIteratorWithPrivKey = new KeyIterator(privKey)
    expect((keyIteratorWithPrivKey as any)['#privateKey']).toBe(undefined)
    expect((keyIteratorWithPrivKey as any)['#seedPhrase']).toBe(undefined)
  })
  test('should fail initializing keyIterator', async () => {
    expect.assertions(1)
    try {
      new KeyIterator(`${seedPhrase}invalid-seed-phrase`)
    } catch (e) {
      expect(e.message).toBe('keyIterator: invalid argument provided to constructor')
    }
  })
  test('should retrieve a single key', async () => {
    expect.assertions(2)
    const keyIteratorWithPrivKey = new KeyIterator(privKey)
    const keys = await keyIteratorWithPrivKey.retrieve(0, 9, "m/44'/60'/0'")
    expect(keys).toHaveLength(1)
    expect(keys?.[0]).toEqual(keyPublicAddress)
  })
  test('should retrieve first 10 keys', async () => {
    expect.assertions(2)
    const keyIteratorWithPrivKey = new KeyIterator(seedPhrase)
    const keys = await keyIteratorWithPrivKey.retrieve(0, 9, "m/44'/60'/0'")
    expect(keys).toHaveLength(10)
    expect(keys?.[0]).toEqual(keyPublicAddress)
  })
  test('should fail retrieving', async () => {
    expect.assertions(1)
    try {
      const keyIteratorWithPrivKey = new KeyIterator(privKey)
      await keyIteratorWithPrivKey.retrieve(0, 9, '')
    } catch (e) {
      expect(e.message).toBe('keyIterator: invalid or missing arguments')
    }
  })
})
