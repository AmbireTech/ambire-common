import { expect, jest } from '@jest/globals'

import { HumanizerFragment } from '../../interfaces/humanizer'
// import { parse, stringify } from '../richJson/richJson'
import { stringify } from '../richJson/richJson'
import { addFragsToLazyStore, lazyReadHumanizerMeta } from './lazyStorage'
import { EMPTY_HUMANIZER_META, HUMANIZER_META_KEY } from './utils'

const frag: HumanizerFragment = {
  type: 'selector',
  key: '0x00000000',
  isGlobal: true,
  value: { signature: 'watafak', selector: '0x00000000' }
}
let storage: any
describe('lazy storage', () => {
  beforeEach(async () => {
    const produceCustomStorage = () => {
      const storage2: { [key: string]: any } = {}

      return {
        get: jest.fn((key: string, defaultValue: any): any => {
          const serialized = storage2[key]
          return Promise.resolve(serialized || defaultValue)
        }),
        set: jest.fn((key: string, value: any) => {
          storage2[key] = value
          return Promise.resolve(null)
        })
      }
    }
    storage = produceCustomStorage()
    await storage.set(HUMANIZER_META_KEY, EMPTY_HUMANIZER_META)
  })
  test('mock storage', async () => {
    const initialWriteCount = storage.set.mock.calls.length
    expect(storage.set).toHaveBeenCalledTimes(initialWriteCount + 0)
    await storage.set('a', 'value1')
    await storage.set('b', 'value2')
    expect(storage.set).toHaveBeenCalledTimes(initialWriteCount + 2)
    expect(await storage.get('a')).toEqual('value1')
    expect(await storage.get('b')).toEqual('value2')
    expect(storage.set).toHaveBeenCalledTimes(initialWriteCount + 2)
  })
  test('simple momory storing with caching', async () => {
    await addFragsToLazyStore(storage, [frag])
    const humanizerMeta = await lazyReadHumanizerMeta(storage)
    const expectedMeta = {
      abis: { NO_ABI: { '0x00000000': { signature: 'watafak', selector: '0x00000000' } } },
      knownAddresses: {}
    }
    expect(stringify(humanizerMeta)).toEqual(stringify(expectedMeta))
  })

  test('consisntency between storage and return values', async () => {
    await addFragsToLazyStore(storage, [frag])
    let hm = await lazyReadHumanizerMeta(storage)
    // storage is lagging behind
    expect(stringify(await storage.get(HUMANIZER_META_KEY))).toEqual(
      stringify(EMPTY_HUMANIZER_META)
    )
    // updating the stroage
    await addFragsToLazyStore(storage, [frag], { urgent: true })
    hm = await lazyReadHumanizerMeta(storage)
    const expectedMeta = {
      abis: { NO_ABI: { '0x00000000': { signature: 'watafak', selector: '0x00000000' } } },
      knownAddresses: {}
    }
    expect(stringify(hm)).toEqual(stringify(expectedMeta))
  })
  test('cache and not call set/get ', async () => {
    const initialReadCount = storage.get.mock.calls.length
    const initialWriteCount = storage.set.mock.calls.length
    await lazyReadHumanizerMeta(storage)
    expect(storage.get.mock.calls.length).toEqual(initialReadCount)
    await lazyReadHumanizerMeta(storage, { nocache: true })
    expect(storage.get.mock.calls.length).toEqual(initialReadCount + 1)
    expect(storage.set.mock.calls.length).toEqual(initialWriteCount)

    await addFragsToLazyStore(storage, [frag])
    expect(storage.set.mock.calls.length).toEqual(initialWriteCount + 1)

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    addFragsToLazyStore(storage, [frag], { urgent: true })
    expect(storage.set.mock.calls.length).toEqual(initialWriteCount + 2)

    // if this fails, it is running the func slower that specified time
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    addFragsToLazyStore(storage, [frag])
    expect(storage.set.mock.calls.length).toEqual(initialWriteCount + 2)
  })
})
