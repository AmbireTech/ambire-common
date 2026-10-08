import { describe, expect, jest, test } from '@jest/globals'

import { IFeatureFlagsController } from '../../interfaces/featureFlags'
import { IUiController } from '../../interfaces/ui'
import { Message } from '../../interfaces/userRequest'
import { AccountOp } from '../../libs/accountOp/accountOp'
import {
  ERC7730_CACHE_TTL_MS,
  ERC7730_MAX_CACHED_DESCRIPTORS
} from '../../libs/humanizer/erc7730/consts'
import { Erc7730Controller } from './erc7730'
import { SAFE_PROXY_V1_4_1_RUNTIME_CODE } from './testDescriptors'

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

const makeUi = (sendUiMessage = jest.fn()): IUiController =>
  ({ message: { sendUiMessage } }) as unknown as IUiController

const makeFeatureFlags = (isClearSigningEnabled = true): IFeatureFlagsController =>
  ({
    initialLoadPromise: undefined,
    isFeatureEnabled: jest.fn(() => isClearSigningEnabled)
  }) as unknown as IFeatureFlagsController

const makeController = (
  storage: any,
  callRelayer: any,
  featureFlags = makeFeatureFlags(),
  providers?: any
) => new Erc7730Controller({ storage, callRelayer, featureFlags, providers, ui: makeUi() })

