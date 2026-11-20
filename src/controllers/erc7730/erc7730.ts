import { keccak256 } from 'ethers'

import { BUNDLED_ERC7730_REGISTRY } from '../../consts/erc7730'
import { KNOWN_SAFE_PROXY_CODE_HASHES, KNOWN_SAFE_SINGLETONS } from '../../consts/safe'
import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter'
import { IProvidersController, RPCProvider } from '../../interfaces/provider'
import { IUiController } from '../../interfaces/ui'
import { Message } from '../../interfaces/userRequest'
import { AccountOp } from '../../libs/accountOp/accountOp'
import {
  ERC7730_DESCRIPTOR_WAIT_MS,
  SAFE_PROXY_SINGLETON_SLOT,
  SAFE_SINGLETON_CACHE_TTL_MS
} from '../../libs/humanizer/erc7730/consts'
import {
  ERC7730_MAX_RESOLUTION_DEPTH,
  getAddressFromStorageSlot,
  normalizeDescriptorPath,
  planErc7730MessageWants,
  planErc7730Wants,
  resolveErc7730Descriptors,
  resolveErc7730MessageDescriptor,
  selectEip712IndexEntry,
  validateDescriptor
} from '../../libs/humanizer/erc7730/registry'
import {
  EMPTY_ERC7730_KNOWN,
  Erc7730CallDescriptors,
  Erc7730Descriptor,
  Erc7730Known,
  Erc7730Registry,
  Erc7730ResolvedDescriptor,
  Erc7730Want
} from '../../libs/humanizer/erc7730/types'
import { getRegistryKey, getSafeSingletonKey } from '../../libs/humanizer/erc7730/utils'
import { withTimeout } from '../../utils/with-timeout'
import EventEmitter from '../eventEmitter/eventEmitter'

/** Reads a key of a lookup table, ignoring anything inherited from `Object.prototype` */
const getOwn = <T>(record: Record<string, T>, key: string): T | undefined =>
  Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined

/**
 * Owns ERC-7730 "clear signing" descriptors: looking them up in the registry the wallet ships with
 * (`BUNDLED_ERC7730_REGISTRY`), and reading which contract a Safe proxy delegates to.
 *
 * Descriptors are never fetched - the registry is bundled with the app and refreshed with every
 * release - so describing a transaction or a message sends nothing about it anywhere. The only
 * reads are the RPC reads for Safe proxies, from the network the transaction is on.
 *
 * The library in `libs/humanizer/erc7730` is entirely synchronous and performs no I/O. It reports
 * what it is *missing* as `Erc7730Want`s; this controller answers them and asks again, until
 * nothing is missing. Each round is one parallel batch, and each nesting level takes one round.
 */
export class Erc7730Controller extends EventEmitter {
  #registry: Erc7730Registry

  #ui: IUiController

  /** Reads a Safe proxy's singleton slot; undefined where no RPC access is available. */
  #providers: IProvidersController | undefined

  /**
   * The descriptors looked up so far, by their path in the registry: the descriptor once it passed
   * validation, or null if it is missing or invalid
   */
  #descriptors = new Map<string, Erc7730Descriptor | null>()

  #safeSingletons = new Map<string, { singleton: string | null; readAt: number }>()

  #safeSingletonReads = new Map<string, Promise<string | null>>()

  constructor({
    providers,
    ui,
    registry = BUNDLED_ERC7730_REGISTRY,
    eventEmitterRegistry
  }: {
    /** Omit where no RPC access is available. */
    providers?: IProvidersController
    ui: IUiController
    /** The registry descriptors are looked up in. Only tests pass one of their own. */
    registry?: Erc7730Registry
    eventEmitterRegistry?: IEventEmitterRegistryController
  }) {
    super(eventEmitterRegistry)

    this.#registry = registry
    this.#ui = ui
    this.#providers = providers
  }

  //
  // Answering wants
  //

  /** A descriptor by its path in the registry. Throws if it isn't there or isn't valid */
  #readDescriptor(registryPath: string): Erc7730Descriptor {
    const descriptor = getOwn(this.#registry.descriptors, registryPath)
    if (descriptor === undefined) {
      throw new Error(`ERC-7730 descriptor not in the registry: ${registryPath}`)
    }
    // Throws if the descriptor is invalid
    if (!validateDescriptor(descriptor, registryPath)) {
      throw new Error(`Invalid ERC-7730 descriptor: ${registryPath}`)
    }

    return descriptor
  }

  /**
   * A descriptor by the path the registry wrote it with, validated the first time it is used, or
   * null if it isn't in the registry or isn't valid. That is reported only the first time, as the
   * calls of an accountOp are humanized again on every update of it.
   */
  #getDescriptor(pathOrUrl: string): Erc7730Descriptor | null {
    // Index entries are written without a leading slash, `includes` resolve to one
    const registryPath = normalizeDescriptorPath(pathOrUrl).slice(1)
    const lookedUpDescriptor = this.#descriptors.get(registryPath)
    if (lookedUpDescriptor !== undefined) return lookedUpDescriptor

