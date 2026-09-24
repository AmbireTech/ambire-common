import { formatUnits, Interface, JsonRpcProvider } from 'ethers'

import {
  createPPv1Broadcaster,
  OxBowAspService,
  PrivacyPoolsV1Protocol
} from '@kohaku-eth/privacy-pools'
import type { Host, Keystore, Storage } from '@kohaku-eth/plugins'

import EmittableError from '../../classes/EmittableError'
import {
  fromPrivacyPoolsAssetAddress,
  getPrivacyPoolsAsset,
  getPrivacyPoolsBundlerUrl,
  getPrivacyPoolsChainConfig,
  getPrivacyPoolsStoreKey,
  isPrivacyPoolsNativeAsset,
  PRIVACY_POOLS_ACCOUNT_INDEX,
  PRIVACY_POOLS_ACTIVITY_STORAGE_KEY,
  PRIVACY_POOLS_SUPPORTED_CHAIN_IDS,
  toPrivacyPoolsAssetAddress
} from '../../consts/privacyPools'
import { IEventEmitterRegistryController, Statuses } from '../../interfaces/eventEmitter'
import { Fetch } from '../../interfaces/fetch'
import { IKeystoreController } from '../../interfaces/keystore'
import { INetworksController } from '../../interfaces/network'
import {
  IPrivacyPoolsController,
  PrivacyPoolsActivityEntry,
  PrivacyPoolsChainConfig,
  PrivacyPoolsChainState,
  PrivacyPoolsChainSyncState,
  PrivacyPoolsNote,
  PrivacyPoolsOperation,
  PrivacyPoolsTokenBalance,
  PrivacyPoolsUnavailableReason
} from '../../interfaces/privacyPools'
import { IProvidersController } from '../../interfaces/provider'
import { ISelectedAccountController } from '../../interfaces/selectedAccount'
import { IStorageController } from '../../interfaces/storage'
import { Call } from '../../libs/accountOp/types'
import {
  createKohakuKeystore,
  createKohakuNetwork,
  createKohakuProvider,
  createKohakuStorage
} from '../../libs/kohaku/host'
import { createProverFactory } from '../../libs/privacyPools/prover'
import { createPrivacyPoolsDataService } from '../../libs/privacyPools/dataService'
import { readEntrypointAssetConfig } from '../../libs/privacyPools/entrypointAssetConfig'
import { readPaymasterWithdrawal } from '../../libs/privacyPools/paymasterWithdrawal'
import { generateUuid } from '../../utils/uuid'
import EventEmitter from '../eventEmitter/eventEmitter'

/**
 * Only `sync` is wrapped. Preparing and broadcasting a withdrawal run long with no way to abort,
 * which `withStatus` must not wrap - they report through `operation` instead.
 */
export const STATUS_WRAPPED_METHODS = {
  sync: 'INITIAL'
} as const

const ERC20_INTERFACE = new Interface([
  'function approve(address spender, uint256 amount)',
  'function allowance(address owner, address spender) view returns (uint256)'
])

/**
 * Callers name a token by the address the wallet uses for it - `ZERO_ADDRESS` for native. Whether
 * that means native is derived here rather than passed alongside, so the two can never disagree.
 */
type AssetRef = { tokenAddress: string }

/**
 * A prepared withdrawal in the only shape this wallet asks for - a paymaster-sponsored ERC-4337
 * userOp, already built and signed by the withdrawal's single-use sender.
 *
 * The SDK also prepares relayer withdrawals, so what `prepareUnshield` returns is a union. The
 * paymaster variant is not exported on its own, hence narrowing the union rather than naming it.
 */
type PreparedPaymasterWithdrawal = Extract<
  Awaited<ReturnType<PrivacyPoolsV1Protocol['prepareUnshield']>>,
  { mode: 'paymaster' }
>

/**
 * What the SDK throws when the paymaster's gas fee would exceed the withdrawn amount. Matched by
 * its exact wording because the SDK throws a plain `Error` with no code to tell it apart.
 */
const FEE_ABOVE_AMOUNT_SDK_MESSAGE = 'Withdrawal amount too small to cover the sponsored gas fee'

/**
 * Turns the one SDK failure a user can act on into a sentence they can read. Everything else is
 * passed through, and shown as the generic fallback.
 */
const toReadableWithdrawalError = (error: any) => {
  if (!(error instanceof Error) || !error.message.includes(FEE_ABOVE_AMOUNT_SDK_MESSAGE))
    return error

  return new EmittableError({
    message:
      'This amount is too small to cover the network fee for withdrawing it. Please try a larger amount.',
    level: 'expected',
    error
  })
}

/**
 * Owns the wallet's Privacy Pools state: one plugin per (chain, recovery phrase), the notes those
 * plugins find, and the locally kept log of what this wallet did with them.
 *
 * Scoped by recovery phrase rather than by account, because the note secrets are derived from the
 * phrase: accounts sharing a phrase share one set of notes, and an account without one (hardware,
 * private-key import, view-only) cannot use Privacy Pools at all.
 */
export class PrivacyPoolsController extends EventEmitter implements IPrivacyPoolsController {
  #keystore: IKeystoreController

  #networks: INetworksController

  #providers: IProvidersController

  #selectedAccount: ISelectedAccountController

  #storage: IStorageController

  #fetch: Fetch

  /**
   * The one storage adapter every plugin persists through.
   *
   * Shared rather than built per plugin, because the adapter caches the whole blob and rewrites it
   * on every save. Two plugins with a cache each - two recovery phrases on the same device - would
   * each write back their own copy, and the last one would silently undo the other's progress.
   */
  #kohakuStorage: Storage