describe('Erc7730Controller', () => {
  test('does not request account-op descriptors when clear signing is disabled', async () => {
    const callRelayer = makeCallRelayer()
    const controller = makeController(makeStorage(), callRelayer, makeFeatureFlags(false))

    await expect(controller.getDescriptorsForAccountOp(accountOp)).resolves.toEqual({})
    expect(callRelayer).not.toHaveBeenCalled()
  })

  test('does not make relayer or provider requests for messages when clear signing is disabled', async () => {
    const callRelayer = makeCallRelayer()
    const provider = { getStorage: jest.fn() }
    const controller = makeController(makeStorage(), callRelayer, makeFeatureFlags(false), {
      providers: { '1': provider },
      initialLoadPromise: undefined
    })
    const message = {
      content: {
        kind: 'typedMessage',
        types: {},
        domain: { chainId: 1, verifyingContract: CONTRACT_ADDRESS },
        message: {},
        primaryType: 'SafeTx'
      },
      chainId: 1n
    } as Message

    await expect(controller.getDescriptorForMessage(message)).resolves.toBeNull()
    expect(callRelayer).not.toHaveBeenCalled()
    expect(provider.getStorage).not.toHaveBeenCalled()
  })

  test('waits for the persisted clear signing opt-out before making requests', async () => {
    let isClearSigningEnabled = true
    let finishLoading!: () => void
    const initialLoadPromise = new Promise<void>((resolve) => {
      finishLoading = resolve
    })
    const featureFlags = {
      initialLoadPromise,
      isFeatureEnabled: jest.fn(() => isClearSigningEnabled)
    } as unknown as IFeatureFlagsController
    const callRelayer = makeCallRelayer()
    const controller = makeController(makeStorage(), callRelayer, featureFlags)

    const descriptorsPromise = controller.getDescriptorsForAccountOp(accountOp)
    expect(callRelayer).not.toHaveBeenCalled()

    isClearSigningEnabled = false
    finishLoading()

    await expect(descriptorsPromise).resolves.toEqual({})
    expect(callRelayer).not.toHaveBeenCalled()
  })

  test('returns no cached descriptors after clear signing is disabled', async () => {
    let isClearSigningEnabled = true
    const featureFlags = {
      initialLoadPromise: undefined,
      isFeatureEnabled: jest.fn(() => isClearSigningEnabled)
    } as unknown as IFeatureFlagsController
    const callRelayer = makeCallRelayer()
    const controller = makeController(makeStorage(), callRelayer, featureFlags)

    await expect(controller.getDescriptorsForAccountOp(accountOp)).resolves.not.toEqual({})

    isClearSigningEnabled = false
    callRelayer.mockClear()

    await expect(controller.getDescriptorsForAccountOp(accountOp)).resolves.toEqual({})
    expect(callRelayer).not.toHaveBeenCalled()
  })

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

  test('drops the least recently used descriptors once the cache is over its cap', async () => {
    // Without a cap, someone who interacts with many contracts inside one TTL window grows the
    // stored blob without limit, and the whole blob is rewritten on every newly fetched descriptor
    const descriptors: Record<string, any> = {}
    for (let index = 0; index < ERC7730_MAX_CACHED_DESCRIPTORS; index += 1) {
      descriptors[`/registry/test/${index}.json`] = {
        value: { display: { formats: {} } },
        fetchedAt: Date.now()
      }
    }
    const storage = makeStorage({ calldataIndex: null, eip712Index: null, descriptors })
    const controller = makeController(storage, makeCallRelayer())

    await controller.getDescriptorsForAccountOp(accountOp)
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })

    const persisted = storage.store.erc7730RegistryCache.descriptors
    expect(Object.keys(persisted)).toHaveLength(ERC7730_MAX_CACHED_DESCRIPTORS)
    // The one just fetched is kept, the least recently used one is the one that goes
    expect(persisted[`/${REGISTRY_PATH}`]).toBeDefined()
    expect(persisted['/registry/test/0.json']).toBeUndefined()
  })

  test('replies to the UI request with the resolved descriptors', async () => {
    const sendUiMessage = jest.fn()
    const controller = new Erc7730Controller({
      storage: makeStorage(),
      callRelayer: makeCallRelayer() as any,
      featureFlags: makeFeatureFlags(),
      ui: makeUi(sendUiMessage)
    })

    await controller.resolveDescriptorsForAccountOp(accountOp, 'request-1')

    expect(sendUiMessage).toHaveBeenCalledWith({
      requestId: 'request-1',
      ok: true,
      res: expect.any(Object)
    })
  })

  test('replies to the UI request with an empty result when clear signing is disabled', async () => {
    const sendUiMessage = jest.fn()
    const callRelayer = makeCallRelayer()
    const controller = new Erc7730Controller({
      storage: makeStorage(),
      callRelayer,
      featureFlags: makeFeatureFlags(false),
      ui: makeUi(sendUiMessage)
    })

    await controller.resolveDescriptorsForAccountOp(accountOp, 'request-1')

    expect(sendUiMessage).toHaveBeenCalledWith({
      requestId: 'request-1',
      ok: true,
      res: {}
    })
    expect(callRelayer).not.toHaveBeenCalled()
  })

  describe('Safe singleton lookup', () => {
    const PROXY_ADDRESS = '0x2222222222222222222222222222222222222222'
    const LIFI_DIAMOND = '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae'
    const SAFE_SINGLETON = '0x41675c099f32341bf84bfc5382af534df5c7461a'
    const LIFI_PATH = 'registry/lifi/calldata-LIFIDiamond.json'
    const SAFE_PATH = 'registry/safe/calldata-Safe-1.4.1.json'
    // Any contract that is not a SafeProxy, e.g. one deployed to impersonate a registered protocol
    const SPOOF_CODE = '0x6080604052600080fdfea164736f6c6343000818000a'

    const resolveProxyCall = async (code: string, singleton: string) => {
      const callRelayer = jest.fn(async (path: string) => {
        if (path === '/v2/erc7730/account-op') {
          return {
            success: true,
            data: {
              [`eip155:1:${LIFI_DIAMOND}`]: LIFI_PATH,
              [`eip155:1:${SAFE_SINGLETON}`]: SAFE_PATH
            },
            errorState: []
          }
        }

        return {
          success: true,
          display: { formats: { 'test()': { intent: 'Proxy test', fields: [] } } }
        }
      })
      const provider = {
        getCode: jest.fn(async () => code),
        getStorage: jest.fn(async () => `0x000000000000000000000000${singleton.slice(2)}`)
      }
      const controller = makeController(makeStorage(), callRelayer, makeFeatureFlags(), {
        providers: { '1': provider },
        initialLoadPromise: undefined
      })

      const descriptors = await controller.getDescriptorsForAccountOp({
        chainId: 1n,
        calls: [{ to: PROXY_ADDRESS, value: 0n, data: '0x12345678' }]
      } as AccountOp)

      return { descriptors, provider }
    }

    test('does not lend a registered protocol descriptor to a contract pointing at it from slot 0', async () => {
      const { descriptors, provider } = await resolveProxyCall(SPOOF_CODE, LIFI_DIAMOND)

      expect(descriptors).toEqual({})
      expect(provider.getCode).toHaveBeenCalledTimes(1)
    })

    test('does not treat a non-SafeProxy contract as a Safe even if slot 0 holds a Safe singleton', async () => {
      const { descriptors } = await resolveProxyCall(SPOOF_CODE, SAFE_SINGLETON)

      expect(descriptors).toEqual({})
    })

    test('does not follow a SafeProxy to a singleton that is not a known Safe', async () => {
      const { descriptors } = await resolveProxyCall(SAFE_PROXY_V1_4_1_RUNTIME_CODE, LIFI_DIAMOND)

      expect(descriptors).toEqual({})
    })

    test('follows a SafeProxy to a known Safe singleton', async () => {
      const { descriptors } = await resolveProxyCall(SAFE_PROXY_V1_4_1_RUNTIME_CODE, SAFE_SINGLETON)

      expect(descriptors[0]?.path).toBe(SAFE_PATH)
    })
  })
})
