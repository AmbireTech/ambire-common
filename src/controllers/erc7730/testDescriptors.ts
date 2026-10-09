import { IProvidersController } from '../../interfaces/provider'
import { IStorageController } from '../../interfaces/storage'
import { IUiController } from '../../interfaces/ui'
import { Message } from '../../interfaces/userRequest'
import { AccountOp } from '../../libs/accountOp/accountOp'
import {
  Erc7730CallDescriptors,
  Erc7730ResolvedDescriptor
} from '../../libs/humanizer/erc7730/types'
import { BindedRelayerCall } from '../../libs/relayerCall/relayerCall'
import { FeatureFlagsController } from '../featureFlags/featureFlags'
import { Erc7730Controller } from './erc7730'

/** Runtime code of a real SafeProxy v1.4.1, so a mocked provider looks like a deployed Safe.
 * The proxy version is fixed here on purpose: its keccak256 must match a hash in
 * KNOWN_SAFE_PROXY_CODE_HASHES (consts/safe.ts) for the Safe singleton lookup to follow it. */
export const SAFE_PROXY_V1_4_1_RUNTIME_CODE =
  '0x608060405273ffffffffffffffffffffffffffffffffffffffff600054167fa619486e0000000000000000000000000000000000000000000000000000000060003514156050578060005260206000f35b3660008037600080366000845af43d6000803e60008114156070573d6000fd5b3d6000f3fea264697066735822122003d1488ee65e08fa41e58e888a9865554c535f2c77126a82cb4c0f917f31441364736f6c63430007060033'

const controllersByRelayer = new WeakMap<object, Erc7730Controller>()

/** In-memory storage, so a test controller never touches anything persistent. */
const makeMemoryStorage = (): IStorageController =>
  ({
    get: async (key: string, defaultValue?: any) => defaultValue,
    set: async () => {}
  }) as any

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
 * Runs the real plan/fetch loop against a test's relayer mock.
 *
 * Memoized per `callRelayer`, so repeated calls within one test share a controller - and therefore
 * its cache and request dedup - while separate tests, which each build their own mock, stay
 * isolated. Tests of the library itself should pass a plain `known` object instead; this is for
 * tests that assert on relayer traffic.
 */
const getTestController = (callRelayer: BindedRelayerCall, provider?: any): Erc7730Controller => {
  const existing = controllersByRelayer.get(callRelayer)
  if (existing) return existing

  const controller = new Erc7730Controller({
    storage: makeMemoryStorage(),
    callRelayer,
    featureFlags: new FeatureFlagsController({}, makeMemoryStorage()),
    providers: makeProvidersStub(provider),
    ui: makeUiStub()
  })
  controllersByRelayer.set(callRelayer, controller)

  return controller
}

/**
 * The errors the test controller reported for this relayer mock. Descriptor lookups never throw -
 * a failure degrades to the built-in humanization - so this is how a test asserts that a bad
 * response was actually reported rather than silently swallowed.
 */
export const getTestErc7730Errors = (callRelayer: BindedRelayerCall) =>
  getTestController(callRelayer).emittedErrors

export const getTestErc7730Descriptors = (
  accountOp: AccountOp,
  callRelayer: BindedRelayerCall,
  provider?: any
): Promise<Erc7730CallDescriptors> =>
  getTestController(callRelayer, provider).getDescriptorsForAccountOp(accountOp)

/** A single call, wrapped as a one-call accountOp. */
export const getTestErc7730DescriptorForCall = async (
  call: AccountOp['calls'][number],
  chainId: bigint,
  callRelayer: BindedRelayerCall,
  provider?: any
): Promise<Erc7730ResolvedDescriptor | null> => {
  const descriptors = await getTestErc7730Descriptors(
    { chainId, calls: [call] } as AccountOp,
    callRelayer,
    provider
  )

  return descriptors[0] ?? null
}

export const getTestErc7730MessageDescriptor = (
  message: Message,
  callRelayer: BindedRelayerCall,
  provider?: any
): Promise<Erc7730ResolvedDescriptor | null> =>
  getTestController(callRelayer, provider).getDescriptorForMessage(message)