    let descriptor: Erc7730Descriptor | null = null
    try {
      descriptor = this.#readDescriptor(registryPath)
    } catch (error: any) {
      this.emitError({
        message:
          'Some transaction details could not be loaded. The transaction will still be readable, just with less detail.',
        level: 'silent',
        error
      })
    }

    this.#descriptors.set(registryPath, descriptor)

    return descriptor
  }

  async #readSafeSingleton(provider: RPCProvider, safeAddress: string): Promise<string | null> {
    const [code, slotValue] = await withTimeout(
      () =>
        Promise.all([
          provider.getCode(safeAddress),
          provider.getStorage(safeAddress, SAFE_PROXY_SINGLETON_SLOT)
        ]),
      {
        timeoutMs: ERC7730_DESCRIPTOR_WAIT_MS,
        message: `Timed out fetching Safe singleton: ${safeAddress}`
      }
    )

    // Any contract can put a registered address in slot 0 to borrow its descriptor, but only
    // a real SafeProxy forwards its calls to that address
    if (!KNOWN_SAFE_PROXY_CODE_HASHES.has(keccak256(code))) return null

    const singleton = getAddressFromStorageSlot(slotValue)
    if (!singleton || !KNOWN_SAFE_SINGLETONS.has(singleton.toLowerCase())) return null

    return singleton
  }

  /**
   * The singleton a Safe proxy delegates to, or null if the address isn't a Safe proxy (or it
   * can't be read). Cached, as people don't change their singleton on a whim, and deduped.
   * Nothing may await between finding no read in flight and storing this one, or concurrent
   * callers all miss that check and each reads the chain.
   */
  async #getSafeSingleton(chainId: bigint, safeAddress: string): Promise<string | null> {
    const provider = this.#providers?.providers[chainId.toString()]
    if (!provider) return null

    const key = getSafeSingletonKey(chainId, safeAddress)
    const cached = this.#safeSingletons.get(key)
    if (cached && Date.now() - cached.readAt < SAFE_SINGLETON_CACHE_TTL_MS) return cached.singleton

    const pending = this.#safeSingletonReads.get(key)
    if (pending) return pending

    const read = this.#readSafeSingleton(provider, safeAddress)
      .then((singleton) => {
        this.#safeSingletons.set(key, { singleton, readAt: Date.now() })

        return singleton
      })
      .catch((error: any) => {
        this.emitError({
          message: `Something went wrong while reading the details of the Safe account ${safeAddress}. Its transactions will still be readable, just with less detail.`,
          level: 'silent',
          error
        })

        // A read that fails leaves the stale value in place rather than losing it
        return cached ? cached.singleton : null
      })
      .finally(() => {
        this.#safeSingletonReads.delete(key)
      })

    this.#safeSingletonReads.set(key, read)

    return read
  }

  /**
   * Answers one want, always recording something - a value, or a negative - so the planner stops
   * asking for it. A missing or invalid descriptor is recorded as a negative rather than thrown, so
   * one unusable descriptor degrades to the built-in humanization instead of losing the whole op;
   * anything unexpected that throws is reported and recorded as a negative too.
   */
  async #answer(want: Erc7730Want, known: Erc7730Known): Promise<void> {
    try {
      await this.#lookUpWant(want, known)
    } catch (error: any) {
      this.emitError({
        message:
          'Some transaction details could not be loaded. The transaction will still be readable, just with less detail.',
        level: 'silent',
        error
      })
      this.#recordUnavailable(want, known)
    }
  }

  #recordUnavailable(want: Erc7730Want, known: Erc7730Known) {
    switch (want.kind) {
      case 'safeSingleton':
        known.safeSingletons[getSafeSingletonKey(want.chainId, want.address)] = null
        break
      case 'includedDescriptor':
        known.descriptorsByPath[want.path] = null
        break
      case 'contractDescriptor':
        known.contractDescriptors[getRegistryKey(want.chainId, want.address)] = null
        break
      case 'eip712Descriptor': {
        const registryKey = getRegistryKey(want.chainId, want.verifyingContract)
        known.eip712Descriptors[`${registryKey}:${want.primaryType}`] = null
        break
      }
      default: {
        // A new want kind that records nothing here would be re-asked on every round and then
        // silently dropped, so this makes adding one a compile error instead
        const unhandled: never = want
        throw new Error(`Unhandled ERC-7730 want: ${JSON.stringify(unhandled)}`)
      }
    }
  }

  async #lookUpWant(want: Erc7730Want, known: Erc7730Known): Promise<void> {
    if (want.kind === 'safeSingleton') {
      const singleton = await this.#getSafeSingleton(want.chainId, want.address)
      known.safeSingletons[getSafeSingletonKey(want.chainId, want.address)] = singleton

      return
    }

    if (want.kind === 'includedDescriptor') {
      known.descriptorsByPath[want.path] = this.#getDescriptor(want.path)

      return
    }

    if (want.kind === 'contractDescriptor') {
      const key = getRegistryKey(want.chainId, want.address)
      const path = getOwn(this.#registry.calldataIndex, key)
      // A contract whose descriptor can't be used is recorded as having none, the same as one
      // that isn't registered, so a Safe proxy pointing at it is still followed to its singleton
      const descriptor = path ? this.#getDescriptor(path) : null

      if (!path || !descriptor) {
        known.contractDescriptors[key] = null

        return
      }

      known.contractDescriptors[key] = { path }
      known.descriptorsByPath[path] = descriptor

      return
    }

    const registryKey = getRegistryKey(want.chainId, want.verifyingContract)
    const key = `${registryKey}:${want.primaryType}`
    const entriesByPrimaryType = getOwn(this.#registry.eip712Index, registryKey)
    const entries = entriesByPrimaryType && getOwn(entriesByPrimaryType, want.primaryType)
    const entry = entries?.length ? selectEip712IndexEntry(entries, want.encodeTypeHash) : null
    const descriptor = entry ? this.#getDescriptor(entry.path) : null

    if (!entry || !descriptor) {
      known.eip712Descriptors[key] = null

      return
    }

    known.eip712Descriptors[key] = { path: entry.path }
    known.descriptorsByPath[entry.path] = descriptor
  }

  /**
   * Asks the library what it is missing, looks that batch up, and asks again - until it wants
   * nothing more. Each round uncovers the next nesting level, and terminates because nested
   * calldata is strictly shorter than its parent; the depth cap is a backstop.
   */
  async #gather(plan: (known: Erc7730Known) => Erc7730Want[]): Promise<Erc7730Known> {
    // Providers are constructed after their networks load, so a lookup before that settles would
    // find nothing and record a Safe as having no singleton
    await this.#providers?.initialLoadPromise

    const known: Erc7730Known = {
      contractDescriptors: { ...EMPTY_ERC7730_KNOWN.contractDescriptors },
      eip712Descriptors: { ...EMPTY_ERC7730_KNOWN.eip712Descriptors },
      descriptorsByPath: { ...EMPTY_ERC7730_KNOWN.descriptorsByPath },
      safeSingletons: { ...EMPTY_ERC7730_KNOWN.safeSingletons }
    }

    for (let round = 0; round < ERC7730_MAX_RESOLUTION_DEPTH; round++) {
      const wants = plan(known)
      if (!wants.length) break

      await Promise.all(wants.map((want) => this.#answer(want, known)))
    }

    return known
  }

  //
  // Descriptor lookups
  //

  async getDescriptorsForAccountOp(accountOp: AccountOp): Promise<Erc7730CallDescriptors> {
    try {
      const known = await this.#gather((state) => planErc7730Wants(accountOp, state))

      return resolveErc7730Descriptors(accountOp, known)
    } catch (error: any) {
      this.emitError({
        message:
          'Some transaction details could not be loaded. The transaction will still be readable, just with less detail.',
        level: 'silent',
        error
      })

      // Nothing usable was looked up, but built-in descriptors need no lookup at all
      return resolveErc7730Descriptors(accountOp, EMPTY_ERC7730_KNOWN)
    }
  }

  async getDescriptorForMessage(message: Message): Promise<Erc7730ResolvedDescriptor | null> {
    try {
      const known = await this.#gather((state) => planErc7730MessageWants(message, state))

      return resolveErc7730MessageDescriptor(message, known)
    } catch (error: any) {
      this.emitError({
        message:
          'Some details of this message could not be loaded. The message will still be readable, just with less detail.',
        level: 'silent',
        error
      })

      return null
    }
  }

  /**
   * The UI-facing counterpart of `getDescriptorsForAccountOp`, for screens that humanize an
   * accountOp themselves (transaction history, Benzin). Replies to the awaiting `dispatchAndWait`
   * rather than returning, since the UI and this controller are separate contexts in the extension.
   */
  async resolveDescriptorsForAccountOp(accountOp: AccountOp, requestId: string) {
    try {
      const descriptors = await this.getDescriptorsForAccountOp(accountOp)

      this.#ui.message.sendUiMessage({ requestId, ok: true, res: descriptors })
    } catch (error: any) {
      this.#ui.message.sendUiMessage({
        requestId,
        ok: false,
        error: error?.message || 'Failed to resolve the transaction details'
      })
    }
  }
}
