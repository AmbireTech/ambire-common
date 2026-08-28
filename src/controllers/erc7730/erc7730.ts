import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter'
import { IStorageController } from '../../interfaces/storage'
import { Message } from '../../interfaces/userRequest'
import { AccountOp } from '../../libs/accountOp/accountOp'
import {
  CacheEntry,
  Erc7730CalldataIndex,
  Erc7730CallDescriptors,
  Erc7730Descriptor,
  Erc7730Eip712Index,
  Erc7730Known,
  Erc7730PersistedRegistryCache,
  Erc7730ResolvedDescriptor,
  Erc7730Want,
  EMPTY_ERC7730_KNOWN,
  ERC7730_MAX_RESOLUTION_DEPTH,
  getAddressFromStorageSlot,
  normalizeRelayerPath,
  planErc7730MessageWants,
  planErc7730Wants,
  resolveErc7730Descriptors,
  resolveErc7730MessageDescriptor,
  selectEip712IndexEntry,
  SafeSingletonProvider,
  validateCalldataIndex,
  validateDescriptor,
  validateEip712Index
} from '../../libs/humanizer/erc7730'
import {
  ERC7730_CACHE_TTL_MS,
  ERC7730_CALLDATA_INDEX_RELAYER_PATH,
  ERC7730_DESCRIPTOR_PATH,
  ERC7730_DESCRIPTOR_WAIT_MS,
  ERC7730_EIP712_INDEX_RELAYER_PATH,
  SAFE_PROXY_SINGLETON_SLOT,
  SAFE_SINGLETON_CACHE_TTL_MS
} from '../../libs/humanizer/erc7730/consts'
import { fetchRelayerResource } from '../../libs/humanizer/erc7730/fetch'
import { BindedRelayerCall } from '../../libs/relayerCall/relayerCall'
import { withTimeout } from '../../utils/with-timeout'
import EventEmitter from '../eventEmitter/eventEmitter'

/** Replies to a UI request made through `dispatchAndWait`, which awaits by `requestId`. */
type SendUiMessage = (params: {
  requestId: string
  ok: boolean
  res?: unknown
  error?: string
}) => void

// One flat store keyed by strings, so the persisted descriptors are the entries under this prefix
const CALLDATA_INDEX_KEY = 'calldataIndex'
const EIP712_INDEX_KEY = 'eip712Index'
const DESCRIPTOR_KEY_PREFIX = 'descriptor:'
const SINGLETON_KEY_PREFIX = 'safeSingleton:'

const descriptorKey = (relayerPath: string) => `${DESCRIPTOR_KEY_PREFIX}${relayerPath}`

const EMPTY_PERSISTED_CACHE: Erc7730PersistedRegistryCache = {
  calldataIndex: null,
  eip712Index: null,
  descriptors: {}
}

/**
 * Owns ERC-7730 "clear signing" descriptors: fetching them, caching them, and keeping that cache in
 * storage so it survives a service worker restart. The only writer of the `erc7730RegistryCache`
 * storage key.
 *
 * The library in `libs/humanizer/erc7730` is entirely synchronous and performs no I/O. It reports
 * what it is *missing* as `Erc7730Want`s; this controller answers them and asks again, until
 * nothing is missing. Each round is one parallel batch, and each nesting level takes one round.
 *
 * So everything external - the relayer, the RPC reads for Safe proxies, the cache, the request
 * dedup and the persistence - lives here.
 */
export class Erc7730Controller extends EventEmitter {
  #storage: IStorageController

  #callRelayer: BindedRelayerCall

  #sendUiMessage: SendUiMessage

  #getProvider: (chainId: bigint) => SafeSingletonProvider | undefined

  #persisting = false

  #persistScheduled = false

  // Bumped on every cache write, so a run served entirely from cache doesn't rewrite an identical
  // blob; `#persistedRevision` is the revision the last write was taken at.
  #revision = 0

  #persistedRevision = 0

