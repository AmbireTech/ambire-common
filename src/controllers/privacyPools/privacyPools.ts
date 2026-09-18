import { formatUnits, Interface, JsonRpcProvider } from 'ethers'

import {
  createPPv1Broadcaster,
  OxBowAspService,
  PrivacyPoolsV1Protocol
} from '@kohaku-eth/privacy-pools'
import type { Host } from '@kohaku-eth/plugins'

import EmittableError from '../../classes/EmittableError'
import {
  fromPrivacyPoolsAssetAddress,
  getPrivacyPoolsAsset,
  getPrivacyPoolsChainConfig,
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
  PrivacyPoolsChainState,
  PrivacyPoolsChainSyncState,
  PrivacyPoolsNote,
  PrivacyPoolsOperation,
  PrivacyPoolsOperationPhase,
  PrivacyPoolsTokenBalance,
  PrivacyPoolsUnavailableReason,
  PrivacyPoolsWithdrawalMode
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
import { readEntrypointAssetConfig } from '../../libs/privacyPools/entrypointAssetConfig'
import { createRelayerClient, createSelfRelayClient } from '../../libs/privacyPools/relayerClient'
import { createGuardedRelayerClient } from '../../libs/privacyPools/relayerGuard'
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

  /** Entrypoint relay fee ceilings, keyed `chainId:assetAddress`. See `#getMaxRelayFeeBps`. */
  #maxRelayFeeBpsByAsset: Map<string, bigint> = new Map()

  /** The provider each plugin was built against, so a provider swap can invalidate it. */
  #providerInstances = new Map<string, JsonRpcProvider>()

  /**
   * The sync in flight per chain, so a second caller joins the first rather than starting a
   * parallel walk of the same pool. `sync()` is not cheap - a cold mainnet chain is hundreds of
   * sequential `eth_getLogs` calls.
   */
  #chainRuns = new Map<string, Promise<void>>()

  #syncStatesByChain: { [chainId: string]: PrivacyPoolsChainSyncState } = {}

  /** Notes per `${seedId}` then per chain, so switching accounts keeps each phrase's own view. */
  #notesByIdentity: {
    [seedId: string]: { [chainId: string]: { notes: PrivacyPoolsNote[]; lastSyncedAt: number } }
  } = {}

  #activity: PrivacyPoolsActivityEntry[] = []

  #seedId: string | null = null

  /**
   * The proved-but-unsent withdrawal. Private: it carries the proof and the relayer's signed
   * commitment, neither of which the UI needs - it reads the fee off `operation.quote`.
   */
  #pendingWithdrawal: Awaited<ReturnType<PrivacyPoolsV1Protocol['prepareUnshield']>> | null = null

  #proverFactory: () => Promise<any>

  #unsubscribers: (() => void)[] = []

  /**
   * The withdrawal on screen - the one in flight, or the last one until dismissed. Public because
   * proving takes ten seconds and up, and the UI has nothing else to show meanwhile.
   */
  operation: PrivacyPoolsOperation | null = null

  /**
   * The calls a self-relayed withdrawal is sent with, once prepared. Public because the wallet
   * signs and broadcasts them through the regular transaction flow, unlike a relayed withdrawal
   * which this controller sends itself.
   */
  selfRelayCalls: Call[] | null = null

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
    this.#buildCallsRequest = buildCallsRequest
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
        if (!this.#keystore.isUnlocked && this.#seedId) this.#teardown({ wipeNotes: true })

        this.propagateUpdate(forceEmit)
      }, 'privacyPools'),

      this.#selectedAccount.onUpdate((forceEmit) => {
        const seedId = this.#getSeedIdForSelectedAccount()
        // A different phrase means different notes, so nothing built for the previous one may be
        // reused - but its notes stay in their own bucket, so switching back shows them at once.
        if (this.#seedId && seedId !== this.#seedId) this.#teardown({ wipeNotes: false })

        this.propagateUpdate(forceEmit)
      }, 'privacyPools'),

      this.#providers.onUpdate((forceEmit) => {
        const staleKeys = [...this.#providerInstances.keys()].filter((key) => {
          const chainId = key.split(':')[0] as string
          return this.#providers.providers[chainId] !== this.#providerInstances.get(key)
        })

        staleKeys.forEach((key) => {
          this.#protocols.delete(key)
          this.#providerInstances.delete(key)
        })

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
    const identityChains = (this.#seedId && this.#notesByIdentity[this.#seedId]) || {}
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
    if (!this.#seedId) return []

    return this.#activity
      .filter((entry) => entry.seedId === this.#seedId)
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

    // Recorded so a later account switch can tell that the live plugins belong to another phrase.
    this.#seedId = seedId

    return seedId
  }

  #getHost(provider: JsonRpcProvider, seedId: string): Host {
    return {
      network: createKohakuNetwork(this.#fetch),
      storage: createKohakuStorage({
        storage: this.#storage,
        storageKey: 'privacyPoolsState',
        onError: (error, message) =>
          this.emitError({
            message:
              message || 'Privacy Pools could not save its progress. It will be rebuilt next time.',
            level: 'silent',
            error: error instanceof Error ? error : new Error('privacyPools: storage write failed')
          })
      }),
      keystore: createKohakuKeystore((path) => this.#keystore.derivePrivacyPoolsKey(seedId, path)),
      provider: createKohakuProvider(provider)
    }
  }

  #getProvider(chainId: string): JsonRpcProvider {
    const provider = this.#providers.providers[chainId]
    if (!provider) throw new Error(`privacyPools: no provider for chain ${chainId}`)

    return provider
  }

  #protocolKey(chainId: string, seedId: string, mode: PrivacyPoolsWithdrawalMode) {
    return `${chainId}:${seedId}:${mode}`
  }

  /**
   * The plugin for a chain and phrase.
   *
   * Split by withdrawal mode because the relayer client is fixed at construction and the two modes
   * need different ones - a real HTTP client for relayed withdrawals, a synthetic zero-fee quote
   * for self-relayed ones. Both instances hydrate from the same persisted store, so the second one
   * costs a deserialization rather than a rescan.
   */
  #getProtocol(
    chainId: string,
    seedId: string,
    mode: PrivacyPoolsWithdrawalMode = 'relayed'
  ): PrivacyPoolsV1Protocol {
    const key = this.#protocolKey(chainId, seedId, mode)
    const existing = this.#protocols.get(key)
    if (existing) return existing

    const config = getPrivacyPoolsChainConfig(BigInt(chainId))
    if (!config) throw new Error(`privacyPools: unsupported chain ${chainId}`)

    const provider = this.#getProvider(chainId)
    const host = this.#getHost(provider, seedId)
    // `quoteThunk` throws on an empty relayer map, so the self-relay path still needs one entry.
    // Its URL is never fetched - `createSelfRelayClient` ignores it.
    const relayers = mode === 'self' ? { 'Your wallet': 'self' } : config.relayers
    const relayerNameByUrl = new Map(Object.entries(relayers).map(([name, url]) => [url, name]))

    const protocol = new PrivacyPoolsV1Protocol(host, {
      accountIndex: PRIVACY_POOLS_ACCOUNT_INDEX,
      entrypoint: {
        address: BigInt(config.entrypointAddress),
        deploymentBlock: config.deploymentBlock
      },
      relayersList: relayers,
      proverFactory: this.#proverFactory,
      // 0xBow's API rather than the SDK's IPFS default, which depends on ipfs.io being up and on
      // the CID in the last on-chain root update still being pinned.
      aspServiceFactory: () =>
        new OxBowAspService({ network: host.network, aspUrl: config.aspUrl }),
      // The seam that lets us check a quote before proving against it - `prepareUnshield` quotes
      // and proves in one call and exposes nothing in between. See `relayerGuard`.
      // Cast confined to this boundary: `IRelayerClient` is not exported from the SDK, so the
      // guarded client is written against a matching shape declared in `relayerGuard`.
      relayerClientFactory: (() =>
        createGuardedRelayerClient({
          client: mode === 'self' ? createSelfRelayClient() : createRelayerClient(this.#fetch),
          relayerNameByUrl,
          getOnChainMaxRelayFeeBps: (asset) => this.#getMaxRelayFeeBps(chainId, asset),
          describeAmount: (asset, amount) => this.#describeAssetAmount(chainId, asset, amount),
          onRejected: (_relayerName, error) =>
            this.emitError({
              message: error.message,
              level: 'major',
              error
            })
        })) as any
    })

    this.#protocols.set(key, protocol)
    this.#providerInstances.set(key, provider)

    return protocol
  }

  /**
   * The entrypoint's relay fee ceiling for an asset, memoized per chain and asset.
   *
   * Memoized because it is operator configuration that changes about never, and it would otherwise
   * be read once per relayer on every quote round. Resolves null when the read fails, which turns
   * the check off for that attempt rather than blocking a withdrawal over an RPC hiccup - and the
   * failure is not cached, so the next attempt tries again.
   */
  async #getMaxRelayFeeBps(chainId: string, asset: bigint): Promise<bigint | null> {
    const assetAddress = `0x${asset.toString(16).padStart(40, '0')}`
    const key = `${chainId}:${assetAddress}`
    const cached = this.#maxRelayFeeBpsByAsset.get(key)
    if (cached !== undefined) return cached

    const config = getPrivacyPoolsChainConfig(BigInt(chainId))
    if (!config) return null

    try {
      const { maxRelayFeeBps } = await readEntrypointAssetConfig({
        provider: this.#getProvider(chainId),
        entrypointAddress: config.entrypointAddress,
        assetAddress
      })

      this.#maxRelayFeeBpsByAsset.set(key, maxRelayFeeBps)

      return maxRelayFeeBps
    } catch (error: any) {
      // Silent: the user is mid-withdrawal and this only costs them an earlier, clearer refusal -
      // the entrypoint still enforces the same ceiling itself.
      this.emitError({
        message: 'Could not read the withdrawal fee limit for this pool.',
        level: 'silent',
        error
      })

      return null
    }
  }

  /** Renders an SDK-side asset amount the way the rest of the wallet writes it, for messages. */
  #describeAssetAmount(chainId: string, asset: bigint, amount: bigint): string {
    const config = getPrivacyPoolsAsset(BigInt(chainId), fromPrivacyPoolsAssetAddress(asset))
    if (!config) return amount.toString()

    return `${formatUnits(amount, config.decimals)} ${config.symbol}`
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
   * Joinable rather than queued: a second caller awaits the run already in flight. A cold mainnet
   * sync is hundreds of sequential `eth_getLogs` calls, so two of them against the same chain
   * would double the RPC load to reach the same state.
   */
  async syncChain(chainId: string): Promise<void> {
    const seedId = this.#assertAvailableAndGetSeedId()
    const inFlight = this.#chainRuns.get(chainId)
    if (inFlight) return inFlight

    const run = this.#syncChain(chainId, seedId).finally(() => {
      this.#chainRuns.delete(chainId)
    })

    this.#chainRuns.set(chainId, run)

    return run
  }

  async #syncChain(chainId: string, seedId: string): Promise<void> {
    const hasSyncedBefore = !!this.#notesByIdentity[seedId]?.[chainId]?.lastSyncedAt

    this.#writeChainSyncState(chainId, {
      syncStatus: hasSyncedBefore ? 'syncing' : 'initializing',
      syncStartedAt: Date.now(),
      error: null
    })
    this.emitUpdate()

    try {
      const protocol = this.#getProtocol(chainId, seedId)

      await protocol.sync()

      // `notes` is optional on the plugin interface - it exists only when the plugin declares a
      // note type, which PPv1 does. Checked rather than asserted so a future SDK that drops it
      // fails with this sentence instead of a TypeError.
      if (!protocol.notes) throw new Error('privacyPools: plugin does not expose notes')

      const notes = await protocol.notes()

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

      this.#writeChainSyncState(chainId, {
        syncStatus: 'ready',
        syncStartedAt: null,
        error: null
      })
    } catch (error: any) {
      this.#writeChainSyncState(chainId, {
        syncStatus: 'idle',
        syncStartedAt: null,
        error: 'Could not load your Privacy Pools balance on this network. Please try again.'
      })

      this.emitError({
        message: 'Could not load your Privacy Pools balance. Please try again.',
        level: 'silent',
        error: error instanceof Error ? error : new Error('privacyPools: sync failed')
      })
    }

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

    const protocol = this.#getProtocol(chainId, seedId)

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
    chainId: string
    tokenAddress: string
    isNative: boolean
    amount: bigint
    recipient: string
    mode: PrivacyPoolsWithdrawalMode
  }): PrivacyPoolsOperation {
    const operation: PrivacyPoolsOperation = {
      id: generateUuid(),
      ...params,
      status: 'pending',
      phase: 'quoting',
      startedAt: Date.now(),
      quote: null,
      error: null
    }

    this.operation = operation
    this.emitUpdate()

    return operation
  }

  #setPhase(phase: PrivacyPoolsOperationPhase) {
    if (!this.operation) return

    this.operation = { ...this.operation, phase }
    this.emitUpdate()
  }

  dismissOperation() {
    if (this.operation?.status === 'pending' && this.operation.phase !== 'ready') return

    this.operation = null
    this.#discardPending()
    this.emitUpdate()
  }

  /**
   * Proves a withdrawal without sending it.
   *
   * Split from broadcasting because the proof is the expensive half - ten seconds on a desktop and
   * longer on weak hardware - and the fee is not known until the quote comes back. Doing both in
   * one call would either commit the user to a fee they never saw, or throw the proof away when a
   * relayer refuses the send. This way the screen can show what the withdrawal will actually cost,
   * and a failed broadcast can be retried against the work already done.
   *
   * Not wrapped in `withStatus`: proving runs long with no way to abort, which is exactly the shape
   * `withStatus` must not wrap. Progress is reported through `operation`.
   */
  async prepareWithdrawal({
    chainId,
    tokenAddress,
    amount,
    recipient,
    mode = 'relayed'
  }: AssetRef & {
    chainId: string
    amount: bigint
    recipient: string
    mode?: PrivacyPoolsWithdrawalMode
  }): Promise<void> {
    const seedId = this.#assertAvailableAndGetSeedId()
    const config = getPrivacyPoolsChainConfig(BigInt(chainId))
    if (!config) throw new Error(`privacyPools: unsupported chain ${chainId}`)

    this.#discardPending()

    const operation = this.#startOperation({
      chainId,
      tokenAddress,
      isNative: isPrivacyPoolsNativeAsset(tokenAddress),
      amount,
      recipient,
      mode
    })

    try {
      const protocol = this.#getProtocol(chainId, seedId, mode)

      // Quoting and proving happen inside this one call; the guard installed in
      // `relayerClientFactory` is what sits between them.
      this.#setPhase('proving')
      const privateOp = await protocol.prepareUnshield(
        {
          asset: { __type: 'erc20', contract: toPrivacyPoolsAssetAddress(tokenAddress) },
          amount
        },
        recipient as any
      )

      const { quote, relayerId } = privateOp.quoteData
      const feeBps = BigInt(quote.feeBPS)
      const feeAmount = (amount * feeBps) / 10000n

      this.#pendingWithdrawal = privateOp
      this.selfRelayCalls =
        mode === 'self'
          ? [
              {
                to: privateOp.txData.to,
                data: privateOp.txData.data,
                value: privateOp.txData.value
              }
            ]
          : null

      this.operation = {
        ...operation,
        phase: 'ready',
        quote: {
          relayerName: relayerId,
          feeBps,
          feeAmount,
          amountAfterFee: amount - feeAmount,
          expiresAt: quote.feeCommitment.expiration
        }
      }
    } catch (error: any) {
      this.#failOperation(
        operation,
        error,
        'The withdrawal could not be prepared. Please try again.'
      )
    }

    this.emitUpdate()
  }

  /**
   * Sends the prepared withdrawal.
   *
   * A relayed one goes to the relayer that quoted it - that is what lets the recipient be an
   * address which has never held ETH, since the relayer broadcasts and pays the gas, taking its fee
   * out of the withdrawn amount.
   *
   * A self-relayed one goes through the wallet's own signing flow instead, because
   * `Entrypoint.relay` accepts any sender. That costs one public link between the address paying
   * gas and the recipient, which is why it is the fallback rather than the default.
   */
  async broadcastWithdrawal(): Promise<void> {
    const operation = this.operation
    const privateOp = this.#pendingWithdrawal

    if (!operation || !privateOp)
      throw new EmittableError({
        message: 'There is no withdrawal ready to send.',
        level: 'expected',
        error: new Error('privacyPools: no prepared withdrawal')
      })

    const seedId = this.#assertAvailableAndGetSeedId()
    const config = getPrivacyPoolsChainConfig(BigInt(operation.chainId))
    if (!config) throw new Error(`privacyPools: unsupported chain ${operation.chainId}`)

    // Relayers sign a fee commitment that is good for 60 seconds, and this step waits on the user,
    // who may take longer than that to read the fee and decide. Sending a lapsed commitment is
    // refused by the relayer with an error of its own making, so it is caught here instead - the
    // proof is over a quote that no longer stands, so the withdrawal has to be prepared again.
    const expiresAt = operation.quote?.expiresAt
    if (operation.mode === 'relayed' && expiresAt && expiresAt <= Date.now()) {
      this.#discardPending()
      this.#failOperation(
        operation,
        new Error('privacyPools: relayer fee commitment expired before the user confirmed'),
        "The relayer's offer ran out while it was waiting for you. Please prepare the withdrawal again - nothing was sent and nothing was spent."
      )
      this.emitUpdate()

      return
    }

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
      createdAt: operation.startedAt,
      mode: operation.mode
    }
    this.#activity.push(entry)

    this.operation = { ...operation, phase: 'broadcasting' }
    this.emitUpdate()

    if (operation.mode === 'self') {
      const calls = this.selfRelayCalls
      const account = this.#selectedAccount.account

      try {
        if (!calls?.length) throw new Error('privacyPools: no self-relay calls prepared')
        if (!account) throw new Error('privacyPools: no selected account')

        await this.#buildCallsRequest({
          calls,
          meta: { chainId: BigInt(operation.chainId), accountAddr: account.addr }
        })

        // Handed off, not confirmed: the signing flow owns it from here, and the activity entry
        // resolves when the transaction it produces does.
        this.#discardPending()
        this.operation = { ...operation, status: 'success', phase: 'finalizing' }
        this.emitUpdate()
      } catch (error: any) {
        const message = this.#failOperation(
          operation,
          error,
          'The withdrawal could not be sent. You can try again.'
        )
        this.#updateActivity(operation.id, { status: 'failed', error: message })
      }

      await this.#persistActivity()

      return
    }

    try {
      const host = this.#getHost(this.#getProvider(operation.chainId), seedId)
      const broadcaster = createPPv1Broadcaster(host, { broadcasterUrl: config.relayers })
      const { txHash } = await broadcaster.broadcast(privateOp)

      this.#discardPending()
      this.#updateActivity(operation.id, {
        status: 'success',
        relayFee: operation.quote?.feeAmount,
        txnId: txHash
      })

      this.operation = { ...operation, status: 'success', phase: 'finalizing' }
      this.emitUpdate()

      // The note is spent and a change note took its place; nothing else reports that.
      await this.syncChain(operation.chainId)
    } catch (error: any) {
      // The proof is kept: the relayer refusing does not invalidate it, and re-proving would cost
      // the user another ten seconds for the same result.
      const message = this.#failOperation(
        operation,
        error,
        'The relayer could not send the withdrawal. You can try again.'
      )
      this.#updateActivity(operation.id, { status: 'failed', error: message })
    }

    await this.#persistActivity()
  }

  /**
   * Drops a prepared withdrawal that was never sent.
   *
   * Worth doing explicitly rather than leaving it to be overwritten: the pending operation holds a
   * proof over a specific note, and keeping it around after the user has moved on invites sending
   * it later against a quote that has since expired.
   */
  #discardPending() {
    this.#pendingWithdrawal = null
    this.selfRelayCalls = null
  }

  #failOperation(operation: PrivacyPoolsOperation, error: any, fallback: string): string {
    const message = error instanceof EmittableError ? error.message : error?.message || fallback

    this.operation = { ...operation, status: 'failed', error: message }
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
    const protocol = this.#getProtocol(chainId, seedId)

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

  /**
   * Drops everything derived from the recovery phrase. `wipeNotes` distinguishes a lock, where
   * nothing derived may stay in memory, from an account switch, where the previous phrase's notes
   * stay in their own bucket so switching back shows them at once.
   */
  #teardown({ wipeNotes }: { wipeNotes: boolean }) {
    this.#protocols.clear()
    this.#providerInstances.clear()
    this.#chainRuns.clear()
    this.#syncStatesByChain = {}

    if (wipeNotes) this.#notesByIdentity = {}

    this.#seedId = null
    this.operation = null
    this.#discardPending()
    this.emitUpdate()
  }

  destroy() {
    this.#unsubscribers.forEach((unsubscribe) => unsubscribe())
    this.#unsubscribers = []
    this.#teardown({ wipeNotes: true })
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
      hasSyncedAnyChain: this.hasSyncedAnyChain
    }
  }
}
