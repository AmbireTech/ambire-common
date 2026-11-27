import { describe, expect, jest, test } from '@jest/globals'

import { declareSupportedSchema } from '../../../test/mocks/erc7730Registry'
import { IUiController } from '../../interfaces/ui'
import { Message } from '../../interfaces/userRequest'
import { AccountOp } from '../../libs/accountOp/accountOp'
import { Erc7730Registry } from '../../libs/humanizer/erc7730/types'
import { Erc7730Controller } from './erc7730'
import { SAFE_PROXY_V1_4_1_RUNTIME_CODE } from './testDescriptors'

const CONTRACT_ADDRESS = '0x1111111111111111111111111111111111111111'
const VERIFYING_CONTRACT = '0x3333333333333333333333333333333333333333'
const REGISTRY_PATH = 'registry/test/controller.json'
const INCLUDED_PATH = 'registry/test/common.json'
const EIP712_PATH = 'registry/test/eip712.json'

const CONTRACT_DESCRIPTOR = {
  display: { formats: { 'test()': { intent: 'Controller test', fields: [] } } }
}

const makeRegistry = (overrides: Partial<Erc7730Registry> = {}): Erc7730Registry => ({
  calldataIndex: { [`eip155:1:${CONTRACT_ADDRESS}`]: REGISTRY_PATH },
  eip712Index: {},
  descriptors: { [REGISTRY_PATH]: CONTRACT_DESCRIPTOR },
  ...overrides
})

const accountOp = {
  chainId: 1n,
  calls: [{ to: CONTRACT_ADDRESS, value: 0n, data: '0x12345678' }]
} as AccountOp

const makeUi = (sendUiMessage = jest.fn()): IUiController =>
  ({ message: { sendUiMessage } }) as unknown as IUiController

const makeController = (registry: Erc7730Registry, providers?: any) =>
  new Erc7730Controller({
    registry: declareSupportedSchema(registry),
    providers,
    ui: makeUi()
  })

