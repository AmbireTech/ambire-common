import { formatUnits, Interface, isAddress, JsonRpcProvider } from 'ethers'

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
  getPrivacyPoolsDepositAsset,
  getPrivacyPoolsStoreKey,
  isPrivacyPoolsNativeAsset,
  PRIVACY_POOLS_ACCOUNT_INDEX,
  PRIVACY_POOLS_ACCOUNTS_STORAGE_KEY,
  PRIVACY_POOLS_SUPPORTED_CHAIN_IDS,
  toPrivacyPoolsAssetAddress
} from '../../consts/privacyPools'
import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter'
import { IFeatureFlagsController } from '../../interfaces/featureFlags'
import { Fetch } from '../../interfaces/fetch'
import { IKeystoreController } from '../../interfaces/keystore'
import { INetworksController } from '../../interfaces/network'
import {
  IPrivacyPoolsController,
  PrivacyPoolsAccount,
  PrivacyPoolsDepositAssetConfig,
  PrivacyPoolsChainConfig,
  PrivacyPoolsChainHistory,
  PrivacyPoolsChainState,
  PrivacyPoolsChainSyncState,
  PrivacyPoolsIdentityChainState,
  PrivacyPoolsOperation,
  PrivacyPoolsPaymasterConfig,
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
import {
  describeKohakuDebugUserOperationGas,
  endKohakuDebugTrace,
  kohakuDebugCall,
  kohakuDebugPhase,
  readKohakuDebugTreeSizes,
  startKohakuDebugTrace,
  withKohakuDebugProver,
  withKohakuDebugTiming
} from '../../libs/privacyPools/kohakuDebug'
import { createProverFactory, PrivacyPoolsProverFactory } from '../../libs/privacyPools/prover'
import { createPrivacyPoolsDataService } from '../../libs/privacyPools/dataService'
import { encodePrivacyPoolsDeposit, readPrivacyPoolsDeposit } from '../../libs/privacyPools/deposit'
import { readEntrypointAssetConfig } from '../../libs/privacyPools/entrypointAssetConfig'
import { fetchPrivacyPoolsPrices } from '../../libs/privacyPools/prices'
import { readPaymasterWithdrawal } from '../../libs/privacyPools/paymasterWithdrawal'
import { toPrivacyPoolsSdkError } from '../../libs/privacyPools/sdkError'
import {
  PrivacyPoolsSerializedUserOperation,
  PrivacyPoolsWithdrawalFeeEstimate,
  estimatePaymasterWithdrawalFee
} from '../../libs/privacyPools/estimateWithdrawal'
import { ZERO_ADDRESS } from '../../services/socket/constants'
import { generateUuid } from '../../utils/uuid'
import { withTimeout } from '../../utils/with-timeout'
import EventEmitter from '../eventEmitter/eventEmitter'

/** How long a broadcast deposit blocks another into the same account. See `#broadcastDeposits`. */
const DEPOSIT_CONFIRMATION_WINDOW_MS = 15 * 60 * 1000

const PRICES_MAX_AGE_MS = 5 * 60 * 1000

/** A chain read more recently than this is not read again when the account is opened. */
const SYNC_MAX_AGE_MS = 10 * 60 * 1000

/** After this, a proved withdrawal is shown with only its fee cap. */
const WITHDRAWAL_ESTIMATION_TIMEOUT_MS = 8 * 1000

const readDepositPrecommitment = (data: string): bigint | null =>
  readPrivacyPoolsDeposit({ data, value: 0n })?.precommitment ?? null

const ERC20_INTERFACE = new Interface([
  'function approve(address spender, uint256 amount)',
  'function allowance(address owner, address spender) view returns (uint256)'
])

/**
 * A token by its wallet address - `ZERO_ADDRESS` for native. Nativeness is derived from it, not
 * passed alongside, so the two can never disagree.
 */
type AssetRef = { tokenAddress: string }

/**
 * A paymaster-sponsored withdrawal: an ERC-4337 userOp signed by its single-use sender. Narrowed
 * from the `prepareUnshield` union, as the SDK does not export the variant.
 */
type PreparedPaymasterWithdrawal = Extract<
  Awaited<ReturnType<PrivacyPoolsV1Protocol['prepareUnshield']>>,
  { mode: 'paymaster' }
>

/** The SDK's prover factory type, which it does not export. */
type SdkProverFactory = NonNullable<
  ConstructorParameters<typeof PrivacyPoolsV1Protocol>[1]['proverFactory']
>

/**
 * The SDK's error when the paymaster fee exceeds the withdrawn amount. Matched by wording: it has
 * no code, and arrives as a plain object (see `toPrivacyPoolsSdkError`).
 */
const FEE_ABOVE_AMOUNT_SDK_MESSAGE = 'Withdrawal amount too small to cover the sponsored gas fee'

/** Makes the fee-above-amount SDK error readable; passes anything else through as an `Error`. */
const toReadableWithdrawalError = (error: unknown) => {
  const sdkError = toPrivacyPoolsSdkError(error, 'privacyPools: withdrawal failed')
  if (!sdkError.message.includes(FEE_ABOVE_AMOUNT_SDK_MESSAGE)) return sdkError

  return new EmittableError({
    message:
      'This amount is too small to cover the network fee for sending it. Please try a larger amount.',
    level: 'expected',
    error: sdkError
  })
}

/**
 * Privacy Pools state: one plugin per (chain, recovery phrase) and its notes. Scoped by phrase, as note secrets are derived from it - accounts without one (hardware,
 * private key, view-only) cannot use Privacy Pools.
 */
export class PrivacyPoolsController extends EventEmitter implements IPrivacyPoolsController {
  #keystore: IKeystoreController

  #featureFlags: IFeatureFlagsController

  #networks: INetworksController

  #providers: IProvidersController

  #selectedAccount: ISelectedAccountController

  #storage: IStorageController

  #fetch: Fetch

  /**
   * Shared by all plugins: the adapter caches the whole blob and rewrites it on every save, so
   * per-plugin adapters (two phrases) would overwrite each other's progress.
   */
  #kohakuStorage: Storage

  /** Lets the selection move off a removed account. Also fired when a phrase is deleted. */
  #onAccountsRemoved: (seedIds: string[]) => Promise<void>

  /** Per `${chainId}:${seedId}`: a plugin binds one chain's provider to one phrase's secrets. */
  #protocols = new Map<string, PrivacyPoolsV1Protocol>()

  /** The provider each plugin was built against, so a provider swap can invalidate it. */
  #providerInstances = new Map<string, JsonRpcProvider>()

  /** Live plugins that read pool history from the CDN. See `#dropSagaHydratedProtocols`. */
  #sagaHydratedKeys = new Set<string>()

  /** Per phrase, outliving its plugins, so a rebuilt plugin skips re-deriving keys (pbkdf2). */
  #kohakuKeystores = new Map<string, Keystore>()

  /**
   * Runs syncs one at a time across all chains and phrases. The pools' history is the same for
   * every phrase on a chain: the first sync reads and persists it, later ones read only new blocks.
   * In parallel each would walk the whole history.
   */
  #syncQueue: Promise<void> = Promise.resolve()

  /** The queued or running sync per `${chainId}:${seedId}`, so asking again joins it. */
  #syncJobs = new Map<string, Promise<void>>()

  /** Queued or running syncs per chain. It reads as syncing, for every phrase, while any is. */
  #pendingSyncsByChain = new Map<string, number>()

  #syncStatesByChain: { [chainId: string]: PrivacyPoolsChainSyncState } = {}

  /** Per chain, kept through a lock - see `PrivacyPoolsChainHistory`. */
  #chainHistories: { [chainId: string]: PrivacyPoolsChainHistory } = {}

  /**
   * Bumped whenever a sync persists a chain's history. A plugin reads the store only when built, so
   * an older one would re-read blocks another phrase's sync already read. See `#getProtocol`.
   */
  #chainVersions = new Map<string, number>()

  /** The chain version each live plugin's in-memory state matches. */
  #protocolChainVersions = new Map<string, number>()

  /** Bumped on every lock, so a sync that cannot be aborted does not write back wiped notes. */
  #generation = 0

  #notesByIdentity: {
    [seedId: string]: { [chainId: string]: PrivacyPoolsIdentityChainState }
  } = {}

  /**
   * The next deposit's precommitment per `${chainId}:${seedId}` and the sync epoch it was derived
   * after (null while that sync runs). See `#getNextDepositPrecommitment`.
   */
  #nextDepositPrecommitments = new Map<
    string,
    { derivation: Promise<bigint>; epoch: number | null }
  >()

  /** Completed syncs per `${chainId}:${seedId}`. A precommitment is valid until the next one. */
  #syncEpochs = new Map<string, number>()

  /** Deposits `buildDepositCalls` prepared, by precommitment, so a broadcast can be recognised. */
  #preparedDeposits = new Map<bigint, { seedId: string; chainId: string }>()

  /**
   * Broadcast time per precommitment. A second deposit before the first lands would reuse its
   * precommitment, which the entrypoint rejects - so it is refused for a fixed window rather than
   * until seen on chain, which a never-landing broadcast would block forever.
   */
  #broadcastDeposits = new Map<bigint, number>()

  /** The proved-but-unsent withdrawal. Private: it holds the proof and the signed userOp. */
  #pendingWithdrawal: PreparedPaymasterWithdrawal | null = null

  #proverFactory: PrivacyPoolsProverFactory

  #unsubscribers: (() => void)[] = []

  /** The selected Privacy Pools account the UI last heard of. See `#subscribeToDependencies`. */
  #selectedAccountId: string | null = null

  /** Entrypoint deposit requirements per `${chainId}:${tokenAddress}` (lowercase), read once. */
  depositAssetConfigs: { [key: string]: PrivacyPoolsDepositAssetConfig } = {}

  /**
   * USD prices of the pools' assets, keyed by `getPrivacyPoolsPriceKey`. Not from the portfolio,
   * which has no selected account while a Privacy Pools account is selected.
   */
  prices: { [priceKey: string]: number } = {}

  #pricesFetchedAt = 0

  #pricesRequest: Promise<void> | null = null

  /** At most one per stored recovery phrase, and removed with it. */
  accounts: PrivacyPoolsAccount[] = []

  /** The latest withdrawal of any phrase. Exposed through `operation`. */
  #operation: PrivacyPoolsOperation | null = null

  initialLoadPromise?: Promise<void>

  constructor({
    keystore,
    featureFlags,
    networks,
    providers,
    selectedAccount,
    storage,
    fetch,
    circuitsBaseUrl,
    proverFactory,
    onAccountsRemoved,
    eventEmitterRegistry
  }: {
    keystore: IKeystoreController
    featureFlags: IFeatureFlagsController
    networks: INetworksController
    providers: IProvidersController
    selectedAccount: ISelectedAccountController
    storage: IStorageController
    fetch: Fetch
    /** Where the circuit artifacts are served from, as only the platform knows it. */
    circuitsBaseUrl: string
    /**
     * Proves outside this context (the extension's multi-threaded offscreen document). Absent,
     * proofs run here from `circuitsBaseUrl`.
     */
    proverFactory?: PrivacyPoolsProverFactory
    onAccountsRemoved: (seedIds: string[]) => Promise<void>
    eventEmitterRegistry?: IEventEmitterRegistryController
  }) {
    super(eventEmitterRegistry)
    this.#keystore = keystore
    this.#featureFlags = featureFlags
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
    this.#onAccountsRemoved = onAccountsRemoved
    this.#proverFactory = withKohakuDebugProver(
      proverFactory ?? createProverFactory(circuitsBaseUrl)
    )

    // Cleared when done so the resolved promise isn't carried in the state sent to the UI.
    this.initialLoadPromise = this.#load().finally(() => {
      this.initialLoadPromise = undefined
    })
  }

  async #load() {
    // What `supportedChainIds` and `unavailableReason` read, or the UI briefly shows unavailable
    await this.#networks.initialLoadPromise
    await this.#providers.initialLoadPromise
    await this.#keystore.initialLoadPromise
    await this.#selectedAccount.initialLoadPromise

    this.accounts = await this.#storage.get(PRIVACY_POOLS_ACCOUNTS_STORAGE_KEY, [])
    // Phrases deleted while this controller was not running
    await this.#forgetAccountsOfDeletedSeeds()

    this.#subscribeToDependencies()
    this.emitUpdate()
  }

  /**
   * Each subscription invalidates a plugin or changes what the getters report. Updates are passed
   * on only when they can change what this reports, as selected account and networks update often.
   */
  #subscribeToDependencies() {
    this.#selectedAccountId = this.#selectedAccount.privacyPoolsAccountId

    this.#unsubscribers.push(
      this.#keystore.onUpdate((forceEmit) => {
        // Nothing derived from the phrase, notes included, may outlive the lock
        if (!this.#keystore.isUnlocked && this.#hasPhraseDerivedState()) this.#teardown()

        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.#forgetAccountsOfDeletedSeeds()

        this.#propagateIfHasAccounts(forceEmit)
      }, 'privacyPools'),

      // Switching accounts drops nothing: each phrase keeps its plugins and notes, and a running
      // sync of the previous one still warms the chain's history
      this.#selectedAccount.onUpdate((forceEmit) => {
        const selectedAccountId = this.#selectedAccount.privacyPoolsAccountId
        if (selectedAccountId === this.#selectedAccountId) return

        this.#selectedAccountId = selectedAccountId
        this.propagateUpdate(forceEmit)
      }, 'privacyPools'),

      this.#providers.onUpdate((forceEmit) => {
        const staleKeys = [...this.#providerInstances.keys()].filter((key) => {
          const chainId = key.split(':')[0] as string
          return this.#providers.providers[chainId] !== this.#providerInstances.get(key)
        })

        staleKeys.forEach((key) => this.#dropProtocol(key))

        this.#propagateIfHasAccounts(forceEmit)
      }, 'privacyPools'),

      // Only so `supportedChainIds` and what derives from it reach the UI
      this.#networks.onUpdate(
        (forceEmit) => this.#propagateIfHasAccounts(forceEmit),
        'privacyPools'
      ),

      this.#featureFlags.onUpdate((forceEmit) => {
        if (!this.#featureFlags.isFeatureEnabled('tokenPrices')) this.#dropPrices()

        this.#propagateIfHasAccounts(forceEmit)
      }, 'privacyPools')
    )
  }

  /** Without a Privacy Pools account, nothing this controller reports depends on the others. */
  #propagateIfHasAccounts(forceEmit?: boolean) {
    if (this.accounts.length) this.propagateUpdate(forceEmit)
  }

  /** The SDK's supported chains, narrowed to the user's networks that have a provider. */
  get supportedChainIds(): string[] {
    return PRIVACY_POOLS_SUPPORTED_CHAIN_IDS.map((chainId) => chainId.toString()).filter(
      (chainId) =>
        this.#networks.networks.some((network) => network.chainId.toString() === chainId) &&
        !!this.#providers.providers[chainId]
    )
  }

  get unavailableReason(): PrivacyPoolsUnavailableReason | null {
    // Before 'locked', which unlocking would not fix while these hold
    if (!this.#getSelectedSeedId()) return 'no-account'
    if (!this.supportedChainIds.length) return 'unsupported-network'
    if (!this.#keystore.isUnlocked) return 'locked'

    return null
  }

  get isAvailableForSelectedAccount(): boolean {
    return !this.unavailableReason
  }

  /** Per chain: the chain's sync state merged with the selected phrase's last read of it. */
  get chains(): { [chainId: string]: PrivacyPoolsChainState } {
    const identityChains = this.#getSelectedIdentityChains()
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
        const history = this.#chainHistories[chainId] || {
          isInitialSyncDone: null,
          initialSyncDuration: null
        }
        const identity = identityChains[chainId]

        return [
          chainId,
          {
            chainId,
            ...sync,
            ...history,
            lastSyncedAt: identity?.lastSyncedAt ?? null,
            lastSyncDuration: identity?.lastSyncDuration ?? null
          }
        ]
      })
    )
  }

  /**
   * The withdrawal in flight, or the last one until dismissed. Hidden, not dropped, while another
   * phrase is selected: it cannot be stopped mid-proof, and switching back must show it.
   */
  get operation(): PrivacyPoolsOperation | null {
    if (this.#operation?.seedId !== this.#getSelectedSeedId()) return null

    return this.#operation
  }

  /** Whether any chain has completed a scan for the selected phrase. */
  get hasSyncedAnyChain(): boolean {
    return Object.values(this.chains).some((chain) => !!chain.lastSyncedAt)
  }

  /**
   * One row per token per chain. Only `approvedAmount` can be withdrawn; the rest awaits the
   * association set and can only be reclaimed publicly.
   */
  get balances(): { [chainId: string]: PrivacyPoolsTokenBalance[] } {
    const identityChains = this.#getSelectedIdentityChains()

    return Object.fromEntries(
      Object.keys(this.chains).map((chainId) => {
        const byToken = new Map<string, PrivacyPoolsTokenBalance>()

        ;(identityChains[chainId]?.notes || []).forEach((note) => {
          const key = note.tokenAddress.toLowerCase()
          const asset = getPrivacyPoolsAsset(BigInt(chainId), key)
          const entry = byToken.get(key) || {
            tokenAddress: key,
            // A pool added before we list it: show the raw amount rather than hide the balance
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

  /** The selected Privacy Pools account's phrase, or null if none or its account/phrase is gone. */
  #getSelectedSeedId(): string | null {
    const seedId = this.#selectedAccount.privacyPoolsAccountId
    if (!seedId) return null
    if (!this.accounts.some((account) => account.seedId === seedId)) return null
    if (!this.#keystore.seeds.some((seed) => seed.id === seedId)) return null

    return seedId
  }

  #getSelectedIdentityChains(): { [chainId: string]: PrivacyPoolsIdentityChainState } {
    const seedId = this.#getSelectedSeedId()

    return (seedId && this.#notesByIdentity[seedId]) || {}
  }

  #assertAvailableAndGetSeedId(): string {
    const reason = this.unavailableReason

    if (reason === 'no-account')
      throw new EmittableError({
        message: 'Please select a Privacy Pools account first.',
        level: 'expected',
        error: new Error('privacyPools: no Privacy Pools account selected')
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

    const seedId = this.#getSelectedSeedId()
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
      storage: withKohakuDebugTiming(this.#kohakuStorage, 'storage'),
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
      kohakuDebugCall(
        'keystore.deriveKey',
        () => this.#keystore.derivePrivacyPoolsKey(seedId, path),
        {
          quiet: true
        }
      )
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

  /** Rebuilt when another phrase's sync persisted newer history since, to start from that. */
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
      // Skipped once this chain has a persisted store
      initialState: this.#resolveInitialState,
      dataService: withKohakuDebugTiming(dataService, 'dataService'),
      entrypoint: {
        address: BigInt(config.entrypointAddress),
        deploymentBlock: config.deploymentBlock
      },
      // The SDK types it as the circuits package's whole `Prover`, but only ever calls `prove`
      proverFactory: this.#proverFactory as SdkProverFactory,
      // Not the SDK's IPFS default, which needs ipfs.io up and the last root update's CID pinned
      aspServiceFactory: () =>
        withKohakuDebugTiming(
          new OxBowAspService({ network: host.network, aspUrl: config.aspUrl }),
          'aspService'
        ),
      // Not the SDK's built-in table: withdrawals are built with the adapters
      // `readPaymasterWithdrawal` checks, and reach the bundler with our key. Empty without a
      // paymaster, so the SDK refuses rather than falls back to its table.
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
   * Starts a cold chain's entrypoint walk at its deployment block instead of block zero (22M blocks
   * of `eth_getLogs` before the first event). Pools are left empty, so they are read in full.
   */
  #resolveInitialState = async (): Promise<Record<string, any>> =>
    PRIVACY_POOLS_SUPPORTED_CHAIN_IDS.reduce((state, chainId) => {
      const config = getPrivacyPoolsChainConfig(chainId)
      if (!config) return state

      return {
        ...state,
        [getPrivacyPoolsStoreKey(config)]: {
          sync: { lastSyncedBlock: `0x${config.deploymentBlock.toString(16)}` }
        }
      }
    }, {})

  /**
   * The CDN only for a cold chain: its reader replays a pool's whole history on every call,
   * ignoring the start block. A warm chain reads new blocks from the provider. See
   * `#dropSagaHydratedProtocols`.
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
      // The shared adapter, not the raw store, so another phrase's in-flight save counts
      return !(await this.#kohakuStorage.get(getPrivacyPoolsStoreKey(config)))
    } catch {
      // Treated as cold: reading from the CDN is the cheaper way to be wrong
      return true
    }
  }

  /**
   * Drops plugins that hydrated a chain from the CDN, whose reader would re-download the whole
   * history on every sync. Their replacements start from the persisted store.
   */
  #dropSagaHydratedProtocols(chainId: string) {
    this.#sagaHydratedKeys.forEach((key) => {
      if (key.startsWith(`${chainId}:`)) this.#dropProtocol(key)
    })
  }

  #writeChainHistory(chainId: string, update: Partial<PrivacyPoolsChainHistory>) {
    this.#chainHistories[chainId] = {
      ...(this.#chainHistories[chainId] || { isInitialSyncDone: null, initialSyncDuration: null }),
      ...update
    }
  }

  /**
   * Looks up once per chain whether its history was read on this device, so a queued sync can
   * already show the long first read is ahead.
   */
  async #lookUpInitialSync(chainId: string) {
    if (typeof this.#chainHistories[chainId]?.isInitialSyncDone === 'boolean') return

    const config = getPrivacyPoolsChainConfig(BigInt(chainId))
    if (!config) return

    const isChainCold = await this.#isChainCold(config)
    // A sync that ran meanwhile has set it, and may have read the chain since
    if (typeof this.#chainHistories[chainId]?.isInitialSyncDone === 'boolean') return

    this.#writeChainHistory(chainId, { isInitialSyncDone: !isChainCold })
    this.emitUpdate()
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
   * Reads a chain's notes for the selected phrase. Queued (see `#syncQueue`), and a repeat call for
   * the same chain and phrase joins the queued or running one.
   */
  async syncChain(chainId: string): Promise<void> {
    const seedId = this.#assertAvailableAndGetSeedId()
    // Prices are refreshed along with balances
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.#refreshPrices()

    return this.#queueSync(chainId, seedId)
  }

  /** Refetches stale prices, one request at a time, unless token prices are opted out of. */
  async #refreshPrices() {
    if (!this.#featureFlags.isFeatureEnabled('tokenPrices')) return
    if (this.#pricesRequest || Date.now() - this.#pricesFetchedAt < PRICES_MAX_AGE_MS) return

    this.#pricesRequest = (async () => {
      try {
        const prices = await fetchPrivacyPoolsPrices({
          fetch: this.#fetch,
          networks: this.#networks.networks.filter(({ chainId }) =>
            this.supportedChainIds.includes(chainId.toString())
          )
        })
        // Opted out while the request was in flight
        if (!this.#featureFlags.isFeatureEnabled('tokenPrices')) return

        this.prices = prices
        this.#pricesFetchedAt = Date.now()
        this.emitUpdate()
      } catch (error: any) {
        // Previous prices, if any, stay
        this.emitError({
          level: 'silent',
          message: 'Could not load the prices of what is in Privacy Pools.',
          error: error instanceof Error ? error : new Error('privacyPools: prices request failed')
        })
      } finally {
        this.#pricesRequest = null
      }
    })()

    await this.#pricesRequest
  }

  #dropPrices() {
    this.prices = {}
    this.#pricesFetchedAt = 0
  }

  /** Like `syncChain`, for any phrase, not only the selected one. */
  #queueSync(chainId: string, seedId: string): Promise<void> {
    const jobKey = this.#protocolKey(chainId, seedId)
    const existingJob = this.#syncJobs.get(jobKey)
    if (existingJob) return existingJob

    const generation = this.#generation

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.#lookUpInitialSync(chainId)

    this.#pendingSyncsByChain.set(chainId, (this.#pendingSyncsByChain.get(chainId) || 0) + 1)
    // At once, so a sync waiting its turn already reads as under way
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
   * Resolves with the error to show for the chain, or null. Never rejects, so a failure does not
   * break the queue.
   */
  async #runSync(chainId: string, seedId: string, generation: number): Promise<string | null> {
    // Locked while this waited its turn
    if (generation !== this.#generation) return null

    const config = getPrivacyPoolsChainConfig(BigInt(chainId))
    const isChainCold = !!config && (await this.#isChainCold(config))
    const startedAt = Date.now()

    // 'initializing' is the chain's first read (minutes), whichever phrase triggers it. A phrase
    // new to an already read chain only reads the tail.
    this.#writeChainSyncState(chainId, {
      syncStatus: isChainCold ? 'initializing' : 'syncing',
      syncStartedAt: startedAt,
      error: null
    })
    this.#writeChainHistory(chainId, { isInitialSyncDone: !isChainCold })
    this.emitUpdate()

    const debugTrace = startKohakuDebugTrace('sync', { chainId, isChainCold })

    try {
      const protocol = await kohakuDebugPhase(debugTrace, 'getProtocol', () =>
        this.#getProtocol(chainId, seedId)
      )

      // Optional on the plugin interface; checked so an SDK that drops it fails clearly
      if (!protocol.notes) throw new Error('privacyPools: plugin does not expose notes')

      // The plugin syncs before every read, costing seconds even with no new blocks, so a
      // `sync()` first would pay twice
      const notes = await kohakuDebugPhase(debugTrace, 'sdk.notes (sync)', () => protocol.notes!())
      const syncDuration = Date.now() - startedAt
      endKohakuDebugTrace(debugTrace, {
        chainId,
        isChainCold,
        notes: notes.length,
        approvedNotes: notes.filter((note) => note.approved).length,
        treeSizes: readKohakuDebugTreeSizes(() => protocol.dumpState())
      })

      // Even if locked since: the history is the chain's, not the phrase's
      if (isChainCold)
        this.#writeChainHistory(chainId, {
          isInitialSyncDone: true,
          initialSyncDuration: syncDuration
        })

      // Nothing derived from the phrase is written back after a lock or account removal
      if (generation !== this.#generation) return null
      if (!this.accounts.some((account) => account.seedId === seedId)) return null

      this.#notesByIdentity[seedId] = {
        ...(this.#notesByIdentity[seedId] || {}),
        [chainId]: {
          lastSyncedAt: Date.now(),
          lastSyncDuration: syncDuration,
          notes: notes.map((note) => ({
            label: note.label,
            tokenAddress: fromPrivacyPoolsAssetAddress(note.assetAddress),
            amount: note.balance,
            approval: note.approved ? 'approved' : 'pending'
          }))
        }
      }

      // A deposit may have landed, which moves the next one's precommitment on
      const syncKey = this.#protocolKey(chainId, seedId)
      this.#syncEpochs.set(syncKey, (this.#syncEpochs.get(syncKey) || 0) + 1)

      // Other phrases' plugins on this chain are now behind the store; this one is at it
      const chainVersion = (this.#chainVersions.get(chainId) || 0) + 1
      this.#chainVersions.set(chainId, chainVersion)
      this.#protocolChainVersions.set(this.#protocolKey(chainId, seedId), chainVersion)

      this.#dropSagaHydratedProtocols(chainId)

      return null
    } catch (error: any) {
      endKohakuDebugTrace(debugTrace, { chainId, failed: String(error?.message || error) })
      if (generation !== this.#generation) return null

      this.emitError({
        message: 'Could not load your Privacy Pools balance. Please try again.',
        level: 'silent',
        error: error instanceof Error ? error : new Error('privacyPools: sync failed')
      })

      return 'Could not load your Privacy Pools balance on this network. Please try again.'
    }
  }

  /** The chain keeps reading as syncing until its last queued sync finishes. */
  #settleChainSync(chainId: string, generation: number, error: string | null) {
    // The superseding lock already reset everything this would settle
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

  /**
   * Syncs every supported chain for the selected phrase, however fresh (a refresh).
   *
   * Not in `withStatus`, which refuses a call while the previous one runs: a first read takes
   * minutes, and another account opened meanwhile must still queue its sync. Progress is per chain,
   * through `chains`.
   */
  async sync(): Promise<void> {
    try {
      await Promise.all(this.supportedChainIds.map((chainId) => this.syncChain(chainId)))
    } catch (error: any) {
      this.#emitSyncError(error)
    }
  }

  /**
   * On opening the account, syncs chains older than `SYNC_MAX_AGE_MS`. Not in `withStatus`, as
   * `sync`. Skipped until the phrase, the only way to recover the account, is backed up: the
   * dashboard asks for it before the minutes-long first read.
   */
  async syncIfStale(): Promise<void> {
    try {
      const seedId = this.#assertAvailableAndGetSeedId()
      if (this.#keystore.seeds.find(({ id }) => id === seedId)?.notBackedUp) return

      const identityChains = this.#notesByIdentity[seedId] || {}
      const staleChainIds = this.supportedChainIds.filter((chainId) => {
        const lastSyncedAt = identityChains[chainId]?.lastSyncedAt

        return !lastSyncedAt || Date.now() - lastSyncedAt >= SYNC_MAX_AGE_MS
      })

      await Promise.all(staleChainIds.map((chainId) => this.syncChain(chainId)))
    } catch (error: any) {
      this.#emitSyncError(error)
    }
  }

  #emitSyncError(error: any) {
    if (error instanceof EmittableError) {
      this.emitError(error)
      return
    }

    this.emitError({
      message: 'Could not load your Privacy Pools balance. Please try again.',
      level: 'major',
      error: error instanceof Error ? error : new Error('privacyPools: sync failed')
    })
  }

  /**
   * Builds the deposit calls from a wallet account into a Privacy Pools account, for the regular
   * signing flow. Tracked only once broadcast - see `onAccountOpBroadcast`. Deposits are public:
   * the pool stores and emits the sender's address.
   */
  async buildDepositCalls({
    seedId,
    accountAddr,
    chainId,
    tokenAddress,
    amount
  }: AssetRef & {
    /** The Privacy Pools account receiving the funds. */
    seedId: string
    /** The wallet account sending them. */
    accountAddr: string
    chainId: string
    amount: bigint
  }): Promise<Call[]> {
    await this.initialLoadPromise

    if (!this.accounts.some((account) => account.seedId === seedId))
      throw new EmittableError({
        message: 'This Privacy Pools account is no longer in your wallet.',
        level: 'expected',
        error: new Error(`privacyPools: no account for seed ${seedId}`)
      })

    if (!this.#keystore.isUnlocked)
      throw new EmittableError({
        message: 'Please unlock your wallet to send to a Privacy Pools account.',
        level: 'expected',
        error: new Error('privacyPools: keystore locked')
      })

    const config = getPrivacyPoolsChainConfig(BigInt(chainId))
    if (!config || !this.supportedChainIds.includes(chainId))
      throw new EmittableError({
        message: 'Privacy Pools accounts cannot receive funds on this network.',
        level: 'expected',
        error: new Error(`privacyPools: unsupported chain ${chainId}`)
      })

    const asset = getPrivacyPoolsDepositAsset(BigInt(chainId), tokenAddress)
    if (!asset)
      throw new EmittableError({
        message: 'This token cannot be sent to a Privacy Pools account.',
        level: 'expected',
        error: new Error(`privacyPools: unsupported asset ${tokenAddress} on chain ${chainId}`)
      })

    if (amount > asset.maxDeposit)
      throw new EmittableError({
        message: `A Privacy Pools account accepts at most ${formatUnits(
          asset.maxDeposit,
          asset.decimals
        )} ${asset.symbol} at a time.`,
        level: 'expected',
        error: new Error('privacyPools: deposit above the operator ceiling')
      })

    const { minimumDepositAmount } = await this.loadDepositAssetConfig(chainId, tokenAddress)
    if (amount < minimumDepositAmount)
      throw new EmittableError({
        message: `A Privacy Pools account accepts at least ${formatUnits(
          minimumDepositAmount,
          asset.decimals
        )} ${asset.symbol} at a time.`,
        level: 'expected',
        error: new Error('privacyPools: deposit below the entrypoint minimum')
      })

    const precommitment = await this.#getNextDepositPrecommitment(chainId, seedId)

    if (this.#isDepositAwaitingChain(precommitment))
      throw new EmittableError({
        message:
          'Your previous transfer to this Privacy Pools account is still being confirmed. Please try again once it is.',
        level: 'expected',
        error: new Error('privacyPools: the next precommitment is still in a pending deposit')
      })

    this.#preparedDeposits.set(precommitment, { seedId, chainId })

    const depositCall: Call = {
      to: config.entrypointAddress,
      ...encodePrivacyPoolsDeposit({
        isNative: asset.isNative,
        assetAddress: asset.address,
        amount,
        precommitment
      })
    }

    if (asset.isNative) return [depositCall]

    return [...(await this.#approvalCallIfNeeded(chainId, asset, amount, accountAddr)), depositCall]
  }

  /** Reads the entrypoint's deposit requirements for an asset once, into `depositAssetConfigs`. */
  async loadDepositAssetConfig(
    chainId: string,
    tokenAddress: string
  ): Promise<PrivacyPoolsDepositAssetConfig> {
    const key = `${chainId}:${tokenAddress.toLowerCase()}`
    const loaded = this.depositAssetConfigs[key]
    if (loaded) return loaded

    const config = getPrivacyPoolsChainConfig(BigInt(chainId))
    if (!config) throw new Error(`privacyPools: unsupported chain ${chainId}`)

    try {
      const { minimumDepositAmount } = await readEntrypointAssetConfig({
        provider: this.#getProvider(chainId),
        entrypointAddress: config.entrypointAddress,
        assetAddress: toPrivacyPoolsAssetAddress(tokenAddress)
      })
      const assetConfig = { minimumDepositAmount }

      this.depositAssetConfigs = { ...this.depositAssetConfigs, [key]: assetConfig }
      this.emitUpdate()

      return assetConfig
    } catch (error: any) {
      throw new EmittableError({
        message: 'Could not check what Privacy Pools accepts for this token. Please try again.',
        level: 'major',
        error: error instanceof Error ? error : new Error('privacyPools: asset config read failed')
      })
    }
  }

  /**
   * The next deposit's precommitment. It depends on the phrase's deposit count, not the amount, so
   * it is derived once per sync (deriving needs a sync first). Taken from an SDK-built deposit only
   * if that goes to the configured entrypoint.
   */
  #getNextDepositPrecommitment(chainId: string, seedId: string): Promise<bigint> {
    const key = this.#protocolKey(chainId, seedId)
    const cached = this.#nextDepositPrecommitments.get(key)
    const isCachedCurrent =
      !!cached && (cached.epoch === null || cached.epoch === (this.#syncEpochs.get(key) || 0))
    if (cached && isCachedCurrent) return cached.derivation

    const entry: { derivation: Promise<bigint>; epoch: number | null } = {
      derivation: Promise.resolve(0n),
      epoch: null
    }
    const derivation = (async () => {
      await this.#queueSync(chainId, seedId)
      // Pinned to the sync just awaited
      entry.epoch = this.#syncEpochs.get(key) || 0

      const config = getPrivacyPoolsChainConfig(BigInt(chainId))
      if (!config) throw new Error(`privacyPools: unsupported chain ${chainId}`)

      const protocol = await this.#getProtocol(chainId, seedId)
      const { txns } = await protocol.prepareShield({
        asset: { __type: 'erc20', contract: toPrivacyPoolsAssetAddress(ZERO_ADDRESS) },
        amount: 1n
      })
      const [txn] = txns
      if (!txn || txn.to.toLowerCase() !== config.entrypointAddress.toLowerCase())
        throw new Error('privacyPools: the prepared deposit does not go to the entrypoint')

      const precommitment = readDepositPrecommitment(txn.data)
      if (precommitment === null)
        throw new Error('privacyPools: the prepared deposit is not an entrypoint deposit')

      return precommitment
    })()

    entry.derivation = derivation
    this.#nextDepositPrecommitments.set(key, entry)
    // Not cached on failure, so the next attempt retries
    derivation.catch(() => {
      if (this.#nextDepositPrecommitments.get(key) === entry)
        this.#nextDepositPrecommitments.delete(key)
    })

    return derivation.catch((error) => {
      if (error instanceof EmittableError) throw error

      throw new EmittableError({
        message: 'Could not prepare the transfer to this Privacy Pools account. Please try again.',
        level: 'major',
        error:
          error instanceof Error ? error : new Error('privacyPools: deposit preparation failed')
      })
    })
  }

  #isDepositAwaitingChain(precommitment: bigint) {
    const broadcastAt = this.#broadcastDeposits.get(precommitment)

    return !!broadcastAt && Date.now() - broadcastAt < DEPOSIT_CONFIRMATION_WINDOW_MS
  }

  /**
   * Marks a broadcast account op's deposits as awaiting the chain, however it was signed. Only
   * those `buildDepositCalls` prepared are recognised, by precommitment - others are not this
   * wallet's. Nothing is persisted, as a local log would link deposits to their withdrawals.
   */
  onAccountOpBroadcast({ chainId, calls }: { chainId: bigint; calls: Call[] }) {
    const config = getPrivacyPoolsChainConfig(chainId)
    if (!config) return

    calls
      .filter((call) => call.to?.toLowerCase() === config.entrypointAddress.toLowerCase())
      .map((call) => readPrivacyPoolsDeposit(call))
      .filter((deposit): deposit is NonNullable<typeof deposit> => !!deposit)
      .filter(
        ({ precommitment }) =>
          this.#preparedDeposits.get(precommitment)?.chainId === chainId.toString()
      )
      .forEach(({ precommitment }) => this.#broadcastDeposits.set(precommitment, Date.now()))
  }

  /**
   * The approval `Entrypoint.deposit`'s `transferFrom` needs, which the SDK does not build. A
   * leftover allowance is reset to zero first, as USDT refuses non-zero to non-zero.
   */
  async #approvalCallIfNeeded(
    chainId: string,
    asset: { address: string },
    amount: bigint,
    owner: string
  ): Promise<Call[]> {
    const config = getPrivacyPoolsChainConfig(BigInt(chainId))
    if (!config) throw new Error(`privacyPools: unsupported chain ${chainId}`)

    // Not an ethers `Contract`, whose generated methods are untyped
    const allowanceResult = await this.#getProvider(chainId).call({
      to: asset.address,
      data: ERC20_INTERFACE.encodeFunctionData('allowance', [owner, config.entrypointAddress])
    })
    const allowance = ERC20_INTERFACE.decodeFunctionResult(
      'allowance',
      allowanceResult
    )[0] as bigint

    if (allowance >= amount) return []

    const approve = (value: bigint): Call => ({
      to: asset.address,
      value: 0n,
      data: ERC20_INTERFACE.encodeFunctionData('approve', [config.entrypointAddress, value])
    })

    return allowance ? [approve(0n), approve(amount)] : [approve(amount)]
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

  /** Updates the operation unless a lock or a newer one replaced it meanwhile. */
  #updateOperation(operation: PrivacyPoolsOperation): boolean {
    if (this.#operation?.id !== operation.id) return false

    this.#operation = operation

    return true
  }

  #isOperationInFlight() {
    return this.#operation?.status === 'pending' && this.#operation.phase !== 'ready'
  }

  dismissOperation() {
    // `operation`, so another phrase's cannot be dismissed
    if (!this.operation || this.#isOperationInFlight()) return

    this.#operation = null
    this.#discardPending()
    this.emitUpdate()
  }

  /**
   * Proves a withdrawal without sending it, so the user sees the fee before anything is sent.
   *
   * A single-use sender derived from the phrase submits an ERC-4337 userOp whose gas a paymaster
   * pays, taking a fee from the withdrawn amount - so no user-owned address pays gas.
   *
   * Not in `withStatus`: proving is long and cannot be aborted. Progress is in `operation`.
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
        message: 'Sending from a Privacy Pools account is not available on this network yet.',
        level: 'expected',
        error: new Error(`privacyPools: no paymaster configured for chain ${chainId}`)
      })

    this.#assertBundlerIsAllowed()

    // Not only in the form: a proof to a malformed or zero address would burn the funds
    if (!isAddress(recipient) || BigInt(recipient) === 0n)
      throw new EmittableError({
        message: 'Please enter a valid address to send to.',
        level: 'expected',
        error: new Error('privacyPools: invalid withdrawal recipient')
      })

    // One at a time across phrases: only one proved withdrawal is kept
    if (this.#isOperationInFlight())
      throw new EmittableError({
        message:
          'Another transfer from a Privacy Pools account is still in progress. Please wait for it to finish.',
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

    const isNative = isPrivacyPoolsNativeAsset(tokenAddress)
    const debugTrace = startKohakuDebugTrace('withdraw', { chainId, tokenAddress, isNative })
    const debugSummary: Record<string, unknown> = {
      chainId,
      tokenAddress,
      isNative,
      approvedNotesAvailable: this.#countApprovedNotes(seedId, chainId, tokenAddress)
    }

    try {
      await kohakuDebugPhase(debugTrace, 'assertPoolIsSponsored', () =>
        this.#assertPoolIsSponsored(chainId, tokenAddress)
      )

      // The SDK syncs before proving, outside the queue, so only wait for queued syncs rather than
      // run beside them. No sync of our own: it would only double the wait.
      await kohakuDebugPhase(debugTrace, 'waitForQueuedSync', () => this.#syncQueue)

      const protocol = await kohakuDebugPhase(debugTrace, 'getProtocol', () =>
        this.#getProtocol(chainId, seedId)
      )

      // Prices gas, proves and signs the userOp. Always a batch (a batch of one equals a plain
      // withdrawal): the SDK's plain withdrawal may pick a pending deposit, failing the proof.
      const privateOp = await kohakuDebugPhase(
        debugTrace,
        'sdk.prepareUnshield (sync + proofs + gas + signing)',
        () =>
          protocol.prepareUnshield(
            {
              asset: { __type: 'erc20', contract: toPrivacyPoolsAssetAddress(tokenAddress) },
              amount
            },
            recipient as any,
            { mode: 'paymaster', batch: true }
          )
      )
      debugSummary.treeSizes = readKohakuDebugTreeSizes(() => protocol.dumpState())

      // Only paymaster mode is asked for, so anything else means the SDK ignored it
      if (privateOp.mode !== 'paymaster')
        throw new Error('privacyPools: the withdrawal came back in an unsupported form')

      const { fee, noteCount } = readPaymasterWithdrawal({
        withdrawal: privateOp.withdrawal,
        paymaster,
        recipient,
        tokenAddress,
        amount
      })
      debugSummary.noteCount = noteCount
      debugSummary.userOperationGas = describeKohakuDebugUserOperationGas(
        privateOp.withdrawal.userOperation
      )
      debugSummary.feeCap = fee.toString()

      const feeEstimate = await kohakuDebugPhase(debugTrace, 'ourFeeEstimation (simulation)', () =>
        this.#getExpectedWithdrawalFee({
          chainId,
          userOperation: privateOp.withdrawal.userOperation,
          paymaster,
          recipient,
          tokenAddress,
          fee
        })
      )
      const expectedFeeAmount = feeEstimate?.expectedFee ?? null
      debugSummary.simulation = feeEstimate
        ? {
            expectedFee: feeEstimate.expectedFee.toString(),
            gasUsed: feeEstimate.gasUsed.toString(),
            gasCostWei: feeEstimate.gasCost.toString(),
            gasCostEth: formatUnits(feeEstimate.gasCost, 18),
            // A batch's refund goes to the single-use sender, so the user pays the whole cap
            strandedOnSender: feeEstimate.senderRefund.toString()
          }
        : 'unavailable'

      // A batch must simulate first: if its calls fail on chain, the largest deposit is still paid
      // to the single-use sender, out of the wallet's reach
      if (noteCount > 1 && expectedFeeAmount === null)
        throw new EmittableError({
          message:
            'This transfer combines several of your deposits, and we could not confirm it would go through, so it was not sent. Please try again in a moment, or send a smaller amount.',
          level: 'expected',
          error: new Error('privacyPools: a batch withdrawal could not be simulated')
        })

      const isStillCurrent = this.#updateOperation({
        ...operation,
        phase: 'ready',
        quote: { feeAmount: fee, amountAfterFee: amount - fee, expectedFeeAmount }
      })
      // Not kept if a lock superseded it
      if (isStillCurrent) this.#pendingWithdrawal = privateOp
    } catch (error: any) {
      debugSummary.failed = String(error?.message || error)
      this.#failOperation(
        operation,
        toReadableWithdrawalError(error),
        'The transfer could not be prepared. Please try again.'
      )
    }

    endKohakuDebugTrace(debugTrace, debugSummary)

    this.emitUpdate()
  }

  /** Approved notes of a token found by the last sync - for `[kohaku-debug]` only. */
  #countApprovedNotes(seedId: string, chainId: string, tokenAddress: string): number | undefined {
    return this.#notesByIdentity[seedId]?.[chainId]?.notes.filter(
      (note) =>
        note.approval === 'approved' &&
        note.tokenAddress.toLowerCase() === tokenAddress.toLowerCase()
    ).length
  }

  /**
   * The expected fee of a proved withdrawal, by simulating it, or null when it cannot be run.
   * Best effort: the proof's fee is already the cap. A simulated failure does not fail it here, as
   * the bundler checks it again. The bundler checks only the sponsored part of a batch, though, so
   * `prepareWithdrawal` refuses a batch this cannot run.
   */
  async #getExpectedWithdrawalFee({
    chainId,
    userOperation,
    paymaster,
    recipient,
    tokenAddress,
    fee
  }: AssetRef & {
    chainId: string
    userOperation: PrivacyPoolsSerializedUserOperation
    paymaster: PrivacyPoolsPaymasterConfig
    recipient: string
    fee: bigint
  }): Promise<PrivacyPoolsWithdrawalFeeEstimate | null> {
    const network = this.#networks.networks.find((n) => n.chainId.toString() === chainId)
    // The sender only has code to run through a state override
    if (!network || network.rpcNoStateOverride) return null

    try {
      return await withTimeout(
        () =>
          estimatePaymasterWithdrawalFee({
            provider: this.#getProvider(chainId),
            userOperation,
            entryPointAddress: paymaster.entryPointAddress,
            paymasterAddress: paymaster.paymasterAddress,
            recipient,
            tokenAddress,
            fee
          }),
        {
          timeoutMs: WITHDRAWAL_ESTIMATION_TIMEOUT_MS,
          message: 'privacyPools: the withdrawal fee estimation timed out'
        }
      )
    } catch (error: any) {
      this.emitError({
        message: 'Could not work out the exact network fee, so the most it can cost is shown.',
        level: 'silent',
        error:
          error instanceof Error
            ? error
            : new Error('privacyPools: withdrawal fee estimation failed')
      })

      return null
    }
  }

  /** A transfer out goes through an ERC-4337 bundler, which the user can opt out of. */
  #assertBundlerIsAllowed() {
    if (this.#featureFlags.isFeatureEnabled('erc4337')) return

    throw new EmittableError({
      message:
        'Sending from a Privacy Pools account needs "ERC-4337 smart account features", which you turned off. Turn it on in Settings > Privacy opt-outs to send.',
      level: 'expected',
      error: new Error('privacyPools: the user opted out of ERC-4337')
    })
  }

  /**
   * Refuses before proving a token whose pool has no paymaster adapter (the SDK does so only after
   * syncing). The pool is read from the entrypoint, so a replaced pool is caught.
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
      message: `Sending ${symbol} from a Privacy Pools account is not supported yet.`,
      level: 'expected',
      error: new Error(`privacyPools: no paymaster adapter for pool ${poolAddress}`)
    })
  }

  /**
   * Sends the signed withdrawal to the bundler and waits for it. Syncs either way, as a userOp can
   * land after the receipt wait gives up.
   */
  async broadcastWithdrawal(): Promise<void> {
    // `operation`, so another phrase's cannot be sent
    const operation = this.operation
    const privateOp = this.#pendingWithdrawal

    if (!operation || !privateOp)
      throw new EmittableError({
        message: 'There is no transfer ready to send.',
        level: 'expected',
        error: new Error('privacyPools: no prepared withdrawal')
      })

    this.#assertAvailableAndGetSeedId()
    this.#assertBundlerIsAllowed()
    const { seedId } = operation

    this.#updateOperation({ ...operation, phase: 'broadcasting' })
    this.emitUpdate()

    // Sent once: the sender is single-use (nonce 0), so a retry could only fail or duplicate. A
    // failed send is prepared again from scratch.
    this.#discardPending()

    try {
      const host = this.#getHost(this.#getProvider(operation.chainId), seedId)
      // No relayers: a paymaster withdrawal goes to the bundler URL carried in the payload.
      const broadcaster = createPPv1Broadcaster(host, { broadcasterUrl: {} })
      // Times handing the userOp to the bundler until it lands
      const debugTrace = startKohakuDebugTrace('broadcast', { chainId: operation.chainId })
      await broadcaster.broadcast(privateOp).finally(() => endKohakuDebugTrace(debugTrace))

      this.#updateOperation({ ...operation, status: 'success', phase: 'finalizing' })
      this.emitUpdate()
    } catch (error: any) {
      this.#failOperation(
        { ...operation, phase: 'broadcasting' },
        error,
        'The transfer could not be sent. Please try again.'
      )
    }

    // Picks up the spent note and its change note
    await this.syncChain(operation.chainId)
  }

  /** Drops the unsent withdrawal, so its proof is not sent later at a stale gas price. */
  #discardPending() {
    this.#pendingWithdrawal = null
  }

  /** Shows an `EmittableError`'s message, or `fallback` for SDK, bundler and chain errors. */
  #failOperation(operation: PrivacyPoolsOperation, error: any, fallback: string) {
    const message = error instanceof EmittableError ? error.message : fallback

    this.#updateOperation({ ...operation, status: 'failed', error: message })
    this.emitError({
      message,
      level: 'major',
      error: toPrivacyPoolsSdkError(error, 'privacyPools: withdrawal failed')
    })
  }

  /** Adds a stored phrase's Privacy Pools account. Nothing is derived or synced until opened. */
  async addAccount(seedId: string): Promise<void> {
    await this.initialLoadPromise

    if (!this.#keystore.seeds.some((seed) => seed.id === seedId))
      throw new EmittableError({
        message: 'This recovery phrase is no longer in your wallet.',
        level: 'expected',
        error: new Error(`privacyPools: no stored seed ${seedId}`)
      })

    if (this.accounts.some((account) => account.seedId === seedId))
      throw new EmittableError({
        message: 'This recovery phrase already has a Privacy Pools account.',
        level: 'expected',
        error: new Error(`privacyPools: seed ${seedId} already has an account`)
      })

    this.accounts = [...this.accounts, { seedId, createdAt: Date.now() }]
    this.emitUpdate()
    await this.#persistAccounts()
  }

  /** Removes the account, not its funds: re-adding it finds them. */
  async removeAccount(seedId: string): Promise<void> {
    await this.initialLoadPromise

    this.#forgetAccount(seedId)
    this.emitUpdate()
    await this.#persistAccounts()
    await this.#onAccountsRemoved([seedId])
  }

  /** Drops an account and everything derived for it. */
  #forgetAccount(seedId: string) {
    this.accounts = this.accounts.filter((account) => account.seedId !== seedId)

    this.#protocols.forEach((_, key) => {
      if (key.endsWith(`:${seedId}`)) this.#dropProtocol(key)
    })
    this.#kohakuKeystores.delete(seedId)
    delete this.#notesByIdentity[seedId]
  }

  /** Removes accounts whose phrase is gone - nothing in them is reachable. */
  async #forgetAccountsOfDeletedSeeds() {
    if (!this.#keystore.areSeedsLoaded) return

    const storedSeedIds = new Set(this.#keystore.seeds.map((seed) => seed.id))
    const orphanedSeedIds = this.accounts
      .map((account) => account.seedId)
      .filter((seedId) => !storedSeedIds.has(seedId))

    if (!orphanedSeedIds.length) return

    orphanedSeedIds.forEach((seedId) => this.#forgetAccount(seedId))
    this.emitUpdate()

    await this.#persistAccounts()
    await this.#onAccountsRemoved(orphanedSeedIds)
  }

  async #persistAccounts() {
    try {
      await this.#storage.set(PRIVACY_POOLS_ACCOUNTS_STORAGE_KEY, this.accounts)
    } catch (error: any) {
      this.emitError({
        message: 'Could not save your Privacy Pools accounts on this device.',
        level: 'major',
        error: error instanceof Error ? error : new Error('privacyPools: accounts write failed')
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
   * On lock, drops everything derived from any phrase; chain history stays (see
   * `PrivacyPoolsChainHistory`). A running sync cannot be stopped, so it finishes in the queue and
   * `#generation` makes it discard its results.
   */
  #teardown() {
    this.#generation += 1
    this.#protocols.clear()
    this.#providerInstances.clear()
    this.#sagaHydratedKeys.clear()
    this.#protocolChainVersions.clear()
    this.#kohakuKeystores.clear()
    this.#nextDepositPrecommitments.clear()
    this.#syncEpochs.clear()
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
      hasSyncedAnyChain: this.hasSyncedAnyChain,
      operation: this.operation
    }
  }
}