  #entries = new Map<string, { value: unknown; fetchedAt: number }>()

  #inFlight = new Map<string, Promise<unknown>>()

  // Private, so it stays out of the controller state serialized to the UI on every update
  #initialLoadPromise: Promise<void>

  constructor({
    storage,
    callRelayer,
    getProvider,
    sendUiMessage,
    eventEmitterRegistry
  }: {
    storage: IStorageController
    callRelayer: BindedRelayerCall
    /** Reads a Safe proxy's singleton slot; omit where no RPC access is available. */
    getProvider?: (chainId: bigint) => SafeSingletonProvider | undefined
    sendUiMessage: SendUiMessage
    eventEmitterRegistry?: IEventEmitterRegistryController
  }) {
    super(eventEmitterRegistry)

    this.#storage = storage
    this.#callRelayer = callRelayer
    this.#sendUiMessage = sendUiMessage
    this.#getProvider = getProvider ?? (() => undefined)

    this.#initialLoadPromise = this.#load()
  }

  async #load() {
    try {
      const persisted = await this.#storage.get('erc7730RegistryCache', EMPTY_PERSISTED_CACHE)

      // Entries past their TTL are dropped rather than kept and re-checked on every lookup, which
      // is also what keeps the stored blob from growing without bound.
      this.#hydrate(CALLDATA_INDEX_KEY, persisted.calldataIndex, ERC7730_CACHE_TTL_MS)
      this.#hydrate(EIP712_INDEX_KEY, persisted.eip712Index, ERC7730_CACHE_TTL_MS)
      Object.entries(persisted.descriptors).forEach(([path, entry]) => {
        this.#hydrate(descriptorKey(path), entry, ERC7730_CACHE_TTL_MS)
      })
    } catch (error: any) {
      this.emitError({
        message:
          'Something went wrong while loading saved transaction details. Transactions will still be readable, they may just take a moment longer to describe.',
        level: 'silent',
        error
      })
    }