  /**
   * Hands a set of calls to the regular signing flow. A callback rather than a direct
   * `RequestsController` reference, because that controller is built after this one and because
   * this is the only thing Privacy Pools needs from it.
   */
  #buildCallsRequest: (params: {
    calls: Call[]
    meta: { chainId: bigint; accountAddr: string }
  }) => Promise<void>

  /**
   * One plugin per `${chainId}:${seedId}`. Keyed by both because a plugin binds a chain's provider
   * to one phrase's secrets, and switching either has to produce a different instance rather than
   * reuse one that would scan for the wrong notes.
   */
  #protocols = new Map<string, PrivacyPoolsV1Protocol>()

  /** The provider each plugin was built against, so a provider swap can invalidate it. */
  #providerInstances = new Map<string, JsonRpcProvider>()

  /**
   * Which live plugins read their pool history from the CDN rather than the chain.
   *
   * Tracked because that reading is worth doing exactly once. See `#dropSagaHydratedProtocols`.
   */
  #sagaHydratedKeys = new Set<string>()

  /**
   * One key adapter per phrase, outliving the plugins built on it, so a rebuilt plugin reuses the
   * keys already derived instead of paying a fresh pbkdf2 for each of them again.
   */
  #kohakuKeystores = new Map<string, Keystore>()

  /**
   * The tail every sync is chained onto, so syncs run one at a time whatever their network or
   * phrase.
   *
   * Serialized rather than parallel because the expensive part of a sync - reading the pools'
   * history - is the same for every phrase on a network. The first one pays for it and persists
   * it, and every phrase after it starts from that and only reads the few blocks since. Two in
   * parallel would each walk the whole history, doubling the RPC load to reach the same state.
   */
  #syncQueue: Promise<void> = Promise.resolve()

  /** The queued or running sync per `${chainId}:${seedId}`, so asking again joins it. */
  #syncJobs = new Map<string, Promise<void>>()

  /**
   * How many syncs are queued or running per chain. The chain reads as syncing while any is, for
   * every phrase - they all wait on the same history.
   */
  #pendingSyncsByChain = new Map<string, number>()

  #syncStatesByChain: { [chainId: string]: PrivacyPoolsChainSyncState } = {}

  /**
   * Bumped whenever a sync persists a chain's history. A plugin reads the store only once, when it
   * is built, so one built before the latest save would walk again the blocks another phrase's
   * sync has already read. See `#getProtocol`.
   */
  #chainVersions = new Map<string, number>()

  /** The chain version each live plugin's in-memory state matches. */
  #protocolChainVersions = new Map<string, number>()

  /**
   * Bumped on every lock. A sync cannot be aborted, so one still running when the wallet locks
   * would otherwise write back the notes the lock just wiped.
   */
  #generation = 0

  /** Notes per `${seedId}` then per chain, so switching accounts keeps each phrase's own view. */
  #notesByIdentity: {
    [seedId: string]: { [chainId: string]: { notes: PrivacyPoolsNote[]; lastSyncedAt: number } }
  } = {}

  #activity: PrivacyPoolsActivityEntry[] = []

  /**
   * The proved-but-unsent withdrawal. Private: it carries the proof and the signed userOp, neither
   * of which the UI needs - it reads the fee off `operation.quote`.
   */
  #pendingWithdrawal: PreparedPaymasterWithdrawal | null = null

  #proverFactory: () => Promise<any>

  /**
   * The pre-scanned pool history a first sync starts from, when the platform layer ships one.
   *
   * Only ever consulted on a cold chain: the plugin prefers what it has already persisted, so this
   * is the floor for a fresh install rather than something that can overwrite a synced wallet.
   *
   * Optional, and increasingly beside the point - a chain with a `sagaSyncUrl` reads the same
   * history from the CDN, fresher and without several megabytes in the build. See
   * `#resolveInitialState` for what a chain starts from when nothing is shipped.
   */
  #getShippedInitialState?: () => Promise<Record<string, any>>

  #unsubscribers: (() => void)[] = []

  /**
   * The latest withdrawal - the one in flight, or the last one until dismissed - whichever phrase
   * it belongs to. Reaches the UI through `operation`, only while its phrase is on screen.
   */
  #operation: PrivacyPoolsOperation | null = null

  statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS> = STATUS_WRAPPED_METHODS

  initialLoadPromise?: Promise<void>

  constructor({
    keystore,
    networks,
    providers,
    selectedAccount,
    storage,
    fetch,
    circuitsBaseUrl,
    getInitialState,
    buildCallsRequest,
    eventEmitterRegistry
  }: {
    keystore: IKeystoreController
    networks: INetworksController
    providers: IProvidersController
    selectedAccount: ISelectedAccountController
    storage: IStorageController
    fetch: Fetch
    /**
     * Where the circuit artifacts are served from. A build asset whose URL only the platform layer
     * knows - an extension URL on the extension, a static path on the websites.
     */
    circuitsBaseUrl: string
    /**
     * Loads the shipped pool history, keyed the way the plugin keys its own store. A callback so
     * the several megabytes it holds are fetched only when a chain actually needs them, and so the
     * platform layer decides where they come from - a bundled asset, or nothing at all.
     */
    getInitialState?: () => Promise<Record<string, any>>
    buildCallsRequest: (params: {
      calls: Call[]
      meta: { chainId: bigint; accountAddr: string }
    }) => Promise<void>
    eventEmitterRegistry?: IEventEmitterRegistryController
  }) {
    super(eventEmitterRegistry)
    this.#keystore = keystore
    this.#networks = networks
    this.#providers = providers
    this.#selectedAccount = selectedAccount
    this.#storage = storage
    this.#fetch = fetch
    this.#kohakuStorage = createKohakuStorage({
      storage,
      storageKey: 'privacyPoolsState',
      onError: (error, message) =>
        this.emitError({
          message:
            message || 'Privacy Pools could not save its progress. It will be rebuilt next time.',
          level: 'silent',
          error: error instanceof Error ? error : new Error('privacyPools: storage write failed')
        })
    })
    this.#buildCallsRequest = buildCallsRequest
    this.#getShippedInitialState = getInitialState
    this.#proverFactory = createProverFactory(circuitsBaseUrl)

    // Cleared when done so the resolved promise isn't carried in the state sent to the UI.
    this.initialLoadPromise = this.#load().finally(() => {
      this.initialLoadPromise = undefined
    })
  }

  async #load() {
    // Everything `supportedChainIds` and `unavailableReason` read has to be loaded first,
    // otherwise the UI is briefly told Privacy Pools is unavailable on every start.
    await this.#networks.initialLoadPromise
    await this.#providers.initialLoadPromise
    await this.#keystore.initialLoadPromise
    await this.#selectedAccount.initialLoadPromise

    // Entries recorded before the log carried a seed cannot be attributed to one, so they are
    // dropped rather than kept around unreachable.
    this.#activity = (await this.#storage.get(PRIVACY_POOLS_ACTIVITY_STORAGE_KEY, [])).filter(
      (entry) => !!entry.seedId
    )

    this.#subscribeToDependencies()
    this.emitUpdate()
  }

  /**
   * Privacy Pools holds derived secrets and live RPC providers, so it cannot just read its
   * dependencies on demand - it has to react when they change. Each subscription either
   * invalidates a plugin or changes what the getters below report, and getter values only reach
   * the UI when an update is emitted.
   */
  #subscribeToDependencies() {
    this.#unsubscribers.push(
      this.#keystore.onUpdate((forceEmit) => {
        // Locking must drop the derived note secrets, not merely hide the UI. The notes go with
        // them: nothing derived from the phrase may outlive the lock.
        if (!this.#keystore.isUnlocked && this.#hasPhraseDerivedState()) this.#teardown()

        this.propagateUpdate(forceEmit)
      }, 'privacyPools'),

      // Switching accounts drops nothing: every phrase has its own plugins and its own notes, so
      // switching back shows them at once, and a sync still running for the previous phrase keeps
      // going and leaves the network's history warm for the next one.
      this.#selectedAccount.onUpdate(
        (forceEmit) => this.propagateUpdate(forceEmit),
        'privacyPools'
      ),

      this.#providers.onUpdate((forceEmit) => {
        const staleKeys = [...this.#providerInstances.keys()].filter((key) => {
          const chainId = key.split(':')[0] as string
          return this.#providers.providers[chainId] !== this.#providerInstances.get(key)
        })

        staleKeys.forEach((key) => this.#dropProtocol(key))

        this.propagateUpdate(forceEmit)
      }, 'privacyPools'),

      // Subscribed to purely so `supportedChainIds` and everything derived from it reaches the UI.
      this.#networks.onUpdate((forceEmit) => this.propagateUpdate(forceEmit), 'privacyPools')
    )
  }

  /**
   * The chains this wallet can use Privacy Pools on: the SDK's own capability, narrowed to the
   * networks the user actually has and that have a provider.
   *
   * In practice this resolves to one chain - Sepolia only exists in the testnet network set and
   * Ethereum only in the mainnet one.
   */
  get supportedChainIds(): string[] {
    return PRIVACY_POOLS_SUPPORTED_CHAIN_IDS.map((chainId) => chainId.toString()).filter(
      (chainId) =>
        this.#networks.networks.some((network) => network.chainId.toString() === chainId) &&
        !!this.#providers.providers[chainId]
    )
  }

  get unavailableReason(): PrivacyPoolsUnavailableReason | null {
    // Structural reasons first: they don't change by unlocking, so telling a hardware-wallet user
    // to unlock would send them to do something that cannot help.
    if (!this.#getSeedIdForSelectedAccount()) return 'no-seed'
    if (!this.supportedChainIds.length) return 'unsupported-network'
    if (!this.#keystore.isUnlocked) return 'locked'

    return null
  }

  get isAvailableForSelectedAccount(): boolean {
    return !this.unavailableReason
  }

  /**
   * Per-chain state as the UI reads it: the chain's own sync merged with what this phrase holds
   * there. A getter rather than a field, so the split stays an implementation detail.
   */
  get chains(): { [chainId: string]: PrivacyPoolsChainState } {
    const seedId = this.#getSeedIdForSelectedAccount()
    const identityChains = (seedId && this.#notesByIdentity[seedId]) || {}
    const chainIds = new Set([
      ...this.supportedChainIds,
      ...Object.keys(this.#syncStatesByChain),
      ...Object.keys(identityChains)
    ])

    return Object.fromEntries(
      [...chainIds].map((chainId) => {
        const sync = this.#syncStatesByChain[chainId] || {
          syncStatus: 'idle' as const,
          syncStartedAt: null,
          error: null
        }
        const identity = identityChains[chainId]

        return [
          chainId,
          {
            chainId,
            ...sync,
            lastSyncedAt: identity?.lastSyncedAt ?? null,
            notes: identity?.notes ?? []
          }
        ]
      })
    )
  }

  /**
   * The withdrawal on screen - the one in flight, or the last one until dismissed. Public because
   * proving takes ten seconds and up, and the UI has nothing else to show meanwhile.
   *
   * Hidden while another phrase is on screen, rather than dropped: a withdrawal cannot be stopped
   * mid-proof, and switching back must show it where it was.
   */
  get operation(): PrivacyPoolsOperation | null {
    if (this.#operation?.seedId !== this.#getSeedIdForSelectedAccount()) return null

    return this.#operation
  }

  /** Whether any chain has completed a scan for this phrase, i.e. whether there is anything to show. */
  get hasSyncedAnyChain(): boolean {
    return Object.values(this.chains).some((chain) => !!chain.lastSyncedAt)
  }

  /**
   * Notes collapsed to one row per token per chain, split by what can actually be done with them.
   * Only `approvedAmount` can be withdrawn; the rest is waiting on the association set and can
   * only be reclaimed publicly.
   */
  get balances(): { [chainId: string]: PrivacyPoolsTokenBalance[] } {
    return Object.fromEntries(
      Object.entries(this.chains).map(([chainId, chain]) => {
        const byToken = new Map<string, PrivacyPoolsTokenBalance>()

        chain.notes.forEach((note) => {
          const key = note.tokenAddress.toLowerCase()
          const asset = getPrivacyPoolsAsset(BigInt(chainId), key)
          const entry = byToken.get(key) || {
            tokenAddress: key,
            // An unconfigured asset can only happen if a pool is added before we list it. Showing
            // the raw amount beats hiding a balance the user owns, so it degrades rather than drops.
            symbol: asset?.symbol || 'Unknown token',
            decimals: asset?.decimals ?? 0,
            isNative: asset?.isNative ?? isPrivacyPoolsNativeAsset(key),
            approvedAmount: 0n,
            pendingAmount: 0n,
            totalAmount: 0n
          }

          if (note.approval === 'approved') entry.approvedAmount += note.amount
          else entry.pendingAmount += note.amount

          entry.totalAmount += note.amount
          byToken.set(key, entry)
        })

        return [chainId, [...byToken.values()]]
      })
    )
  }

  /**
   * This phrase's operations, newest first. Scoped here rather than in the UI so another phrase's
   * operations cannot reach it at all, and scoped by phrase rather than by account to match the
   * notes they sit beside - accounts sharing a phrase share the notes, so they share the log.
   */
  get activity(): PrivacyPoolsActivityEntry[] {
    const seedId = this.#getSeedIdForSelectedAccount()
    if (!seedId) return []

    return this.#activity
      .filter((entry) => entry.seedId === seedId)
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  /**
   * The note secrets come from the recovery phrase the selected account's key was derived from, so
   * they only exist for accounts that have one.
   */
  #getSeedIdForSelectedAccount(): string | null {
    const account = this.#selectedAccount.account
    if (!account) return null

    const storedSeedIds = new Set(this.#keystore.seeds.map((seed) => seed.id))

    for (const key of this.#keystore.keys) {
      if (key.type !== 'internal') continue
      if (!account.associatedKeys.includes(key.addr)) continue

      const { fromSeedId } = key.meta
      if (fromSeedId && storedSeedIds.has(fromSeedId)) return fromSeedId
    }

    return null
  }

  #assertAvailableAndGetSeedId(): string {
    const reason = this.unavailableReason

    if (reason === 'no-seed')
      throw new EmittableError({
        message:
          'Privacy Pools needs an account created from a recovery phrase. Hardware wallets and imported private keys cannot be used.',
        level: 'expected',
        error: new Error('privacyPools: selected account has no seed')
      })

    if (reason === 'unsupported-network')
      throw new EmittableError({
        message: 'Privacy Pools is not available on any of the networks you have added.',
        level: 'expected',
        error: new Error('privacyPools: no supported network')
      })

    if (reason === 'locked')
      throw new EmittableError({
        message: 'Please unlock your wallet to use Privacy Pools.',
        level: 'expected',
        error: new Error('privacyPools: keystore locked')
      })

    const seedId = this.#getSeedIdForSelectedAccount()
    if (!seedId)
      throw new EmittableError({
        message: 'Privacy Pools is not available for this account.',
        level: 'expected',
        error: new Error('privacyPools: no seed id')
      })

    return seedId
  }

  #getHost(provider: JsonRpcProvider, seedId: string): Host {
    return {
      network: createKohakuNetwork(this.#fetch),
      storage: this.#kohakuStorage,
      keystore: this.#getKohakuKeystore(seedId),
      provider: createKohakuProvider(provider)
    }
  }

  #getProvider(chainId: string): JsonRpcProvider {
    const provider = this.#providers.providers[chainId]
    if (!provider) throw new Error(`privacyPools: no provider for chain ${chainId}`)

    return provider
  }

  #getKohakuKeystore(seedId: string): Keystore {
    const existing = this.#kohakuKeystores.get(seedId)
    if (existing) return existing

    const keystore = createKohakuKeystore((path) =>
      this.#keystore.derivePrivacyPoolsKey(seedId, path)
    )
    this.#kohakuKeystores.set(seedId, keystore)

    return keystore
  }

  #protocolKey(chainId: string, seedId: string) {
    return `${chainId}:${seedId}`
  }

  #dropProtocol(key: string) {
    this.#protocols.delete(key)
    this.#providerInstances.delete(key)
    this.#sagaHydratedKeys.delete(key)
    this.#protocolChainVersions.delete(key)
  }

  /**
   * The plugin for a chain and phrase.
   *
   * Rebuilt when another phrase's sync has persisted newer history since it was built, so it
   * starts from that rather than from what it last held in memory.
   */
  async #getProtocol(chainId: string, seedId: string): Promise<PrivacyPoolsV1Protocol> {
    const key = this.#protocolKey(chainId, seedId)
    const chainVersion = this.#chainVersions.get(chainId) || 0
    const existing = this.#protocols.get(key)

    if (existing && this.#protocolChainVersions.get(key) === chainVersion) return existing
    if (existing) this.#dropProtocol(key)

    const config = getPrivacyPoolsChainConfig(BigInt(chainId))
    if (!config) throw new Error(`privacyPools: unsupported chain ${chainId}`)

    const provider = this.#getProvider(chainId)
    const host = this.#getHost(provider, seedId)
    const { dataService, isSagaHydrated } = await this.#getDataService(config, host.provider)

    const protocol = new PrivacyPoolsV1Protocol(host, {
      accountIndex: PRIVACY_POOLS_ACCOUNT_INDEX,
      // Skipped entirely once this chain has a persisted store, so the cost of loading it is paid
      // once per install rather than on every sync.
      initialState: this.#resolveInitialState,
      dataService,
      entrypoint: {
        address: BigInt(config.entrypointAddress),
        deploymentBlock: config.deploymentBlock
      },
      proverFactory: this.#proverFactory,
      // 0xBow's API rather than the SDK's IPFS default, which depends on ipfs.io being up and on
      // the CID in the last on-chain root update still being pinned.
      aspServiceFactory: () =>
        new OxBowAspService({ network: host.network, aspUrl: config.aspUrl }),
      // Passed explicitly rather than left to the SDK's built-in table, so the adapters a
      // withdrawal is checked against in `readPaymasterWithdrawal` are the same ones it is built
      // with, and so the bundler is reached with our own key. Empty for a chain without a
      // paymaster, which makes the SDK refuse the withdrawal rather than fall back to its table.
      paymasterConfig: config.paymaster
        ? {
            [Number(config.chainId)]: {
              bundlerUrl: getPrivacyPoolsBundlerUrl(config.chainId),
              entryPointAddress: config.paymaster.entryPointAddress,
              paymasterAddress: config.paymaster.paymasterAddress,
              poolsAccountsMap: config.paymaster.poolAdapters
            }
          }
        : {}
    })

    this.#protocols.set(key, protocol)
    this.#providerInstances.set(key, provider)
    this.#protocolChainVersions.set(key, chainVersion)
    if (isSagaHydrated) this.#sagaHydratedKeys.add(key)

    return protocol
  }

  /**
   * What a chain with no stored history of its own starts from, keyed the way the plugin keys its
   * own store.
   *
   * Two things are merged. A platform layer that ships a pre-scanned history contributes it as it
   * comes. Every other chain still gets the block its entrypoint was deployed at, because the SDK
   * starts its entrypoint walk wherever this says the last sync reached - and with nothing to say,
   * that is block zero, twenty-two million blocks of `eth_getLogs` before the first event that
   * exists. Nothing else is claimed: the pools are left empty, so they are read in full.
   */
  #resolveInitialState = async (): Promise<Record<string, any>> => {
    const shipped = this.#getShippedInitialState ? await this.#getShippedInitialState() : {}

    return PRIVACY_POOLS_SUPPORTED_CHAIN_IDS.reduce((state, chainId) => {
      const config = getPrivacyPoolsChainConfig(chainId)
      if (!config) return state

      const key = getPrivacyPoolsStoreKey(config)
      if (state[key]) return state

      return {
        ...state,
        [key]: { sync: { lastSyncedBlock: `0x${config.deploymentBlock.toString(16)}` } }
      }
    }, shipped)
  }

  /**
   * How this chain's plugin reads the chain.
   *
   * The CDN is offered only for a cold chain, because its reader replays a pool's whole history on
   * every call - it ignores the block a sync asks it to start from. That is exactly what a first
   * sync wants and exactly what every later one does not, so a warm chain reads its handful of new
   * blocks from the provider. See `#dropSagaHydratedProtocols` for the other half of that.
   *
   * The provider-backed reader underneath is used either way, and is the parallel one in both
   * cases - a warm sync is a few windows, a cold Sepolia is thousands.
   */
  async #getDataService(config: PrivacyPoolsChainConfig, provider: Host['provider']) {
    const canUseSaga = !!config.sagaSyncUrl && (await this.#isChainCold(config))

    return createPrivacyPoolsDataService({
      provider,
      ...(canUseSaga
        ? { saga: { sourceUrl: config.sagaSyncUrl as string, chainId: config.chainId } }
        : {}),
      onSagaUnavailable: (error) =>
        this.emitError({
          message:
            'Loading your Privacy Pools history is taking the slow route on this network. It will still finish.',
          level: 'silent',
          error:
            error instanceof Error ? error : new Error('privacyPools: saga hydration unavailable')
        })
    })
  }

  /** Whether the plugin has stored nothing for this chain yet. */
  async #isChainCold(config: PrivacyPoolsChainConfig): Promise<boolean> {
    try {
      // Read through the shared adapter rather than the raw store, so a save still in flight from
      // another phrase's sync already counts.
      return !(await this.#kohakuStorage.get(getPrivacyPoolsStoreKey(config)))
    } catch {
      // A store that cannot be read is a store with nothing in it as far as this decision goes,
      // and reading from the CDN is the cheaper way to be wrong.
      return true
    }
  }

  /**
   * Drops the plugins that hydrated a chain from the CDN, once they have.
   *
   * The CDN reader is built for a cold chain and replays everything on every call, so keeping one
   * alive would re-download and re-parse a pool's whole history on every later sync. Dropping it
   * costs nothing: the history it fetched is already persisted, so the plugin built in its place
   * hydrates from the store and reads only the blocks since.
   */
  #dropSagaHydratedProtocols(chainId: string) {
    this.#sagaHydratedKeys.forEach((key) => {
      if (key.startsWith(`${chainId}:`)) this.#dropProtocol(key)
    })
  }

  #writeChainSyncState(chainId: string, update: Partial<PrivacyPoolsChainSyncState>) {
    this.#syncStatesByChain[chainId] = {
      ...(this.#syncStatesByChain[chainId] || {
        syncStatus: 'idle',
        syncStartedAt: null,
        error: null
      }),
      ...update
    }
  }

  /**
   * Walks a chain's pools and decrypts whatever belongs to this phrase.
   *
   * Queued behind any sync already running (see `#syncQueue`), and joinable: asking again for the
   * same chain and phrase returns the sync already queued or running rather than adding another.
   */
  async syncChain(chainId: string): Promise<void> {
    const seedId = this.#assertAvailableAndGetSeedId()
    const jobKey = this.#protocolKey(chainId, seedId)
    const existingJob = this.#syncJobs.get(jobKey)
    if (existingJob) return existingJob

    const generation = this.#generation

    this.#pendingSyncsByChain.set(chainId, (this.#pendingSyncsByChain.get(chainId) || 0) + 1)
    // Shown at once rather than when the sync gets its turn, so a sync waiting behind another
    // reads as under way instead of as nothing happening.
    if (!this.#isChainSyncing(chainId)) {
      this.#writeChainSyncState(chainId, {
        syncStatus: 'syncing',
        syncStartedAt: Date.now(),
        error: null
      })
      this.emitUpdate()
    }

    const job: Promise<void> = this.#syncQueue
      .then(async () => {
        const error = await this.#runSync(chainId, seedId, generation)
        this.#settleChainSync(chainId, generation, error)
      })
      .finally(() => {
        // A lock clears the map, so what is under this key may already be a newer sync
        if (this.#syncJobs.get(jobKey) === job) this.#syncJobs.delete(jobKey)
      })

    this.#syncJobs.set(jobKey, job)
    this.#syncQueue = job

    return job
  }

  #isChainSyncing(chainId: string) {
    const syncStatus = this.#syncStatesByChain[chainId]?.syncStatus

    return syncStatus === 'syncing' || syncStatus === 'initializing'
  }

  /**
   * One sync, once its turn comes. Resolves with the error to show for the chain, or null.
   *
   * Never rejects: a failed sync must not break the queue for the syncs behind it.
   */
  async #runSync(chainId: string, seedId: string, generation: number): Promise<string | null> {
    // Locked while this waited its turn - the secrets it was queued with are gone.
    if (generation !== this.#generation) return null

    const config = getPrivacyPoolsChainConfig(BigInt(chainId))
    const isChainCold = !!config && (await this.#isChainCold(config))

    // 'initializing' is the chain's own first read, whichever phrase happens to trigger it: that
    // is the walk that takes minutes. A phrase new to an already read chain only reads the tail.
    this.#writeChainSyncState(chainId, {
      syncStatus: isChainCold ? 'initializing' : 'syncing',
      syncStartedAt: Date.now(),
      error: null
    })
    this.emitUpdate()

    try {
      const protocol = await this.#getProtocol(chainId, seedId)

      await protocol.sync()

      // `notes` is optional on the plugin interface - it exists only when the plugin declares a
      // note type, which PPv1 does. Checked rather than asserted so a future SDK that drops it
      // fails with this sentence instead of a TypeError.
      if (!protocol.notes) throw new Error('privacyPools: plugin does not expose notes')

      const notes = await protocol.notes()

      // Locked while syncing: nothing derived from the phrase may be written back.
      if (generation !== this.#generation) return null

      this.#notesByIdentity[seedId] = {
        ...(this.#notesByIdentity[seedId] || {}),
        [chainId]: {
          lastSyncedAt: Date.now(),
          notes: notes.map((note) => ({
            label: note.label,
            tokenAddress: fromPrivacyPoolsAssetAddress(note.assetAddress),
            amount: note.balance,
            approval: note.approved ? 'approved' : 'pending'
          }))
        }
      }

      // The sync has persisted the chain's history by now, so every other phrase's plugin on this
      // chain is behind the store - and this one is exactly at it.
      const chainVersion = (this.#chainVersions.get(chainId) || 0) + 1
      this.#chainVersions.set(chainId, chainVersion)
      this.#protocolChainVersions.set(this.#protocolKey(chainId, seedId), chainVersion)

      // Whatever the CDN fetched is persisted by now, so the plugin that fetched it has done its
      // one job and the next sync should read the few new blocks from the provider instead.
      this.#dropSagaHydratedProtocols(chainId)

      return null
    } catch (error: any) {
      if (generation !== this.#generation) return null

      this.emitError({
        message: 'Could not load your Privacy Pools balance. Please try again.',
        level: 'silent',
        error: error instanceof Error ? error : new Error('privacyPools: sync failed')
      })

      return 'Could not load your Privacy Pools balance on this network. Please try again.'
    }
  }

  /**
   * Resolves the chain's status once a sync is done, unless another is still queued for it - the
   * chain keeps reading as syncing until the last one finishes.
   */
  #settleChainSync(chainId: string, generation: number, error: string | null) {
    // The lock that superseded this sync has already reset everything it would settle
    if (generation !== this.#generation) return

    const pendingSyncs = (this.#pendingSyncsByChain.get(chainId) || 1) - 1
    this.#pendingSyncsByChain.set(chainId, pendingSyncs)

    if (!pendingSyncs)
      this.#writeChainSyncState(chainId, {
        syncStatus: error ? 'idle' : 'ready',
        syncStartedAt: null,
        error
      })
    else if (error) this.#writeChainSyncState(chainId, { error })

    this.emitUpdate()
  }

  /** Syncs every chain this wallet can use, for the account on screen. */
  async sync(): Promise<void> {
    await this.withStatus(
      'sync',
      async () => {
        await Promise.all(this.supportedChainIds.map((chainId) => this.syncChain(chainId)))
      },
      true
    )
  }

  /**
   * Moves funds into the pool.
   *
   * Handed to the regular signing flow rather than broadcast here, because a deposit is an ordinary
   * transaction from the user's own account and deserves the same fee handling, simulation and
   * confirmation as any other.
   *
   * For ERC-20s the SDK builds only the entrypoint call, while `Entrypoint.deposit` pulls the funds
   * with `transferFrom` - so the approval has to be prepended here or the deposit reverts.
   *
   * The deposit is public by nature: the pool stores the depositing address and emits it. Nothing
   * here hides that, and the screen says so.
   */
  async deposit({
    chainId,
    tokenAddress,
    amount
  }: AssetRef & { chainId: string; amount: bigint }): Promise<void> {
    const seedId = this.#assertAvailableAndGetSeedId()
    const config = getPrivacyPoolsChainConfig(BigInt(chainId))
    if (!config) throw new Error(`privacyPools: unsupported chain ${chainId}`)

    const asset = getPrivacyPoolsAsset(BigInt(chainId), tokenAddress)
    if (!asset)
      throw new EmittableError({
        message: 'This token cannot be deposited into Privacy Pools.',
        level: 'expected',
        error: new Error(`privacyPools: unsupported asset ${tokenAddress} on chain ${chainId}`)
      })

    if (amount > asset.maxDeposit)
      throw new EmittableError({
        message: `Privacy Pools accepts at most ${formatUnits(asset.maxDeposit, asset.decimals)} ${
          asset.symbol
        } per deposit.`,
        level: 'expected',
        error: new Error('privacyPools: deposit above the operator ceiling')
      })

    const protocol = await this.#getProtocol(chainId, seedId)

    const { txns } = await protocol.prepareShield({
      asset: { __type: 'erc20', contract: toPrivacyPoolsAssetAddress(tokenAddress) },
      amount
    })

    const account = this.#selectedAccount.account
    if (!account) throw new Error('privacyPools: no selected account')

    const depositCalls: Call[] = txns.map((txn) => ({
      to: txn.to,
      data: txn.data,
      value: txn.value
    }))

    const calls = asset.isNative
      ? depositCalls
      : [
          ...(await this.#approvalCallIfNeeded(chainId, asset, amount, account.addr)),
          ...depositCalls
        ]

    const entry: PrivacyPoolsActivityEntry = {
      id: generateUuid(),
      seedId,
      chainId,
      type: 'deposit',
      tokenAddress,
      isNative: asset.isNative,
      amount,
      recipient: null,
      status: 'pending',
      createdAt: Date.now()
    }
    this.#activity.push(entry)
    this.emitUpdate()
    await this.#persistActivity()

    await this.#buildCallsRequest({
      calls,
      meta: { chainId: BigInt(chainId), accountAddr: account.addr }
    })
  }

  /**
   * The approval a deposit needs, or nothing when the allowance already covers it.
   *
   * `Entrypoint.deposit` pulls ERC-20s with `transferFrom`, and the SDK builds only the entrypoint
   * call - so without this the deposit reverts with nothing explaining why.
   */
  async #approvalCallIfNeeded(
    chainId: string,
    asset: { address: string },
    amount: bigint,
    owner: string
  ): Promise<Call[]> {
    const config = getPrivacyPoolsChainConfig(BigInt(chainId))
    if (!config) throw new Error(`privacyPools: unsupported chain ${chainId}`)

    // Read through the provider rather than an ethers `Contract`, whose dynamically generated
    // methods are untyped and read as possibly undefined.
    const allowanceResult = await this.#getProvider(chainId).call({
      to: asset.address,
      data: ERC20_INTERFACE.encodeFunctionData('allowance', [owner, config.entrypointAddress])
    })
    const allowance = ERC20_INTERFACE.decodeFunctionResult(
      'allowance',
      allowanceResult
    )[0] as bigint

    if (allowance >= amount) return []

    return [
      {
        to: asset.address,
        value: 0n,
        data: ERC20_INTERFACE.encodeFunctionData('approve', [config.entrypointAddress, amount])
      }
    ]
  }

  #startOperation(params: {
    seedId: string
    chainId: string
    tokenAddress: string
    isNative: boolean
    amount: bigint
    recipient: string
  }): PrivacyPoolsOperation {
    const operation: PrivacyPoolsOperation = {
      id: generateUuid(),
      ...params,
      status: 'pending',
      phase: 'proving',
      startedAt: Date.now(),
      quote: null,
      error: null
    }

    this.#operation = operation
    this.emitUpdate()

    return operation
  }

  /**
   * Replaces the operation with a later state of itself, unless it has been wiped or superseded
   * meanwhile - by a lock, most notably, which a proof or a broadcast in flight cannot notice.
   */
  #updateOperation(operation: PrivacyPoolsOperation): boolean {
    if (this.#operation?.id !== operation.id) return false

    this.#operation = operation

    return true
  }

  #isOperationInFlight() {
    return this.#operation?.status === 'pending' && this.#operation.phase !== 'ready'
  }

  dismissOperation() {
    // Only the one on screen, so another phrase's cannot be dismissed from here
    if (!this.operation || this.#isOperationInFlight()) return

    this.#operation = null
    this.#discardPending()
    this.emitUpdate()
  }

  /**
   * Proves a withdrawal without sending it.
   *
   * Split from broadcasting because the proof is the expensive half - ten seconds and up on a
   * desktop, usually twice over - and the fee is not known until the userOp is priced. Doing both
   * in one call would commit the user to a fee they never saw. This way the screen can show what
   * the withdrawal will actually cost before anything is sent.
   *
   * Sponsored by an ERC-4337 paymaster: a single-use sender derived from the phrase submits the
   * userOp, the paymaster pays its gas and takes a fee out of the withdrawn amount. Nothing the
   * user owns pays gas next to the recipient, and the recipient never needs ETH of its own.
   *
   * Not wrapped in `withStatus`: proving runs long with no way to abort, which is exactly the shape
   * `withStatus` must not wrap. Progress is reported through `operation`.
   */
  async prepareWithdrawal({
    chainId,
    tokenAddress,
    amount,
    recipient
  }: AssetRef & {
    chainId: string
    amount: bigint
    recipient: string
  }): Promise<void> {
    const seedId = this.#assertAvailableAndGetSeedId()
    const config = getPrivacyPoolsChainConfig(BigInt(chainId))
    if (!config) throw new Error(`privacyPools: unsupported chain ${chainId}`)

    const { paymaster } = config
    if (!paymaster)
      throw new EmittableError({
        message: 'Withdrawing from Privacy Pools is not available on this network yet.',
        level: 'expected',
        error: new Error(`privacyPools: no paymaster configured for chain ${chainId}`)
      })

    // One at a time, across phrases: only one proved withdrawal is ever kept, so a second would
    // silently replace the first one's proof while it is still being built.
    if (this.#isOperationInFlight())
      throw new EmittableError({
        message: 'Another withdrawal is still in progress. Please wait for it to finish.',
        level: 'expected',
        error: new Error('privacyPools: a withdrawal is already in flight')
      })

    this.#discardPending()

    const operation = this.#startOperation({
      seedId,
      chainId,
      tokenAddress,
      isNative: isPrivacyPoolsNativeAsset(tokenAddress),
      amount,
      recipient
    })

    try {
      await this.#assertPoolIsSponsored(chainId, tokenAddress)

      const protocol = await this.#getProtocol(chainId, seedId)

      // Pricing the gas, proving, and signing the userOp all happen inside this one call.
      const privateOp = await protocol.prepareUnshield(
        {
          asset: { __type: 'erc20', contract: toPrivacyPoolsAssetAddress(tokenAddress) },
          amount
        },
        recipient as any,
        { mode: 'paymaster' }
      )

      // The SDK types a prepared withdrawal as a union of relayer and paymaster ones. We only ever
      // ask for the paymaster mode, so anything else means the SDK ignored what we asked for.
      if (privateOp.mode !== 'paymaster')
        throw new Error('privacyPools: the withdrawal came back in an unsupported form')

      const { fee } = readPaymasterWithdrawal({
        withdrawal: privateOp.withdrawal,
        paymaster,
        recipient,
        amount
      })

      const isStillCurrent = this.#updateOperation({
        ...operation,
        phase: 'ready',
        quote: { feeAmount: fee, amountAfterFee: amount - fee }
      })
      // A proof that finished after a lock must not be kept for a withdrawal nobody can see.
      if (isStillCurrent) this.#pendingWithdrawal = privateOp
    } catch (error: any) {
      this.#failOperation(
        operation,
        toReadableWithdrawalError(error),
        'The withdrawal could not be prepared. Please try again.'
      )
    }

    this.emitUpdate()
  }

  /**
   * Refuses, before any proving, a token whose pool the paymaster has no adapter for.
   *
   * The SDK would refuse it too, but only after syncing - and with a sentence meant for developers.
   * The pool is read from the entrypoint rather than configured, so a pool replaced behind the
   * same token is caught here rather than trusted.
   */
  async #assertPoolIsSponsored(chainId: string, tokenAddress: string) {
    const config = getPrivacyPoolsChainConfig(BigInt(chainId))
    if (!config?.paymaster) throw new Error(`privacyPools: no paymaster for chain ${chainId}`)

    const { poolAddress } = await readEntrypointAssetConfig({
      provider: this.#getProvider(chainId),
      entrypointAddress: config.entrypointAddress,
      assetAddress: toPrivacyPoolsAssetAddress(tokenAddress)
    })

    if (config.paymaster.poolAdapters[poolAddress.toLowerCase()]) return

    const symbol = getPrivacyPoolsAsset(BigInt(chainId), tokenAddress)?.symbol || 'this token'
    throw new EmittableError({
      message: `Withdrawing ${symbol} from Privacy Pools is not supported yet.`,
      level: 'expected',
      error: new Error(`privacyPools: no paymaster adapter for pool ${poolAddress}`)
    })
  }

  /**
   * Sends the prepared withdrawal to the bundler and waits for it to land.
   *
   * The userOp is already signed, so this only forwards it. The pooled balance is refreshed either
   * way: a userOp can land after the wait for its receipt gives up, and the balance is what tells.
   */
  async broadcastWithdrawal(): Promise<void> {
    // The one on screen: a withdrawal of a phrase that is not can't be sent from here
    const operation = this.operation
    const privateOp = this.#pendingWithdrawal

    if (!operation || !privateOp)
      throw new EmittableError({
        message: 'There is no withdrawal ready to send.',
        level: 'expected',
        error: new Error('privacyPools: no prepared withdrawal')
      })

    this.#assertAvailableAndGetSeedId()
    const { seedId } = operation

    const entry: PrivacyPoolsActivityEntry = {
      id: operation.id,
      seedId,
      chainId: operation.chainId,
      type: 'withdraw',
      tokenAddress: operation.tokenAddress,
      isNative: operation.isNative,
      amount: operation.amount,
      recipient: operation.recipient,
      status: 'pending',
      createdAt: operation.startedAt
    }
    this.#activity.push(entry)

    this.#updateOperation({ ...operation, phase: 'broadcasting' })
    this.emitUpdate()

    // Sent once: the userOp's sender is single-use (nonce 0), so a retry of the same payload could
    // only fail - or duplicate one that did land. A failed send is prepared again from scratch.
    this.#discardPending()

    try {
      const host = this.#getHost(this.#getProvider(operation.chainId), seedId)
      // No relayers: a paymaster withdrawal goes to the bundler URL carried in the payload.
      const broadcaster = createPPv1Broadcaster(host, { broadcasterUrl: {} })
      const { txHash } = await broadcaster.broadcast(privateOp)

      this.#updateActivity(operation.id, {
        status: 'success',
        fee: operation.quote?.feeAmount,
        txnId: txHash
      })

      this.#updateOperation({ ...operation, status: 'success', phase: 'finalizing' })
      this.emitUpdate()
    } catch (error: any) {
      const message = this.#failOperation(
        { ...operation, phase: 'broadcasting' },
        error,
        'The withdrawal could not be sent. Please prepare it again.'
      )
      this.#updateActivity(operation.id, { status: 'failed', error: message })
    }

    await this.#persistActivity()

    // The note is spent and a change note took its place; nothing else reports that.
    await this.syncChain(operation.chainId)
  }

  /**
   * Drops a prepared withdrawal that was never sent.
   *
   * Worth doing explicitly rather than leaving it to be overwritten: the pending operation holds a
   * proof over a specific note, and keeping it around after the user has moved on invites sending
   * it later at a gas price that has since moved on.
   */
  #discardPending() {
    this.#pendingWithdrawal = null
  }

  /**
   * Only an `EmittableError` carries a sentence meant for the user. Anything else comes from the
   * SDK, the bundler or the chain, in words no user should have to read, so it is shown as the
   * fallback and kept as the underlying error.
   */
  #failOperation(operation: PrivacyPoolsOperation, error: any, fallback: string): string {
    const message = error instanceof EmittableError ? error.message : fallback

    this.#updateOperation({ ...operation, status: 'failed', error: message })
    this.emitError({
      message,
      level: 'major',
      error: error instanceof Error ? error : new Error('privacyPools: withdrawal failed')
    })

    return message
  }

  /**
   * The calls that reclaim an unapproved deposit, publicly, to the address that made it.
   *
   * The protocol's ragequit. It is the only way out for a deposit the association set has not
   * accepted, and it necessarily reveals the link between that deposit and the depositor - the
   * pool checks `depositors[label] == msg.sender`, so it cannot go anywhere else.
   */
  async buildReclaimCalls({
    chainId,
    labels
  }: {
    chainId: string
    labels: bigint[]
  }): Promise<Call[]> {
    const seedId = this.#assertAvailableAndGetSeedId()
    const protocol = await this.#getProtocol(chainId, seedId)

    const { txns } = await protocol.ragequit(labels)

    return txns.map((txn) => ({ to: txn.to, data: txn.data, value: txn.value }))
  }

  #updateActivity(id: string, update: Partial<PrivacyPoolsActivityEntry>) {
    this.#activity = this.#activity.map((entry) =>
      entry.id === id ? { ...entry, ...update } : entry
    )
  }

  async #persistActivity() {
    try {
      await this.#storage.set(PRIVACY_POOLS_ACTIVITY_STORAGE_KEY, this.#activity)
    } catch (error: any) {
      this.emitError({
        message: 'Could not save your Privacy Pools history on this device.',
        level: 'silent',
        error: error instanceof Error ? error : new Error('privacyPools: activity write failed')
      })
    }
  }

  #hasPhraseDerivedState() {
    return (
      !!this.#protocols.size ||
      !!this.#kohakuKeystores.size ||
      !!this.#syncJobs.size ||
      !!Object.keys(this.#notesByIdentity).length
    )
  }

  /**
   * Drops everything derived from any recovery phrase, on lock: nothing derived may stay in memory
   * once the phrases are out of reach.
   *
   * A sync already running cannot be stopped, so it is left to finish in the queue - `#generation`
   * makes it discard what it finds, and a sync asked for after unlocking waits behind it rather
   * than walking the same history in parallel.
   */
  #teardown() {
    this.#generation += 1
    this.#protocols.clear()
    this.#providerInstances.clear()
    this.#sagaHydratedKeys.clear()
    this.#protocolChainVersions.clear()
    this.#kohakuKeystores.clear()
    this.#syncJobs.clear()
    this.#pendingSyncsByChain.clear()
    this.#syncStatesByChain = {}
    this.#notesByIdentity = {}
    this.#operation = null
    this.#discardPending()
    this.emitUpdate()
  }

  destroy() {
    this.#unsubscribers.forEach((unsubscribe) => unsubscribe())
    this.#unsubscribers = []
    this.#teardown()
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      supportedChainIds: this.supportedChainIds,
      unavailableReason: this.unavailableReason,
      isAvailableForSelectedAccount: this.isAvailableForSelectedAccount,
      chains: this.chains,
      balances: this.balances,
      activity: this.activity,
      hasSyncedAnyChain: this.hasSyncedAnyChain,
      operation: this.operation
    }
  }
}
