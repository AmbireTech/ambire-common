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
import { Erc7730Controller } from './erc7730'

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
