import { describe, expect, jest, test } from '@jest/globals'

import { AccountOp } from '../../libs/accountOp/accountOp'
import { ERC7730_CACHE_TTL_MS } from '../../libs/humanizer/erc7730/consts'
import { Erc7730Controller } from './erc7730'

const CONTRACT_ADDRESS = '0x1111111111111111111111111111111111111111'
const REGISTRY_PATH = 'registry/test/controller.json'

const makeStorage = (initial?: any) => {
  const store: Record<string, any> = initial ? { erc7730RegistryCache: initial } : {}

  return {
    get: jest.fn(async (key: string, defaultValue?: any) =>
      key in store ? store[key] : defaultValue
    ),
    set: jest.fn(async (key: string, value: any) => {
      store[key] = value
    }),
    store
  } as any
}

const makeCallRelayer = () =>
  jest.fn(async (path: string) => {
    if (path === '/v2/erc7730/account-op') {
      return {
        success: true,
        data: { [`eip155:1:${CONTRACT_ADDRESS}`]: REGISTRY_PATH },
        errorState: []
      }
    }

    return {
      success: true,
      display: { formats: { 'test()': { intent: 'Controller test', fields: [] } } }
    }
  })

const accountOp = {
  chainId: 1n,
  calls: [{ to: CONTRACT_ADDRESS, value: 0n, data: '0x12345678' }]
} as AccountOp

const makeController = (storage: any, callRelayer: any) =>
  new Erc7730Controller({ storage, callRelayer, sendUiMessage: jest.fn() })

describe('Erc7730Controller', () => {
  test('persists the fetched descriptors as a full snapshot', async () => {
    const storage = makeStorage()
    const controller = makeController(storage, makeCallRelayer())

    await controller.getDescriptorsForAccountOp(accountOp)
    // The write is fire-and-forget, so let the queued persist settle
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })

    const persisted = storage.store.erc7730RegistryCache
    expect(persisted.calldataIndex.value).toEqual({
      [`eip155:1:${CONTRACT_ADDRESS}`]: REGISTRY_PATH
    })
    expect(Object.keys(persisted.descriptors)).toEqual([`/${REGISTRY_PATH}`])
    // A full snapshot write, never a read-modify-write of the stored value, so two concurrent
    // fetches can't drop each other's entries.
    expect(storage.set).toHaveBeenCalledWith('erc7730RegistryCache', expect.any(Object))
  })

  test('serves a persisted descriptor without calling the relayer after a restart', async () => {
    const storage = makeStorage()
    await makeController(storage, makeCallRelayer()).getDescriptorsForAccountOp(accountOp)
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })

    // Simulate a service worker restart: a new controller starts with an empty in-memory cache,
    // storage survives.
    const callRelayer = makeCallRelayer()
    const descriptors = await makeController(storage, callRelayer).getDescriptorsForAccountOp(
      accountOp
    )

    expect(Object.keys(descriptors)).toHaveLength(1)
    expect(callRelayer).not.toHaveBeenCalled()
  })

  test('does not rewrite storage when everything was served from cache', async () => {
    const storage = makeStorage()
    const controller = makeController(storage, makeCallRelayer())

    await controller.getDescriptorsForAccountOp(accountOp)
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
    const writesAfterFirstFetch = storage.set.mock.calls.length

    await controller.getDescriptorsForAccountOp(accountOp)
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })

    expect(storage.set.mock.calls.length).toBe(writesAfterFirstFetch)
  })

  test('collapses the concurrent lookups of one accountOp into a single request', async () => {
    // The guard behind this: nothing may await between finding no in-flight request and storing
    // one. Every call of an accountOp asks for the same shared index, all at once.
    const callRelayer = makeCallRelayer()
    const controller = makeController(makeStorage(), callRelayer)
    const call = { to: CONTRACT_ADDRESS, value: 0n, data: '0x12345678' }

    await controller.getDescriptorsForAccountOp({
      chainId: 1n,
      calls: [call, call, call, call, call, call, call, call, call, call]
    } as AccountOp)

    expect(
      callRelayer.mock.calls.filter(([path]) => path === '/v2/erc7730/account-op')
    ).toHaveLength(1)
    expect(
      callRelayer.mock.calls.filter(([path]) => path === '/v2/erc7730/fetch-descriptor')
    ).toHaveLength(1)
  })

  test('prunes persisted entries past their TTL the next time it writes', async () => {
    const storage = makeStorage({
      calldataIndex: {
        value: { [`eip155:1:${CONTRACT_ADDRESS}`]: REGISTRY_PATH },
        fetchedAt: Date.now()
      },
      eip712Index: null,
      descriptors: {
        '/registry/test/expired.json': {
          value: { display: { formats: {} } },
          fetchedAt: Date.now() - ERC7730_CACHE_TTL_MS - 1
        }
      }
    })
    const callRelayer = makeCallRelayer()
    const controller = makeController(storage, callRelayer)

    await controller.getDescriptorsForAccountOp(accountOp)
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })

    // The index was fresh in storage, so only the descriptor behind it had to be fetched
    expect(
      callRelayer.mock.calls.filter(([path]) => path === '/v2/erc7730/account-op')
    ).toHaveLength(0)
    // That fetch triggers a write, and the expired entry is not carried into it - which is what
    // stops the stored blob from growing without bound
    expect(Object.keys(storage.store.erc7730RegistryCache.descriptors)).toEqual([
      `/${REGISTRY_PATH}`
    ])
  })

  test('replies to the UI request with the resolved descriptors', async () => {
    const sendUiMessage = jest.fn()
    const controller = new Erc7730Controller({
      storage: makeStorage(),
      callRelayer: makeCallRelayer() as any,
      sendUiMessage
    })

    await controller.resolveDescriptorsForAccountOp(accountOp, 'request-1')

    expect(sendUiMessage).toHaveBeenCalledWith({
      requestId: 'request-1',
      ok: true,
      res: expect.any(Object)
    })
  })
})
