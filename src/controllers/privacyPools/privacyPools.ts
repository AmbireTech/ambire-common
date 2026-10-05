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
  PRIVACY_POOLS_ACTIVITY_STORAGE_KEY,
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
  PrivacyPoolsActivityEntry,
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
import { AccountOpStatus, Call } from '../../libs/accountOp/types'
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

/**
 * How long a broadcast deposit blocks another into the same account, while it most likely has
 * not landed yet. See `#broadcastDeposits`.
 */
const DEPOSIT_CONFIRMATION_WINDOW_MS = 15 * 60 * 1000

/** How long prices are kept before a sync asks for them again. */
const PRICES_MAX_AGE_MS = 5 * 60 * 1000

/** How recently a chain must have been read for opening the account not to read it again. */
const SYNC_MAX_AGE_MS = 10 * 60 * 1000

/**
 * How long a proved withdrawal waits for its fee estimation before it is shown with only the most
 * it can cost. See `#getExpectedWithdrawalFee`.
 */
const WITHDRAWAL_ESTIMATION_TIMEOUT_MS = 8 * 1000

/** What an account op's final status means for the deposits in it, or null while it has none. */
const getDepositOutcome = (status?: AccountOpStatus): 'success' | 'failed' | null => {
  if (status === AccountOpStatus.Success || status === AccountOpStatus.UnknownButPastNonce)
    return 'success'
  if (
    status === AccountOpStatus.Failure ||
    status === AccountOpStatus.Rejected ||
    status === AccountOpStatus.BroadcastButStuck
  )
    return 'failed'

  return null
}

const readDepositPrecommitment = (data: string): bigint | null =>
  readPrivacyPoolsDeposit({ data, value: 0n })?.precommitment ?? null

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

/** The prover factory as the SDK types it. Its params type is not exported, hence reading it off. */
type SdkProverFactory = NonNullable<
  ConstructorParameters<typeof PrivacyPoolsV1Protocol>[1]['proverFactory']
>

/**
 * What the SDK throws when the paymaster's gas fee would exceed the withdrawn amount. Matched by
 * its exact wording because the SDK throws a plain `Error` with no code to tell it apart - and from
 * inside a thunk, so it arrives as a plain object; see `toPrivacyPoolsSdkError`.
 */
const FEE_ABOVE_AMOUNT_SDK_MESSAGE = 'Withdrawal amount too small to cover the sponsored gas fee'