describe('Erc7730Controller', () => {
  test('describes a call with the descriptor the registry has for its contract', async () => {
    const controller = makeController(makeRegistry())

    const descriptors = await controller.getDescriptorsForAccountOp(accountOp)

    expect(descriptors[0]?.path).toBe(REGISTRY_PATH)
    expect(descriptors[0]?.descriptor.display?.formats?.['test()']?.intent).toBe('Controller test')
    expect(controller.emittedErrors).toEqual([])
  })

  test('returns no descriptor for a contract the registry does not have', async () => {
    const controller = makeController(makeRegistry({ calldataIndex: {} }))

    await expect(controller.getDescriptorsForAccountOp(accountOp)).resolves.toEqual({})
    expect(controller.emittedErrors).toEqual([])
  })

  test('merges the descriptors a descriptor includes', async () => {
    const controller = makeController(
      makeRegistry({
        descriptors: {
          [REGISTRY_PATH]: { ...CONTRACT_DESCRIPTOR, includes: INCLUDED_PATH },
          [INCLUDED_PATH]: { metadata: { owner: 'Included owner' } }
        }
      })
    )

    const descriptors = await controller.getDescriptorsForAccountOp(accountOp)

    expect(descriptors[0]?.descriptor.metadata?.owner).toBe('Included owner')
    expect(descriptors[0]?.descriptor.display?.formats?.['test()']?.intent).toBe('Controller test')
  })

  describe('includes', () => {
    /** A registry whose descriptor includes a chain of `levels` descriptors */
    const withIncludeChain = (levels: number) => {
      const descriptors: Erc7730Registry['descriptors'] = {
        [REGISTRY_PATH]: { ...CONTRACT_DESCRIPTOR, includes: 'registry/test/level-1.json' }
      }
      for (let level = 1; level <= levels; level += 1) {
        descriptors[`registry/test/level-${level}.json`] =
          level < levels
            ? { includes: `registry/test/level-${level + 1}.json` }
            : { metadata: { owner: 'Deepest include' } }
      }
      return makeRegistry({ descriptors })
    }

    test.each([1, 4, 5, 8])('merges a chain of %i includes', async (levels) => {
      const controller = makeController(withIncludeChain(levels))

      const descriptors = await controller.getDescriptorsForAccountOp(accountOp)

      expect(descriptors[0]?.descriptor.metadata?.owner).toBe('Deepest include')
      expect(descriptors[0]?.descriptor.display?.formats?.['test()']?.intent).toBe(
        'Controller test'
      )
      expect(controller.emittedErrors).toEqual([])
    })

    test('merges includes that loop, each once', async () => {
      const controller = makeController(
        makeRegistry({
          descriptors: {
            [REGISTRY_PATH]: { ...CONTRACT_DESCRIPTOR, includes: INCLUDED_PATH },
            [INCLUDED_PATH]: { includes: REGISTRY_PATH, metadata: { owner: 'Included owner' } }
          }
        })
      )

      const descriptors = await controller.getDescriptorsForAccountOp(accountOp)

      expect(descriptors[0]?.descriptor.metadata?.owner).toBe('Included owner')
      expect(controller.emittedErrors).toEqual([])
    })
  })

  describe('versions of ERC-7730', () => {
    // These build the controller directly, so that no schema is declared for them
    const describeCall = async (descriptors: Erc7730Registry['descriptors']) => {
      const controller = new Erc7730Controller({
        registry: makeRegistry({ descriptors }),
        ui: makeUi()
      })
      const found = await controller.getDescriptorsForAccountOp(accountOp)

      return { found, errors: controller.emittedErrors.map(({ error }) => error.message) }
    }
    const declaring = ($schema: unknown) => ({ $schema, ...CONTRACT_DESCRIPTOR })

    test.each([
      '../../specs/erc7730-v2.schema.json',
      'https://eips.ethereum.org/assets/eip-7730/erc7730-v2.schema.json'
    ])('uses a descriptor that declares %s', async ($schema) => {
      const { found, errors } = await describeCall({ [REGISTRY_PATH]: declaring($schema) })

      expect(found[0]?.path).toBe(REGISTRY_PATH)
      expect(errors).toEqual([])
    })

    test.each([
      ['a newer version', '../../specs/erc7730-v3.schema.json', 'erc7730-v3.schema.json'],
      ['an older version', '../../specs/erc7730-v1.schema.json', 'erc7730-v1.schema.json'],
      [
        'a supported name only as a folder',
        'https://example.com/erc7730-v2.schema.json/erc7730-v3.schema.json',
        'erc7730-v3.schema.json'
      ],
      ['an empty schema', '', 'none declared'],
      ['a schema that is not a text', 2, 'none declared'],
      ['no schema', undefined, 'none declared']
    ])('does not use a descriptor with %s, and reports it', async (_, $schema, reported) => {
      const { found, errors } = await describeCall({ [REGISTRY_PATH]: declaring($schema) })

      expect(found).toEqual({})
      expect(errors).toEqual([`Unsupported ERC-7730 schema: ${reported}`])
    })

    test('reports a newer version as unsupported even when its shape changed', async () => {
      const { errors } = await describeCall({
        [REGISTRY_PATH]: {
          $schema: '../../specs/erc7730-v3.schema.json',
          display: { formats: 'a new shape' }
        }
      })

      expect(errors).toEqual(['Unsupported ERC-7730 schema: erc7730-v3.schema.json'])
    })

    test('does not use a descriptor that includes a file of an unsupported version', async () => {
      const { found, errors } = await describeCall({
        [REGISTRY_PATH]: {
          ...declaring('../../specs/erc7730-v2.schema.json'),
          includes: INCLUDED_PATH
        },
        [INCLUDED_PATH]: { $schema: '../../specs/erc7730-v3.schema.json' }
      })

      expect(found).toEqual({})
      expect(errors).toEqual(['Unsupported ERC-7730 schema: erc7730-v3.schema.json'])
    })
  })

  test('reports and skips an index entry whose descriptor is not in the registry', async () => {
    const controller = makeController(makeRegistry({ descriptors: {} }))

    await expect(controller.getDescriptorsForAccountOp(accountOp)).resolves.toEqual({})
    expect(controller.emittedErrors).toHaveLength(1)
    expect(controller.emittedErrors[0]?.error.message).toBe(
      'An ERC-7730 descriptor is not in the registry'
    )
  })

  test.each([
    ['is missing', {}],
    ['is invalid', { [REGISTRY_PATH]: { display: { formats: 'not formats' } } }],
    ['is not an object', { [REGISTRY_PATH]: 'not a descriptor' }],
    [
      'includes a missing file',
      { [REGISTRY_PATH]: { ...CONTRACT_DESCRIPTOR, includes: INCLUDED_PATH } }
    ]
  ])('does not name a descriptor that %s in the errors it reports', async (_, descriptors) => {
    const controller = makeController(makeRegistry({ descriptors }))

    await controller.getDescriptorsForAccountOp(accountOp)

    expect(controller.emittedErrors.length).toBeGreaterThan(0)
    controller.emittedErrors.forEach(({ message, error }) => {
      expect(`${message} ${error.message}`).not.toContain('registry/test')
    })
  })

  test('reports and skips an invalid descriptor instead of using it', async () => {
    const controller = makeController(
      makeRegistry({ descriptors: { [REGISTRY_PATH]: { display: { formats: 'not formats' } } } })
    )

    await expect(controller.getDescriptorsForAccountOp(accountOp)).resolves.toEqual({})
    expect(controller.emittedErrors).toHaveLength(1)
  })

  // An accountOp is humanized again on every update of it
  test('reports an invalid descriptor only the first time it is looked up', async () => {
    const controller = makeController(
      makeRegistry({ descriptors: { [REGISTRY_PATH]: { display: { formats: 'not formats' } } } })
    )

    await controller.getDescriptorsForAccountOp(accountOp)
    await controller.getDescriptorsForAccountOp(accountOp)

    await expect(controller.getDescriptorsForAccountOp(accountOp)).resolves.toEqual({})
    expect(controller.emittedErrors).toHaveLength(1)
  })

  test('reports a missing descriptor only the first time it is looked up', async () => {
    const controller = makeController(makeRegistry({ descriptors: {} }))

    await controller.getDescriptorsForAccountOp(accountOp)
    await controller.getDescriptorsForAccountOp(accountOp)

    await expect(controller.getDescriptorsForAccountOp(accountOp)).resolves.toEqual({})
    expect(controller.emittedErrors).toHaveLength(1)
  })

  test('still follows a Safe proxy whose own descriptor is invalid', async () => {
    const SAFE_SINGLETON = '0x41675c099f32341bf84bfc5382af534df5c7461a'
    const SAFE_PATH = 'registry/safe/calldata-Safe-1.4.1.json'
    const provider = {
      getCode: jest.fn(async () => SAFE_PROXY_V1_4_1_RUNTIME_CODE),
      getStorage: jest.fn(async () => `0x000000000000000000000000${SAFE_SINGLETON.slice(2)}`)
    }
    const controller = makeController(
      makeRegistry({
        calldataIndex: {
          [`eip155:1:${CONTRACT_ADDRESS}`]: REGISTRY_PATH,
          [`eip155:1:${SAFE_SINGLETON}`]: SAFE_PATH
        },
        descriptors: {
          [REGISTRY_PATH]: { display: { formats: 'not formats' } },
          [SAFE_PATH]: CONTRACT_DESCRIPTOR
        }
      }),
      { providers: { '1': provider }, initialLoadPromise: undefined }
    )

    const descriptors = await controller.getDescriptorsForAccountOp(accountOp)

    expect(descriptors[0]?.path).toBe(SAFE_PATH)
    expect(controller.emittedErrors).toHaveLength(1)
  })

  // `constructor` and `toString` exist on every object through its prototype
  test('does not take what an object inherits for the descriptor of a contract', async () => {
    const controller = makeController(
      makeRegistry({ calldataIndex: { [`eip155:1:${CONTRACT_ADDRESS}`]: 'constructor' } })
    )

    await expect(controller.getDescriptorsForAccountOp(accountOp)).resolves.toEqual({})
    expect(controller.emittedErrors).toHaveLength(1)
  })

  test('does not take what an object inherits for an included descriptor', async () => {
    const controller = makeController(
      makeRegistry({
        descriptors: { [REGISTRY_PATH]: { ...CONTRACT_DESCRIPTOR, includes: 'toString' } }
      })
    )

    await expect(controller.getDescriptorsForAccountOp(accountOp)).resolves.toEqual({})
    expect(controller.emittedErrors).toHaveLength(1)
  })

  test('describes a typed message with the descriptor matching its primary type', async () => {
    const controller = makeController(
      makeRegistry({
        eip712Index: {
          [`eip155:1:${VERIFYING_CONTRACT}`]: { Order: [{ path: EIP712_PATH }] }
        },
        descriptors: {
          [EIP712_PATH]: {
            display: {
              formats: {
                'Order(uint256 amount)': {
                  intent: 'Place order',
                  fields: [{ path: 'amount', label: 'Amount', visible: 'always' }]
                }
              }
            }
          }
        }
      })
    )
    const message = {
      content: {
        kind: 'typedMessage',
        types: { Order: [{ name: 'amount', type: 'uint256' }] },
        domain: { chainId: 1, verifyingContract: VERIFYING_CONTRACT },
        message: { amount: '1' },
        primaryType: 'Order'
      },
      chainId: 1n
    } as unknown as Message

    const descriptor = await controller.getDescriptorForMessage(message)

    expect(descriptor?.path).toBe(EIP712_PATH)
    expect(controller.emittedErrors).toEqual([])
  })

  test('returns no descriptor for a typed message the registry does not have', async () => {
    const controller = makeController(makeRegistry())
    const message = {
      content: {
        kind: 'typedMessage',
        types: { Order: [{ name: 'amount', type: 'uint256' }] },
        domain: { chainId: 1, verifyingContract: VERIFYING_CONTRACT },
        message: { amount: '1' },
        primaryType: 'Order'
      },
      chainId: 1n
    } as unknown as Message

    await expect(controller.getDescriptorForMessage(message)).resolves.toBeNull()
  })

  test('replies to the UI request with the resolved descriptors', async () => {
    const sendUiMessage = jest.fn()
    const controller = new Erc7730Controller({
      registry: declareSupportedSchema(makeRegistry()),
      ui: makeUi(sendUiMessage)
    })

    await controller.resolveDescriptorsForAccountOp(accountOp, 'request-1')

    expect(sendUiMessage).toHaveBeenCalledWith({
      requestId: 'request-1',
      ok: true,
      res: expect.objectContaining({ 0: expect.objectContaining({ path: REGISTRY_PATH }) })
    })
  })

  describe('Safe singleton lookup', () => {
    const PROXY_ADDRESS = '0x2222222222222222222222222222222222222222'
    const LIFI_DIAMOND = '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae'
    const SAFE_SINGLETON = '0x41675c099f32341bf84bfc5382af534df5c7461a'
    const LIFI_PATH = 'registry/lifi/calldata-LIFIDiamond.json'
    const SAFE_PATH = 'registry/safe/calldata-Safe-1.4.1.json'
    // Any contract that is not a SafeProxy, e.g. one deployed to impersonate a registered protocol
    const SPOOF_CODE = '0x6080604052600080fdfea164736f6c6343000818000a'

    const proxyRegistry: Erc7730Registry = {
      calldataIndex: {
        [`eip155:1:${LIFI_DIAMOND}`]: LIFI_PATH,
        [`eip155:1:${SAFE_SINGLETON}`]: SAFE_PATH
      },
      eip712Index: {},
      descriptors: {
        [LIFI_PATH]: { display: { formats: { 'test()': { intent: 'Proxy test', fields: [] } } } },
        [SAFE_PATH]: { display: { formats: { 'test()': { intent: 'Proxy test', fields: [] } } } }
      }
    }
    const proxyAccountOp = {
      chainId: 1n,
      calls: [{ to: PROXY_ADDRESS, value: 0n, data: '0x12345678' }]
    } as AccountOp

    const makeProvider = (code: string, singleton: string) => ({
      getCode: jest.fn(async () => code),
      getStorage: jest.fn(async () => `0x000000000000000000000000${singleton.slice(2)}`)
    })

    const resolveProxyCall = async (code: string, singleton: string) => {
      const provider = makeProvider(code, singleton)
      const controller = makeController(proxyRegistry, {
        providers: { '1': provider },
        initialLoadPromise: undefined
      })

      const descriptors = await controller.getDescriptorsForAccountOp(proxyAccountOp)

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

    test('merges every include of the Safe singleton descriptor', async () => {
      const descriptors: Erc7730Registry['descriptors'] = {
        ...proxyRegistry.descriptors,
        [SAFE_PATH]: {
          display: { formats: { 'test()': { intent: 'Proxy test', fields: [] } } },
          includes: 'registry/safe/level-1.json'
        }
      }
      for (let level = 1; level <= 6; level += 1) {
        descriptors[`registry/safe/level-${level}.json`] =
          level < 6
            ? { includes: `registry/safe/level-${level + 1}.json` }
            : { metadata: { owner: 'Deepest include' } }
      }
      const controller = makeController(
        { ...proxyRegistry, descriptors },
        {
          providers: { '1': makeProvider(SAFE_PROXY_V1_4_1_RUNTIME_CODE, SAFE_SINGLETON) },
          initialLoadPromise: undefined
        }
      )

      const found = await controller.getDescriptorsForAccountOp(proxyAccountOp)

      expect(found[0]?.path).toBe(SAFE_PATH)
      expect(found[0]?.descriptor.metadata?.owner).toBe('Deepest include')
    })

    test('reads a Safe proxy once for concurrent and later lookups', async () => {
      const provider = makeProvider(SAFE_PROXY_V1_4_1_RUNTIME_CODE, SAFE_SINGLETON)
      const controller = makeController(proxyRegistry, {
        providers: { '1': provider },
        initialLoadPromise: undefined
      })

      await Promise.all([
        controller.getDescriptorsForAccountOp(proxyAccountOp),
        controller.getDescriptorsForAccountOp(proxyAccountOp)
      ])
      const descriptors = await controller.getDescriptorsForAccountOp(proxyAccountOp)

      expect(descriptors[0]?.path).toBe(SAFE_PATH)
      expect(provider.getCode).toHaveBeenCalledTimes(1)
      expect(provider.getStorage).toHaveBeenCalledTimes(1)
    })

    test('reports a failed read and describes the call without the proxy', async () => {
      const provider = {
        getCode: jest.fn(async () => {
          throw new Error('RPC unavailable')
        }),
        getStorage: jest.fn(async () => '0x')
      }
      const controller = makeController(proxyRegistry, {
        providers: { '1': provider },
        initialLoadPromise: undefined
      })

      await expect(controller.getDescriptorsForAccountOp(proxyAccountOp)).resolves.toEqual({})
      expect(controller.emittedErrors).toHaveLength(1)
    })

    test('does not read the chain when no provider is available', async () => {
      const controller = makeController(proxyRegistry)

      await expect(controller.getDescriptorsForAccountOp(proxyAccountOp)).resolves.toEqual({})
      expect(controller.emittedErrors).toEqual([])
    })
  })
})