    this.#persistedRevision = this.#revision
  }

  /**
   * Writes the whole in-memory cache under its storage key. Always a full write, never a
   * read-modify-write, so concurrent descriptor fetches can't drop each other's entries. Awaits a
   * running write, skips intermediate ones and queues only the last, the same way
   * `DomainsController` persists its own cache.
   */
  async #persist() {
    const revision = this.#revision
    if (revision === this.#persistedRevision) return

    if (this.#persisting) {
      this.#persistScheduled = true
      return
    }

    this.#persisting = true
    try {
      await this.#storage.set('erc7730RegistryCache', {
        calldataIndex: this.#entryFor<Erc7730CalldataIndex>(CALLDATA_INDEX_KEY),
        eip712Index: this.#entryFor<Erc7730Eip712Index>(EIP712_INDEX_KEY),
        descriptors: this.#descriptorEntries()
      })
      // Recorded only once the write lands, so a failed one is retried by the next persist
      // instead of being taken for done
      this.#persistedRevision = revision
    } catch (error) {
      console.warn('erc7730: failed to persist the descriptor cache', error)
    } finally {
      this.#persisting = false
      if (this.#persistScheduled) {
        this.#persistScheduled = false
        void this.#persist()
      }
    }
  }

  //
  // Answering wants. Each fetch is cached and deduped, so a want repeated across rounds or across
  // calls costs at most one request.
  //

  /**
   * One cached, deduped fetch. Nothing may await between finding no in-flight request and storing
   * this one, or concurrent callers all miss that check and each fires a request - which is what
   * would make an accountOp with ten calls fetch the one shared index ten times.
   */
  async #cached<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
    const cached = this.#entries.get(key)
    if (cached && Date.now() - cached.fetchedAt < ttlMs) return cached.value as T

    const pending = this.#inFlight.get(key)
    if (pending) return pending as Promise<T>

    const promise = fetcher()
      .then((value) => {
        this.#entries.set(key, { value, fetchedAt: Date.now() })
        this.#revision += 1

        return value
      })
      .catch((error) => {
        // A refetch that fails leaves the stale value in place rather than losing it
        if (cached) return cached.value as T
        throw error
      })
      .finally(() => {
        this.#inFlight.delete(key)
      })

    this.#inFlight.set(key, promise)

    return promise
  }

  /** Seeds one entry from storage, ignoring anything already past its TTL. */
  #hydrate(key: string, entry: CacheEntry<unknown> | null, ttlMs: number) {
    if (entry && Date.now() - entry.fetchedAt < ttlMs) this.#entries.set(key, entry)
  }

  #entryFor<T>(key: string): CacheEntry<T> | null {
    return (this.#entries.get(key) as CacheEntry<T> | undefined) ?? null
  }

  #descriptorEntries(): Record<string, CacheEntry<Erc7730Descriptor>> {
    const descriptors: Record<string, CacheEntry<Erc7730Descriptor>> = {}

    this.#entries.forEach((entry, key) => {
      if (key.startsWith(DESCRIPTOR_KEY_PREFIX)) {
        descriptors[key.slice(DESCRIPTOR_KEY_PREFIX.length)] =
          entry as CacheEntry<Erc7730Descriptor>
      }
    })

    return descriptors
  }

  #getCalldataIndex(): Promise<Erc7730CalldataIndex> {
    return this.#cached(CALLDATA_INDEX_KEY, ERC7730_CACHE_TTL_MS, () =>
      fetchRelayerResource<Erc7730CalldataIndex>(
        ERC7730_CALLDATA_INDEX_RELAYER_PATH,
        'GET',
        this.#callRelayer,
        validateCalldataIndex
      )
    )
  }

  #getEip712Index(): Promise<Erc7730Eip712Index> {
    return this.#cached(EIP712_INDEX_KEY, ERC7730_CACHE_TTL_MS, () =>
      fetchRelayerResource<Erc7730Eip712Index>(
        ERC7730_EIP712_INDEX_RELAYER_PATH,
        'GET',
        this.#callRelayer,
        validateEip712Index
      )
    )
  }

  /** Paths reach here as the registry wrote them; normalizing keeps one cache entry per file. */
  #getDescriptor(pathOrUrl: string): Promise<Erc7730Descriptor> {
    const relayerPath = normalizeRelayerPath(pathOrUrl)

    return this.#cached(descriptorKey(relayerPath), ERC7730_CACHE_TTL_MS, () =>
      fetchRelayerResource<Erc7730Descriptor>(
        ERC7730_DESCRIPTOR_PATH,
        'POST',
        this.#callRelayer,
        validateDescriptor,
        { descriptorPath: relayerPath }
      )
    )
  }

  async #getSafeSingleton(chainId: bigint, safeAddress: string): Promise<string | null> {
    const provider = this.#getProvider(chainId)
    if (!provider) return null

    const cacheKey = `${SINGLETON_KEY_PREFIX}${chainId.toString()}:${safeAddress.toLowerCase()}`

    try {
      return await this.#cached(cacheKey, SAFE_SINGLETON_CACHE_TTL_MS, async () => {
        const slotValue = await withTimeout(
          () => provider.getStorage(safeAddress, SAFE_PROXY_SINGLETON_SLOT),
          {
            timeoutMs: ERC7730_DESCRIPTOR_WAIT_MS,
            message: `Timed out fetching Safe singleton: ${safeAddress}`
          }
        )

        return getAddressFromStorageSlot(slotValue)
      })
    } catch (error) {
      console.error(error)

      return null
    }
  }

  //
  // Descriptor lookups
  //

  /**
   * Answers one want, always recording something - a value, or a negative - so the planner stops
   * asking for it. A relayer or RPC failure is recorded as a negative rather than thrown, so one
   * unavailable descriptor degrades to the built-in humanization instead of losing the whole op.
   */
  async #answer(want: Erc7730Want, known: Erc7730Known): Promise<void> {
    try {
      await this.#fetchWant(want, known)
    } catch (error) {
      console.error(error)
      this.#recordUnavailable(want, known)
    }
  }

  #recordUnavailable(want: Erc7730Want, known: Erc7730Known) {
    if (want.kind === 'safeSingleton') {
      known.safeSingletons[`${want.chainId.toString()}:${want.address.toLowerCase()}`] = null
    } else if (want.kind === 'includedDescriptor') {
      known.descriptorsByPath[want.path] = null
    } else if (want.kind === 'contractDescriptor') {
      known.contractDescriptors[`eip155:${want.chainId.toString()}:${want.address.toLowerCase()}`] =
        null
    } else {
      const registryKey = `eip155:${want.chainId.toString()}:${want.verifyingContract.toLowerCase()}`
      known.eip712Descriptors[`${registryKey}:${want.primaryType}`] = null
    }
  }

  async #fetchWant(want: Erc7730Want, known: Erc7730Known): Promise<void> {
    if (want.kind === 'safeSingleton') {
      const singleton = await this.#getSafeSingleton(want.chainId, want.address)
      known.safeSingletons[`${want.chainId.toString()}:${want.address.toLowerCase()}`] = singleton

      return
    }

    if (want.kind === 'includedDescriptor') {
      known.descriptorsByPath[want.path] = await this.#getDescriptor(want.path)

      return
    }

    if (want.kind === 'contractDescriptor') {
      const key = `eip155:${want.chainId.toString()}:${want.address.toLowerCase()}`
      const index = await this.#getCalldataIndex()
      const path = index[key]

      if (!path) {
        known.contractDescriptors[key] = null

        return
      }

      known.contractDescriptors[key] = { path }
      known.descriptorsByPath[path] = await this.#getDescriptor(path)

      return
    }

    const registryKey = `eip155:${want.chainId.toString()}:${want.verifyingContract.toLowerCase()}`
    const key = `${registryKey}:${want.primaryType}`
    const index = await this.#getEip712Index()
    const entries = index[registryKey]?.[want.primaryType]
    const entry = entries?.length ? selectEip712IndexEntry(entries, want.encodeTypeHash) : null

    if (!entry) {
      known.eip712Descriptors[key] = null

      return
    }

    known.eip712Descriptors[key] = { path: entry.path }
    known.descriptorsByPath[entry.path] = await this.#getDescriptor(entry.path)
  }

  /**
   * Asks the library what it is missing, fetches that batch, and asks again - until it wants
   * nothing more. Each round uncovers the next nesting level, and terminates because nested
   * calldata is strictly shorter than its parent; the depth cap is a backstop.
   */
  async #gather(plan: (known: Erc7730Known) => Erc7730Want[]): Promise<Erc7730Known> {
    await this.#initialLoadPromise

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

    void this.#persist()

    return known
  }

  async getDescriptorsForAccountOp(accountOp: AccountOp): Promise<Erc7730CallDescriptors> {
    try {
      const known = await this.#gather((state) => planErc7730Wants(accountOp, state))

      return resolveErc7730Descriptors(accountOp, known)
    } catch (error) {
      console.error(error)

      // Nothing usable was fetched, but built-in descriptors need no fetching at all
      return resolveErc7730Descriptors(accountOp, EMPTY_ERC7730_KNOWN)
    }
  }

  async getDescriptorForMessage(message: Message): Promise<Erc7730ResolvedDescriptor | null> {
    try {
      const known = await this.#gather((state) => planErc7730MessageWants(message, state))

      return resolveErc7730MessageDescriptor(message, known)
    } catch (error) {
      console.error(error)

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

      this.#sendUiMessage({ requestId, ok: true, res: descriptors })
    } catch (error: any) {
      this.#sendUiMessage({
        requestId,
        ok: false,
        error: error?.message || 'Failed to resolve the transaction details'
      })
    }
  }
}