/**
 * Turns the one SDK failure a user can act on into a sentence they can read. Everything else is
 * passed through as an `Error` with the SDK's message, and shown as the generic fallback.
 */
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
 * Owns the wallet's Privacy Pools state: one plugin per (chain, recovery phrase), the notes those
 * plugins find, and the locally kept log of what this wallet did with them.
 *
 * Scoped by recovery phrase rather than by account, because the note secrets are derived from the
 * phrase: accounts sharing a phrase share one set of notes, and an account without one (hardware,
 * private-key import, view-only) cannot use Privacy Pools at all.
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
   * The one storage adapter every plugin persists through.
   *
   * Shared rather than built per plugin, because the adapter caches the whole blob and rewrites it
   * on every save. Two plugins with a cache each - two recovery phrases on the same device - would
   * each write back their own copy, and the last one would silently undo the other's progress.
   */
  #kohakuStorage: Storage

  /**
   * Told which accounts were just removed, so whoever selects accounts can move off one that was
   * selected. A callback because removal also happens here on its own, when a phrase is deleted.
   */
  #onAccountsRemoved: (seedIds: string[]) => Promise<void>

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

  /** Per chain, kept through a lock - see `PrivacyPoolsChainHistory`. */
  #chainHistories: { [chainId: string]: PrivacyPoolsChainHistory } = {}

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
    [seedId: string]: { [chainId: string]: PrivacyPoolsIdentityChainState }
  } = {}

  #activity: PrivacyPoolsActivityEntry[] = []

  /**
   * The next deposit's precommitment per `${chainId}:${seedId}`, derived once - see
   * `#getNextDepositPrecommitment` - with the sync it was derived after. `epoch` is null while that
   * sync is still under way.
   */
  #nextDepositPrecommitments = new Map<
    string,
    { derivation: Promise<bigint>; epoch: number | null }
  >()

  /**
   * How many syncs have completed per `${chainId}:${seedId}`. A derived precommitment is good only
   * for the sync it followed: any later one may have seen a deposit land, which moves it on.
   */
  #syncEpochs = new Map<string, number>()

  /** Deposits `buildDepositCalls` prepared, by precommitment, so a broadcast can be told one. */
  #preparedDeposits = new Map<bigint, { seedId: string; chainId: string }>()

  /**
   * When each recognised deposit was broadcast, by precommitment.
   *
   * A second deposit into the same account before the first lands would carry the same
   * precommitment, and the entrypoint rejects a reused one - so building one is refused for a
   * while. Not until the deposit is seen on chain, because a broadcast that never lands would then
   * block the account for good.
   */
  #broadcastDeposits = new Map<bigint, number>()

  /**
   * The proved-but-unsent withdrawal. Private: it carries the proof and the signed userOp, neither
   * of which the UI needs - it reads the fee off `operation.quote`.
   */
  #pendingWithdrawal: PreparedPaymasterWithdrawal | null = null

  #proverFactory: PrivacyPoolsProverFactory

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

  /** The selected Privacy Pools account the UI last heard about - see `#subscribeToDependencies`. */
  #selectedAccountId: string | null = null

  /**
   * What the entrypoint requires of a deposit, per `${chainId}:${tokenAddress}` (lowercase) - read
   * from the chain once per session, as the form needs it to validate what is typed.
   */
  depositAssetConfigs: { [key: string]: PrivacyPoolsDepositAssetConfig } = {}

  /**
   * USD prices of the assets the pools accept, keyed as `getPrivacyPoolsPriceKey` does. Kept here
   * rather than taken from the portfolio: with a Privacy Pools account selected there is no
   * selected account's portfolio to price anything.
   */
  prices: { [priceKey: string]: number } = {}

  #pricesFetchedAt = 0

  #pricesRequest: Promise<void> | null = null

  /**
   * The wallet's Privacy Pools accounts, at most one per stored recovery phrase. Removed along with
   * their phrase, since nothing in them can be reached once it is gone.
   */
  accounts: PrivacyPoolsAccount[] = []

  /**
   * The latest withdrawal - the one in flight, or the last one until dismissed - whichever phrase
   * it belongs to. Reaches the UI through `operation`, only while its phrase is on screen.
   */
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
    getInitialState,
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
    /**
     * Where the circuit artifacts are served from. A build asset whose URL only the platform layer
     * knows - an extension URL on the extension, a static path on the websites.
     */
    circuitsBaseUrl: string
    /**
     * Where proofs are generated, when not in this controller's own context - the extension hands
     * them to its offscreen document, where they run on several threads. Absent, they are generated
     * here from the artifacts at `circuitsBaseUrl`.
     */
    proverFactory?: PrivacyPoolsProverFactory
    /**
     * Loads the shipped pool history, keyed the way the plugin keys its own store. A callback so
     * the several megabytes it holds are fetched only when a chain actually needs them, and so the
     * platform layer decides where they come from - a bundled asset, or nothing at all.
     */
    getInitialState?: () => Promise<Record<string, any>>
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
    this.#getShippedInitialState = getInitialState
    this.#proverFactory = withKohakuDebugProver(
      proverFactory ?? createProverFactory(circuitsBaseUrl)
    )

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
    this.accounts = await this.#storage.get(PRIVACY_POOLS_ACCOUNTS_STORAGE_KEY, [])
    // A phrase deleted while this controller was not around to see it
    await this.#forgetAccountsOfDeletedSeeds()

    this.#subscribeToDependencies()
    this.emitUpdate()
  }

  /**
   * Privacy Pools holds derived secrets and live RPC providers, so it cannot just read its
   * dependencies on demand - it has to react when they change. Each subscription either
   * invalidates a plugin or changes what the getters below report, and getter values only reach
   * the UI when an update is emitted.
   *
   * Passed on only when they can change what it reports, since the selected account and the
   * networks update far more often than that.
   */
  #subscribeToDependencies() {
    this.#selectedAccountId = this.#selectedAccount.privacyPoolsAccountId

    this.#unsubscribers.push(
      this.#keystore.onUpdate((forceEmit) => {
        // Locking must drop the derived note secrets, not merely hide the UI. The notes go with
        // them: nothing derived from the phrase may outlive the lock.
        if (!this.#keystore.isUnlocked && this.#hasPhraseDerivedState()) this.#teardown()

        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.#forgetAccountsOfDeletedSeeds()

        this.#propagateIfHasAccounts(forceEmit)
      }, 'privacyPools'),

      // Switching accounts drops nothing: every phrase has its own plugins and its own notes, so
      // switching back shows them at once, and a sync still running for the previous phrase keeps
      // going and leaves the network's history warm for the next one.
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

      // Subscribed to purely so `supportedChainIds` and everything derived from it reaches the UI.
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

  /**
   * The chains this wallet can use Privacy Pools on: the SDK's own capability, narrowed to the
   * networks the user actually has and that have a provider.
   */
  get supportedChainIds(): string[] {
    return PRIVACY_POOLS_SUPPORTED_CHAIN_IDS.map((chainId) => chainId.toString()).filter(
      (chainId) =>
        this.#networks.networks.some((network) => network.chainId.toString() === chainId) &&
        !!this.#providers.providers[chainId]
    )
  }

  get unavailableReason(): PrivacyPoolsUnavailableReason | null {
    // Structural reasons first: they don't change by unlocking, so telling a user with no Privacy
    // Pools account selected to unlock would send them to do something that cannot help.
    if (!this.#getSelectedSeedId()) return 'no-account'
    if (!this.supportedChainIds.length) return 'unsupported-network'
    if (!this.#keystore.isUnlocked) return 'locked'

    return null
  }

  get isAvailableForSelectedAccount(): boolean {
    return !this.unavailableReason
  }

  /**
   * Per-chain state as the UI reads it: the chain's own sync merged with this phrase's last read of
   * it. A getter rather than a field, so the split stays an implementation detail.
   */
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
   * The withdrawal on screen - the one in flight, or the last one until dismissed. Public because
   * proving takes ten seconds and up, and the UI has nothing else to show meanwhile.
   *
   * Hidden while another phrase is on screen, rather than dropped: a withdrawal cannot be stopped
   * mid-proof, and switching back must show it where it was.
   */
  get operation(): PrivacyPoolsOperation | null {
    if (this.#operation?.seedId !== this.#getSelectedSeedId()) return null

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
    const identityChains = this.#getSelectedIdentityChains()

    return Object.fromEntries(
      Object.keys(this.chains).map((chainId) => {
        const byToken = new Map<string, PrivacyPoolsTokenBalance>()

        ;(identityChains[chainId]?.notes || []).forEach((note) => {
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
    const seedId = this.#getSelectedSeedId()
    if (!seedId) return []

    return this.#activity
      .filter((entry) => entry.seedId === seedId)
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  /**
   * The recovery phrase of the selected Privacy Pools account - the one the note secrets are
   * derived from. Null when a regular account is selected, or when the selection no longer points
   * at an account and a phrase this wallet still has.
   */
  #getSelectedSeedId(): string | null {
    const seedId = this.#selectedAccount.privacyPoolsAccountId
    if (!seedId) return null
    if (!this.accounts.some((account) => account.seedId === seedId)) return null
    if (!this.#keystore.seeds.some((seed) => seed.id === seedId)) return null

    return seedId
  }

  /** What the selected Privacy Pools account holds, per chain. */
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
      dataService: withKohakuDebugTiming(dataService, 'dataService'),
      entrypoint: {
        address: BigInt(config.entrypointAddress),
        deploymentBlock: config.deploymentBlock
      },
      // The SDK types it as the circuits package's whole `Prover`, but only ever calls `prove`
      proverFactory: this.#proverFactory as SdkProverFactory,
      // 0xBow's API rather than the SDK's IPFS default, which depends on ipfs.io being up and on
      // the CID in the last on-chain root update still being pinned.
      aspServiceFactory: () =>
        withKohakuDebugTiming(
          new OxBowAspService({ network: host.network, aspUrl: config.aspUrl }),
          'aspService'
        ),
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
   * cases.
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

  #writeChainHistory(chainId: string, update: Partial<PrivacyPoolsChainHistory>) {
    this.#chainHistories[chainId] = {
      ...(this.#chainHistories[chainId] || { isInitialSyncDone: null, initialSyncDuration: null }),
      ...update
    }
  }

  /**
   * Looks up whether a chain's history has been read on this device, once per chain. Asked for when
   * a sync is, so a network in for the long first read says so while it still waits its turn.
   */
  async #lookUpInitialSync(chainId: string) {
    if (typeof this.#chainHistories[chainId]?.isInitialSyncDone === 'boolean') return

    const config = getPrivacyPoolsChainConfig(BigInt(chainId))
    if (!config) return

    const isChainCold = await this.#isChainCold(config)
    // A sync that got its turn meanwhile has found out itself, and may have read the chain since
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
   * Walks a chain's pools and decrypts whatever belongs to this phrase.
   *
   * Queued behind any sync already running (see `#syncQueue`), and joinable: asking again for the
   * same chain and phrase returns the sync already queued or running rather than adding another.
   */
  async syncChain(chainId: string): Promise<void> {
    const seedId = this.#assertAvailableAndGetSeedId()
    // A balance is worth little without what it is worth, and a sync is when it is looked at
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.#refreshPrices()

    return this.#queueSync(chainId, seedId)
  }

  /**
   * Asks for prices again once they are older than `PRICES_MAX_AGE_MS`, one request at a time.
   * Never while the user has opted out of token prices.
   */
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
        // The balances stand without them - the previous prices, if any, stay on screen
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

  /** Queues a sync for any account, not only the selected one - see `syncChain`. */
  #queueSync(chainId: string, seedId: string): Promise<void> {
    const jobKey = this.#protocolKey(chainId, seedId)
    const existingJob = this.#syncJobs.get(jobKey)
    if (existingJob) return existingJob

    const generation = this.#generation

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.#lookUpInitialSync(chainId)

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
    const startedAt = Date.now()

    // 'initializing' is the chain's own first read, whichever phrase happens to trigger it: that
    // is the walk that takes minutes. A phrase new to an already read chain only reads the tail.
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

      // `notes` is optional on the plugin interface - it exists only when the plugin declares a
      // note type, which PPv1 does. Checked rather than asserted so a future SDK that drops it
      // fails with this sentence instead of a TypeError.
      if (!protocol.notes) throw new Error('privacyPools: plugin does not expose notes')

      // Reading the notes is the sync: the plugin syncs before every read, and each of its syncs
      // costs seconds even with no new blocks, so a `sync()` first would pay for it twice.
      const notes = await kohakuDebugPhase(debugTrace, 'sdk.notes (sync)', () => protocol.notes!())
      const syncDuration = Date.now() - startedAt
      endKohakuDebugTrace(debugTrace, {
        chainId,
        isChainCold,
        notes: notes.length,
        approvedNotes: notes.filter((note) => note.approved).length,
        treeSizes: readKohakuDebugTreeSizes(() => protocol.dumpState())
      })

      // The history is persisted by now, whoever's phrase it was read for and whether or not the
      // wallet has been locked since: it is the chain's, not the phrase's
      if (isChainCold)
        this.#writeChainHistory(chainId, {
          isInitialSyncDone: true,
          initialSyncDuration: syncDuration
        })

      // Locked while syncing: nothing derived from the phrase may be written back. Nor for an
      // account removed meanwhile, whose notes would otherwise outlive it.
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

  /**
   * Syncs every chain this wallet can use, for the account on screen, however recently it was read
   * - what refreshing it does. Opening it goes through `syncIfStale` instead.
   *
   * Not wrapped in `withStatus`, which refuses a call while the previous one runs: a first read
   * takes minutes, and opening another account meanwhile must still queue its sync - see
   * `#syncQueue`. What is in flight is reported per chain instead, through `chains`.
   */
  async sync(): Promise<void> {
    try {
      await Promise.all(this.supportedChainIds.map((chainId) => this.syncChain(chainId)))
    } catch (error: any) {
      this.#emitSyncError(error)
    }
  }

  /**
   * What opening the account on screen does: syncs every chain it has not read in the last 10
   * minutes, rather than every chain every time it is opened. Not wrapped in `withStatus`, for the
   * reason `sync` is not.
   *
   * Nothing is read until the account's recovery phrase is backed up. The first read of a network
   * takes minutes, and the phrase is the only way to recover the account - so the dashboard asks
   * for the backup first, and the account is read once it is done.
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
   * The calls that send funds from one of the wallet's accounts into a Privacy Pools account - a
   * deposit, in the protocol's terms.
   *
   * Only built here: the caller hands them to the regular signing flow, because a deposit is an
   * ordinary transaction from the sending account and deserves the same fee handling, simulation
   * and confirmation as any other. Nothing is recorded until it is broadcast - see
   * `onAccountOpBroadcast`.
   *
   * For ERC-20s the SDK builds only the entrypoint call, while `Entrypoint.deposit` pulls the funds
   * with `transferFrom` - so the approval has to be prepended here or the deposit reverts.
   *
   * The deposit is public by nature: the pool stores the sending address and emits it. Nothing here
   * hides that, and the screen says so.
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

  /**
   * What the entrypoint requires of a deposit of this asset, read once and then kept - also on
   * `depositAssetConfigs`, for the form to validate against as the amount is typed.
   */
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
   * The precommitment the next deposit into this account on this chain is made with.
   *
   * It comes from how many deposits the phrase has on chain, so it stays the same until one lands -
   * which is what makes it worth deriving once rather than for every amount typed: deriving it
   * syncs the chain for the phrase first, through the queue like any other sync. The amount is not
   * part of it, so the deposit itself is encoded here for whatever amount is asked for.
   *
   * The SDK builds the transaction that carries it; only the precommitment is taken from it, and
   * only once the transaction is confirmed to go to the configured entrypoint.
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
      // Pinned to the sync just awaited, which is the one it is derived after
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
    // Not kept when it fails, so the next attempt derives it again rather than failing forever
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

  /**
   * Settles the deposits that went out in an account op, once its outcome is known. Nothing else
   * can tell: the pool's own records carry no transaction to match a deposit by.
   */
  async onAccountOpStatusUpdate({ id, status }: { id: string; status?: AccountOpStatus }) {
    const outcome = getDepositOutcome(status)
    if (!outcome) return

    const isSettlingAny = this.#activity.some(
      (entry) => entry.accountOpId === id && entry.status === 'pending'
    )
    if (!isSettlingAny) return

    this.#activity = this.#activity.map((entry) =>
      entry.accountOpId === id && entry.status === 'pending' ? { ...entry, status: outcome } : entry
    )
    this.emitUpdate()
    await this.#persistActivity()
  }

  #isDepositAwaitingChain(precommitment: bigint) {
    const broadcastAt = this.#broadcastDeposits.get(precommitment)

    return !!broadcastAt && Date.now() - broadcastAt < DEPOSIT_CONFIRMATION_WINDOW_MS
  }

  /**
   * Records the deposits a just-broadcast account op carries, whichever way it was signed - the
   * inline transfer, a batch, a request window.
   *
   * Only deposits `buildDepositCalls` prepared are recognised, by their precommitment: that is what
   * ties one to a Privacy Pools account, and a deposit into someone else's is none of this wallet's
   * business.
   */
  async onAccountOpBroadcast({
    id: accountOpId,
    accountAddr,
    chainId,
    calls,
    txnId
  }: {
    id?: string
    accountAddr: string
    chainId: bigint
    calls: Call[]
    txnId?: string
  }) {
    const config = getPrivacyPoolsChainConfig(chainId)
    if (!config) return

    const entries = calls
      .filter((call) => call.to?.toLowerCase() === config.entrypointAddress.toLowerCase())
      .map((call) => readPrivacyPoolsDeposit(call))
      .filter((deposit): deposit is NonNullable<typeof deposit> => !!deposit)
      .map((deposit) => ({ deposit, prepared: this.#preparedDeposits.get(deposit.precommitment) }))
      .filter(({ prepared }) => prepared?.chainId === chainId.toString())
      .map(({ deposit, prepared }): PrivacyPoolsActivityEntry => {
        const now = Date.now()
        this.#broadcastDeposits.set(deposit.precommitment, now)

        return {
          id: generateUuid(),
          seedId: prepared!.seedId,
          chainId: chainId.toString(),
          type: 'deposit',
          tokenAddress: fromPrivacyPoolsAssetAddress(deposit.assetAddress),
          isNative: isPrivacyPoolsNativeAsset(fromPrivacyPoolsAssetAddress(deposit.assetAddress)),
          amount: deposit.amount,
          recipient: null,
          depositor: accountAddr,
          status: 'pending',
          createdAt: now,
          broadcastedAt: now,
          txnId,
          accountOpId
        }
      })

    if (!entries.length) return

    this.#activity.push(...entries)
    this.emitUpdate()
    await this.#persistActivity()
  }

  /**
   * The approval a deposit needs, or nothing when the allowance already covers it.
   *
   * `Entrypoint.deposit` pulls ERC-20s with `transferFrom`, and the SDK builds only the entrypoint
   * call - so without this the deposit reverts with nothing explaining why.
   *
   * A leftover allowance is reset to zero first: USDT refuses to change one non-zero allowance
   * into another.
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
        message: 'Sending from a Privacy Pools account is not available on this network yet.',
        level: 'expected',
        error: new Error(`privacyPools: no paymaster configured for chain ${chainId}`)
      })

    this.#assertBundlerIsAllowed()

    // Checked here and not only in the form: the proof commits to the recipient, and one made out
    // to a malformed or zero address would burn the funds it releases
    if (!isAddress(recipient) || BigInt(recipient) === 0n)
      throw new EmittableError({
        message: 'Please enter a valid address to send to.',
        level: 'expected',
        error: new Error('privacyPools: invalid withdrawal recipient')
      })

    // One at a time, across phrases: only one proved withdrawal is ever kept, so a second would
    // silently replace the first one's proof while it is still being built.
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

      // The SDK syncs the chain itself before proving, outside the queue, so it only waits here for
      // a queued sync to finish rather than run beside it. Not a sync of its own first: the SDK's
      // costs about the same even with no new blocks, so running both only doubles the wait.
      await kohakuDebugPhase(debugTrace, 'waitForQueuedSync', () => this.#syncQueue)

      const protocol = await kohakuDebugPhase(debugTrace, 'getProtocol', () =>
        this.#getProtocol(chainId, seedId)
      )

      // Pricing the gas, proving, and signing the userOp all happen inside this one call.
      //
      // Always as a batch, even when one deposit covers the amount - a batch of one is built
      // exactly like a plain withdrawal. The SDK's plain withdrawal picks its deposit without
      // checking it is approved, so a pending deposit that happens to fit is chosen and the proof
      // fails; its batch selection only picks approved ones.
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

      // The SDK types a prepared withdrawal as a union of relayer and paymaster ones. We only ever
      // ask for the paymaster mode, so anything else means the SDK ignored what we asked for.
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

      // A batch must be seen to go through before it is sent. If its own calls fail on chain, the
      // largest deposit is still spent - paid out to the single-use sender, where the wallet cannot
      // reach it - and the rest never move.
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
      // A proof that finished after a lock must not be kept for a withdrawal nobody can see.
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

  /** How many approved notes of a token the last sync found - for `[kohaku-debug]` only. */
  #countApprovedNotes(seedId: string, chainId: string, tokenAddress: string): number | undefined {
    return this.#notesByIdentity[seedId]?.[chainId]?.notes.filter(
      (note) =>
        note.approval === 'approved' &&
        note.tokenAddress.toLowerCase() === tokenAddress.toLowerCase()
    ).length
  }

  /**
   * What a proved withdrawal is expected to actually cost, by running it first - see
   * `estimatePaymasterWithdrawalFee`. Null when it cannot be run.
   *
   * Best effort: the fee locked into the proof is already the most the user can be charged, so a
   * node that cannot simulate, or answers too slowly, leaves that on screen instead of holding up
   * the confirmation. A simulation that says the withdrawal would fail does not fail it here - the
   * bundler checks it again before accepting it. A batch is the exception: the bundler only checks
   * the part the paymaster sponsors, so `prepareWithdrawal` refuses one this cannot run.
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
      message: `Sending ${symbol} from a Privacy Pools account is not supported yet.`,
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
        message: 'There is no transfer ready to send.',
        level: 'expected',
        error: new Error('privacyPools: no prepared withdrawal')
      })

    this.#assertAvailableAndGetSeedId()
    this.#assertBundlerIsAllowed()
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
      // Its total is the time from handing the userOp to the bundler until it lands
      const debugTrace = startKohakuDebugTrace('broadcast', { chainId: operation.chainId })
      const { txHash } = await broadcaster
        .broadcast(privateOp)
        .finally(() => endKohakuDebugTrace(debugTrace))

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
        'The transfer could not be sent. Please try again.'
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
      error: toPrivacyPoolsSdkError(error, 'privacyPools: withdrawal failed')
    })

    return message
  }

  /**
   * Adds the Privacy Pools account of a stored recovery phrase.
   *
   * Nothing is derived or synced here - that happens once the account is opened.
   */
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

  /**
   * Removes a Privacy Pools account, not its funds: they stay in the pools, tied to the recovery
   * phrase, and adding the account again finds them. Its activity log is kept for the same reason.
   */
  async removeAccount(seedId: string): Promise<void> {
    await this.initialLoadPromise

    this.#forgetAccount(seedId)
    this.emitUpdate()
    await this.#persistAccounts()
    await this.#onAccountsRemoved([seedId])
  }

  /** Drops an account and everything derived for it, leaving the activity log to the caller. */
  #forgetAccount(seedId: string) {
    this.accounts = this.accounts.filter((account) => account.seedId !== seedId)

    this.#protocols.forEach((_, key) => {
      if (key.endsWith(`:${seedId}`)) this.#dropProtocol(key)
    })
    this.#kohakuKeystores.delete(seedId)
    delete this.#notesByIdentity[seedId]
  }

  /**
   * Removes the accounts whose recovery phrase is no longer stored, with their activity log: once
   * the phrase is gone, nothing in them can be reached, and importing it again starts afresh.
   */
  async #forgetAccountsOfDeletedSeeds() {
    if (!this.#keystore.areSeedsLoaded) return

    const storedSeedIds = new Set(this.#keystore.seeds.map((seed) => seed.id))
    const orphanedSeedIds = this.accounts
      .map((account) => account.seedId)
      .filter((seedId) => !storedSeedIds.has(seedId))

    if (!orphanedSeedIds.length) return

    orphanedSeedIds.forEach((seedId) => this.#forgetAccount(seedId))
    this.#activity = this.#activity.filter((entry) => !orphanedSeedIds.includes(entry.seedId))
    this.emitUpdate()

    // One after the other: the store must never have two writes in flight
    await this.#persistAccounts()
    await this.#persistActivity()
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
   * once the phrases are out of reach. What is known about the chains themselves stays - see
   * `PrivacyPoolsChainHistory`.
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
      activity: this.activity,
      hasSyncedAnyChain: this.hasSyncedAnyChain,
      operation: this.operation
    }
  }
}
