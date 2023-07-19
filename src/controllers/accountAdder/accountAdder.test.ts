import { JsonRpcProvider } from 'ethers'

/* eslint-disable no-new */
import { describe, expect, test } from '@jest/globals'

import { networks } from '../../consts/networks'
import { Storage } from '../../interfaces/storage'
import { KeyIterator } from '../../libs/keyIterator/keyIterator'
import { AccountAdder } from './accountAdder'

const seedPhrase =
  'brisk rich glide impose category stuff company you appear remain decorate monkey'
const privKey = '0x574f261b776b26b1ad75a991173d0e8ca2ca1d481bd7822b2b58b2ef8a969f12'
const keyPublicAddress = '0x9188fdd757Df66B4F693D624Ed6A13a15Cf717D7'

const providers = Object.fromEntries(
  networks.map((network) => [network.id, new JsonRpcProvider(network.rpcUrl)])
)
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
  test('should throw not initialized', async () => {
    expect.assertions(1)
    try {
      const accountAdder = new AccountAdder(produceMemoryStore())
      await accountAdder.getPage({ page: 1, networks, providers })
    } catch (e) {
      expect(e.message).toBe('accountAdder: keyIterator not initialized')
    }
  })
  test('should init keyIterator', () => {
    expect.assertions(2)
    const accountAdder = new AccountAdder(produceMemoryStore())
    const keyIterator = new KeyIterator(seedPhrase)
    accountAdder.init({ _keyIterator: keyIterator, _preselectedAccounts: [] })

    expect((accountAdder as any)['#keyIterator']).toBe(undefined)
    expect((accountAdder as any).isReady).toBeTruthy()
  })
})
