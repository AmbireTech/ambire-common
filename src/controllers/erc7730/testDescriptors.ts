import { IProvidersController } from '../../interfaces/provider'
import { IUiController } from '../../interfaces/ui'
import { Message } from '../../interfaces/userRequest'
import { AccountOp } from '../../libs/accountOp/accountOp'
import {
  Erc7730CallDescriptors,
  Erc7730Registry,
  Erc7730ResolvedDescriptor
} from '../../libs/humanizer/erc7730/types'
import { Erc7730Controller } from './erc7730'
import { declareSupportedSchema } from '../../../test/mocks/erc7730Registry'

/** Runtime code of a real SafeProxy v1.4.1, so a mocked provider looks like a deployed Safe.
 * The proxy version is fixed here on purpose: its keccak256 must match a hash in
 * KNOWN_SAFE_PROXY_CODE_HASHES (consts/safe.ts) for the Safe singleton lookup to follow it. */
export const SAFE_PROXY_V1_4_1_RUNTIME_CODE =
  '0x608060405273ffffffffffffffffffffffffffffffffffffffff600054167fa619486e0000000000000000000000000000000000000000000000000000000060003514156050578060005260206000f35b3660008037600080366000845af43d6000803e60008114156070573d6000fd5b3d6000f3fea264697066735822122003d1488ee65e08fa41e58e888a9865554c535f2c77126a82cb4c0f917f31441364736f6c63430007060033'

/**
 * The test controllers by registry, then by the provider they read Safe proxies with. Keyed by
 * both, so a call made without a provider never hands its provider-less controller to a later call
 * that passes one - which would silently skip every Safe proxy lookup of that call.
 */
const controllersByRegistry = new WeakMap<Erc7730Registry, Map<unknown, Erc7730Controller>>()

/** A no-op sink, since these tests only assert on the returned descriptors. */
const makeUiStub = (): IUiController =>
  ({ message: { sendUiMessage: () => {} } }) as unknown as IUiController

/** Answers every chainId with the same provider, which is all these tests ever pass in. */
const makeProvidersStub = (provider?: any): IProvidersController | undefined =>
  provider &&
  ({
    providers: new Proxy({}, { get: () => provider }),
    initialLoadPromise: undefined
  } as unknown as IProvidersController)

/**
 * Runs the real plan/look-up loop against a test's registry.
 *
 * Memoized per `registry` and `provider`, so repeated calls within one test share a controller -
 * and therefore its Safe singleton cache and the errors it reported - while separate tests, which
 * each build their own registry, stay isolated. Tests of the library itself should pass a plain
 * `known` object instead; this is for tests that go through the controller.
 */
const getTestController = (registry: Erc7730Registry, provider?: any): Erc7730Controller => {
  let controllersByProvider = controllersByRegistry.get(registry)
  if (!controllersByProvider) {
    controllersByProvider = new Map()
    controllersByRegistry.set(registry, controllersByProvider)
  }

  const existing = controllersByProvider.get(provider)
  if (existing) return existing

  const controller = new Erc7730Controller({
    providers: makeProvidersStub(provider),
    ui: makeUiStub(),
    registry: declareSupportedSchema(registry)
  })
  controllersByProvider.set(provider, controller)

  return controller
}

/**
 * The errors the test controller reported for this registry - pass the `provider` the lookups
 * were made with, as each provider gets a controller of its own. Descriptor lookups never throw -
 * a failure degrades to the built-in humanization - so this is how a test asserts that a missing
 * or invalid descriptor was actually reported rather than silently swallowed. It creates no
 * controller, so asking before any lookup returns no errors and changes nothing for later lookups.
 */
export const getTestErc7730Errors = (registry: Erc7730Registry, provider?: any) =>
  controllersByRegistry.get(registry)?.get(provider)?.emittedErrors ?? []

export const getTestErc7730Descriptors = (
  accountOp: AccountOp,
  registry: Erc7730Registry,
  provider?: any
): Promise<Erc7730CallDescriptors> =>
  getTestController(registry, provider).getDescriptorsForAccountOp(accountOp)

/** A single call, wrapped as a one-call accountOp. */
export const getTestErc7730DescriptorForCall = async (
  call: AccountOp['calls'][number],
  chainId: bigint,
  registry: Erc7730Registry,
  provider?: any
): Promise<Erc7730ResolvedDescriptor | null> => {
  const descriptors = await getTestErc7730Descriptors(
    { chainId, calls: [call] } as AccountOp,
    registry,
    provider
  )

  return descriptors[0] ?? null
}

export const getTestErc7730MessageDescriptor = (
  message: Message,
  registry: Erc7730Registry,
  provider?: any
): Promise<Erc7730ResolvedDescriptor | null> =>
  getTestController(registry, provider).getDescriptorForMessage(message)
