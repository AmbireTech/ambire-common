/* eslint-disable no-new */
import { describe, expect, test } from '@jest/globals'

import { Storage } from '../../interfaces/storage'
import { AccountAdder } from './accountAdder'

const seedPhrase =
  'brisk rich glide impose category stuff company you appear remain decorate monkey'
const privKey = '0x574f261b776b26b1ad75a991173d0e8ca2ca1d481bd7822b2b58b2ef8a969f12'
const keyPublicAddress = '0x9188fdd757Df66B4F693D624Ed6A13a15Cf717D7'

// Helpers/testing
function produceMemoryStore(): Storage {
  const storage = new Map()
  return {
    get: (key, defaultValue): any => {
      const serialized = storage.get(key)
      return Promise.resolve(serialized ? JSON.parse(serialized) : defaultValue)
    },
    set: (key, value) => {
      storage.set(key, JSON.stringify(value))
      return Promise.resolve(null)
    }
  }
}

describe('AccountAdder', () => {
  test('should initialize accountAdder', () => {
    expect.assertions(3)
    const accountAdder = new AccountAdder(produceMemoryStore())
    expect((accountAdder as any)['#keyIterator']).toBe(undefined)
    expect((accountAdder as any).derivationPath).toBe(undefined)
    expect((accountAdder as any).page).toEqual(1)
  })
})
