import { Interface, JsonRpcProvider, Wallet } from 'ethers'

import { Storage as RailgunHostStorage } from '@kohaku-eth/plugins'
import {
  Bundler,
  chainConfig,
  createRailgunPlugin,
  ensureInitialized,
  RailgunSigner,
  Signer as EthSigner,
  SimpleSmartAccount
} from '@kohaku-eth/railgun'
import type {
  AssetAmount,
  AssetId,
  ERC20AssetId,
  Host as RailgunHost,
  Keystore as RailgunHostKeystore
} from '@kohaku-eth/plugins'
import type { EthereumProvider } from '@kohaku-eth/provider'
import type {
  Eip1193Provider,
  LogLevel,
  RailgunAddress,
  RailgunPlugin,
  RawLog
} from '@kohaku-eth/railgun'

import EmittableError from '../../classes/EmittableError'
import { RAILGUN_KEY_INDEX, RAILGUN_SUPPORTED_CHAIN_IDS } from '../../consts/railgun'
import { IEventEmitterRegistryController, Statuses } from '../../interfaces/eventEmitter'
import { Fetch } from '../../interfaces/fetch'
import { Hex } from '../../interfaces/hex'
import { IKeystoreController } from '../../interfaces/keystore'
import { INetworksController } from '../../interfaces/network'
import { IProvidersController, RPCProvider } from '../../interfaces/provider'
import {
  IRailgunController,
  RailgunActivityEntry,
  RailgunActivityStatus,
  RailgunChainState,
  RailgunPoiStatus,
  RailgunShieldedBalance,
  RailgunUnavailableReason
} from '../../interfaces/railgun'
import { ISelectedAccountController } from '../../interfaces/selectedAccount'
import { IStorageController } from '../../interfaces/storage'
import { Call } from '../../libs/accountOp/types'
import { getRailgunTokenBalance } from '../../libs/railgun/balances'
import { withTimeout } from '../../utils/with-timeout'
import EventEmitter from '../eventEmitter/eventEmitter'

/**
 * Blocks per `eth_getLogs` for the SDK's RPC-based UTXO syncer (its own default is 10). Chain
 * dependent, because the two chains fail in opposite directions - see the rationale at the
 * `createRailgunPlugin` call site.
 *
 * On Sepolia the window has to be wide: Railgun transacts there are days apart, so the RPC
 * syncer is always handed a tail of thousands of blocks, and the whole contract has only a few
 * thousand logs in total - nowhere near a provider's response cap.
 *
 * On Ethereum the opposite holds. Transacts are frequent, so the Subsquid indexer's head is
 * close to the chain's and the tail the RPC syncer has to cover is short - while a 10k-block
 * window over a busy Railgun Smart Wallet can exceed a provider's log cap (Alchemy returns at
 * most 10k logs per response) and fail the whole scan.
 */
const RAILGUN_RPC_SYNC_BATCH_SIZE_IN_BLOCKS: { [chainId: string]: number } = {
  '1': 2_000,
  '11155111': 10_000
}
const DEFAULT_RAILGUN_RPC_SYNC_BATCH_SIZE_IN_BLOCKS = 2_000
// Keeps the persisted activity log bounded - it exists to show the user their recent Railgun
// operations, not to be a complete audit trail.
const MAX_ACTIVITY_ENTRIES = 20
// A shielded balance sync scans the chain, so it is legitimately slow (see the rpcBatchSize
// note), but it must never be able to hang forever: `withStatus` refuses to start any action
// while another one is LOADING, so one wedged sync locks the user out of the whole screen -
// including the refresh button that would recover it.
const RAILGUN_SYNC_TIMEOUT_IN_MS = 3 * 60 * 1000
// The first sync of a chain is a different animal: it walks the pool's whole history and, with
// POI enabled, also downloads the POI circuit artifacts (megabytes) and runs Groth16 in WASM
// to prove the notes it finds. Sharing the steady-state budget above meant a mainnet cold sync
// was reported as a timeout every time.
const RAILGUN_FIRST_SYNC_TIMEOUT_IN_MS = 15 * 60 * 1000
// Owned by this module and handed to `withTimeout` as its rejection message, so a soft timeout
// can be told apart from an error raised by the scan itself - see #syncChain.
const RAILGUN_SYNC_TIMEOUT_MESSAGE =
  'Syncing your shielded balances took too long. Please try again.'
// The SDK writes its UTXO/POI state key-by-key during a sync, so a burst of writes is the norm.
// Debouncing them into one blob write is what keeps a sync from rewriting the whole blob
// hundreds of times (see RailgunHostStorageAdapter).
const RAILGUN_STORAGE_WRITE_DEBOUNCE_IN_MS = 250
// How many periodic refreshes may fail before the user is told. Below this the failure is only
// debug-logged: the refresh runs on a timer, so reporting a transient RPC blip would toast (and
// report to Sentry) on every tick. See `sync`.
const MAX_QUIET_BACKGROUND_SYNC_FAILURES = 3
// A background refresh this soon after the last successful sync is skipped. Enabling Railgun
// syncs, and the update that emits starts the periodic refresh with `runImmediately`, so without
// this the first thing that happens after a (potentially very long) mainnet cold sync is the
// exact same sync again.
const MIN_BACKGROUND_SYNC_AGE_IN_MS = 60 * 1000

/**
 * The Privacy Paymaster fronts the gas for a private operation (which is why the disposable
 * broadcasting key needs no ETH), but it gets reimbursed inside the pool: `prepareUserOp` adds a
 * fee note transfer sized by iterating gas estimates. That note can only be denominated in the
 * wrapped base token - both the plugin (which passes `chain.wrappedBaseToken` as the fee token)
 * and the WASM ("Currently only the wrapped base token is supported for fee payment") enforce it.
 *
 * So both of these mean the same thing to the user: there isn't enough *spendable* shielded WETH
 * to pay the relay fee. The first is raised when no workable set of notes exists at all, the
 * second when the estimate won't settle (some WETH, but not enough of it).
 */
const RELAY_FEE_ERRORS = [
  'Unable to construct valid note configuration for fee payment',
  'Failed to converge on fee estimate'
]

const getPrivateOperationErrorMessage = (error: any, fallbackMessage: string) => {
  const isRelayFeeError =
    typeof error?.message === 'string' &&
    RELAY_FEE_ERRORS.some((relayFeeError) => error.message.includes(relayFeeError))

  if (isRelayFeeError) {
    return 'Could not pay the relay fee for this operation. It is always taken from your shielded WETH (never the token you are sending), so shield some ETH - or keep some out of the amount - and try again. Note that WETH you shielded in the last hour cannot pay the fee either, because it has no innocence proof yet.'
  }

  return error?.message || fallbackMessage
}

const STATUS_WRAPPED_METHODS = {
  init: 'INITIAL',
  sync: 'INITIAL',
  buildAndBroadcastUnshield: 'INITIAL',
  buildAndBroadcastTransfer: 'INITIAL'
} as const

const isErc20Balance = (balance: AssetAmount): balance is AssetAmount<ERC20AssetId> =>
  balance.asset.__type === 'erc20'

/**
 * Whether the SDK's tracing dispatcher has already been installed in this JS context.
 *
 * Module-level on purpose: it tracks a process-global resource, not per-controller state. The
 * SDK's `initLogging` treats 'Off' as a no-op but hands any other level to
 * `tracing_wasm::set_as_global_default_with_config`, which panics with "a global default trace
 * dispatcher has already been set" the second time round - and the SDK re-applies the level on
 * every `ensureInitialized` call while offering no way to ask whether it is already set. So a
 * real level is requested exactly once and every later init runs with 'Off'.
 *
 * The consequence is that the SDK's logging can be turned on for a context but not back off. It
 * resets with the context (a service worker restart), same as the WASM module itself.
 */
let hasInstalledSdkLogger = false

/**
 * `AssetAmount.tag` carries the SDK's `PoiStatus` as a loose string, so it is narrowed here
 * instead of being cast. An unrecognised (or absent) tag becomes 'unknown', which the balance
 * helpers treat as spendable - matching how the SDK's own note selection treats a missing
 * status.
 */
const toRailgunPoiStatus = (tag: string | undefined): RailgunPoiStatus => {
  if (tag === 'Valid' || tag === 'ProofSubmitted' || tag === 'Missing' || tag === 'ShieldBlocked')
    return tag

  return 'unknown'
}

/**
 * Ambire's StorageController is a fixed-schema key store, not the arbitrary key-value
 * store the Railgun SDK's Host.storage expects, so writes are folded into a single flat
 * `railgunPluginStorage` blob.
 *
 * One blob is enough for all chains: the SDK routes every write through its own
 * `DatabaseAdapter`, which prefixes each key with the chain id, so entries for different
 * chains never collide. That is also why a single adapter instance is shared by every chain's
 * Host.
 *
 * The blob is cached in memory and hydrated once. Re-reading it on every `set` (as this used to
 * do) meant one full read *and* one full write of the entire UTXO/POI state per key the SDK
 * touched - fine for a near-empty testnet pool, quadratic-feeling on a real one.
 *
 * `set` resolves as soon as the value is in the cache, and the blob write is debounced behind it.
 * This is load-bearing, not an optimisation: the Rust side awaits every `Database::set` in
 * sequence, so resolving only after the debounced write landed made each key the sync touched
 * cost the full debounce interval. A mainnet sync walks ~250k commitments, and the write count
 * scales with it - at a quarter of a second each that alone is longer than anyone will wait.
 * Read-after-write still holds, because `get` reads the same cache.
 */
export class RailgunHostStorageAdapter implements RailgunHostStorage {
  readonly _brand = 'Storage' as const

  #storage: IStorageController

  #onError: (error: unknown) => void

  #cache: Record<string, string> | null = null

  #hydratePromise: Promise<Record<string, string>> | null = null

  // The write every `set` in the current burst joins, so they persist together.
  #scheduledWrite: Promise<void> | null = null

  #writeQueue: Promise<void> = Promise.resolve()

  // Since `set` no longer awaits persistence, a failed write has no caller left to throw at -
  // hence the injected reporter.
  constructor(storage: IStorageController, onError: (error: unknown) => void) {
    this.#storage = storage
    this.#onError = onError
  }

  #hydrate(): Promise<Record<string, string>> {
    if (this.#cache) return Promise.resolve(this.#cache)

    if (!this.#hydratePromise) {
      this.#hydratePromise = this.#storage.get('railgunPluginStorage', {}).then((blob) => {
        // A concurrent hydrate may have already populated it - keep the same object identity,
        // since pending writes mutate whatever `#cache` pointed at.
        this.#cache = this.#cache || blob
        return this.#cache
      })
    }

    return this.#hydratePromise
  }

  async get(key: string): Promise<string | null> {
    const cache = await this.#hydrate()
    return cache[key] ?? null
  }

  async set(key: string, value: string): Promise<void> {
    const cache = await this.#hydrate()
    cache[key] = value

    // Deliberately not returned: see the class comment for why the caller must not wait for
    // persistence. Failures are reported rather than thrown, since there is nobody left to
    // throw at.
    this.#scheduleWrite().catch(this.#onError)
  }

  #scheduleWrite(): Promise<void> {
    if (this.#scheduledWrite) return this.#scheduledWrite

    this.#scheduledWrite = new Promise<void>((resolve) => {
      // A one-shot, self-resolving timeout: it always fires, so nothing is left to clean up
      // and no caller is ever left awaiting a promise that can't settle.
      setTimeout(resolve, RAILGUN_STORAGE_WRITE_DEBOUNCE_IN_MS)
    }).then(() => {
      this.#scheduledWrite = null
      this.#writeQueue = this.#writeQueue.then(() =>
        this.#storage.set('railgunPluginStorage', { ...(this.#cache || {}) })
      )

      return this.#writeQueue
    })

    return this.#scheduledWrite
  }

  /** Persists everything still in flight. Used on teardown, so a sync's last writes survive. */
  async flush(): Promise<void> {
    if (this.#scheduledWrite) await this.#scheduledWrite
    await this.#writeQueue
  }
}

/**
 * Satisfies the Railgun SDK's `Host.keystore`, whose whole contract is "derive a BIP-32 path".
 *
 * Deliberately *not* the SDK's own `MnemonicKeystore`: that one takes the recovery phrase and
 * keeps it, so handing it the user's seed would put the phrase inside an unaudited alpha
 * dependency for the lifetime of the plugin. This derives through
 * `KeystoreController.deriveRailgunKey` instead, which whitelists Railgun's two derivation
 * paths and never returns the phrase.
 *
 * The cache both satisfies the SDK's "same path MUST return the same key" requirement and keeps
 * `deriveAt` cheap - every call would otherwise re-run the seed's pbkdf2. It is bounded by the
 * two paths the SDK asks for, and its lifetime is the instance's: RailgunController drops the
 * instance (and with it the derived keys) whenever the keystore locks or the seed changes.
 */
export class AmbireRailgunKeystore implements RailgunHostKeystore {
  readonly _brand = 'Keystore' as const

  #deriveKey: (path: string) => Promise<Hex>

  #cache = new Map<string, Hex>()

  constructor(deriveKey: (path: string) => Promise<Hex>) {
    this.#deriveKey = deriveKey
  }

  async deriveAt(path: string): Promise<Hex> {
    const cached = this.#cache.get(path)
    if (cached) return cached

    const key = await this.#deriveKey(path)
    this.#cache.set(path, key)

    return key
  }
}

/**
 * Adapter satisfying @kohaku-eth/plugins' `Host.provider` (`EthereumProvider`), needed to
 * build the Host passed to `createRailgunPlugin`. `@kohaku-eth/provider` ships a ready-made
 * version of this (the `ethers()` helper from its `./ethers` subpath export), but that
 * subpath isn't resolvable under this repo's `moduleResolution: "node"` (classic resolution
 * doesn't consult package.json "exports" maps) - and using a local ambient `.d.ts` shim +
 * side-effect import to work around that turned out to cascade into real Webpack/runtime
 * problems (module-not-found at build time, then at service-worker runtime once ignored).
 * Reimplementing the small interface directly over an ethers `JsonRpcProvider` avoids all
 * of that. Parameter/return types are inferred contextually from `EthereumProvider<T>`
 * below, so no `ox` (its dependency) types need to be imported by name.
 */
const toEthereumProvider = (provider: JsonRpcProvider): EthereumProvider<JsonRpcProvider> => ({
  _internal: provider,
  async getChainId() {
    const network = await provider.getNetwork()
    return network.chainId
  },
  async getLogs(filter) {
    const logs = await provider.getLogs(filter as any)
    return logs.map((log) => ({
      blockNumber: BigInt(log.blockNumber),
      topics: log.topics as unknown as string[],
      data: log.data,
      address: log.address
    }))
  },
  async getBlockNumber() {
    return BigInt(await provider.getBlockNumber())
  },
  async waitForTransaction(txHash) {
    await provider.waitForTransaction(txHash)
  },
  async getBalance(address) {
    return provider.getBalance(address)
  },
  async getCode(address) {
    return provider.getCode(address)
  },
  async getTransactionReceipt(txHash) {
    const receipt = await provider.getTransactionReceipt(txHash)
    if (!receipt) return null

    return {
      blockNumber: BigInt(receipt.blockNumber),
      status: BigInt(receipt.status ?? 0),
      gasUsed: receipt.gasUsed,
      logs: receipt.logs.map((log) => ({
        blockNumber: BigInt(log.blockNumber),
        topics: log.topics as unknown as string[],
        data: log.data,
        address: log.address
      }))
    }
  },
  async request(req) {
    return provider.send(req.method, (req.params as unknown as any[]) ?? [])
  },
  async call(callParams) {
    // `CallData`'s calldata field is named `input` (see @kohaku-eth/provider's type),
    // while ethers' TransactionRequest expects `data` - passing the object straight
    // through (as the code here previously did) silently drops the calldata, producing
    // an empty `0x` call. This is what caused the Railgun UTXO tree verification call to
    // hard-revert with `require(false)` - it looked like a contract/address problem, but
    // was this field-name mismatch turning every verification call into an empty-data one.
    const result = await provider.call({
      to: callParams.to,
      from: callParams.from,
      data: callParams.input,
      value: callParams.value,
      gasLimit: callParams.gas,
      gasPrice: callParams.gasPrice
    })
    return (result || undefined) as `0x${string}` | undefined
  },
  async estimateGas(callParams) {
    return provider.estimateGas({
      to: callParams.to,
      from: callParams.from,
      data: callParams.input,
      value: callParams.value,
      gasPrice: callParams.gasPrice
    })
  },
  async getGasPrice() {
    const feeData = await provider.getFeeData()
    return feeData.gasPrice ?? 0n
  }
})

/**
 * Adapter satisfying @kohaku-eth/railgun's `Eip1193Provider`, needed only for
 * `SimpleSmartAccount` (the disposable-key broadcast path). The SDK's own equivalent
 * adapter (used internally by `createRailgunPlugin`) isn't exported from the package,
 * so this is a minimal reimplementation over an ethers `JsonRpcProvider`.
 */
class RailgunEip1193ProviderAdapter implements Eip1193Provider {
  #provider: JsonRpcProvider

  constructor(provider: JsonRpcProvider) {
    this.#provider = provider
  }

  async getChainId(): Promise<bigint> {
    const network = await this.#provider.getNetwork()
    return network.chainId
  }

  async getBlockNumber(): Promise<bigint> {
    return BigInt(await this.#provider.getBlockNumber())
  }

  async getLogs(
    address: `0x${string}`,
    eventSignature: `0x${string}` | undefined,
    fromBlock: number | undefined,
    toBlock: number | undefined
  ): Promise<RawLog[]> {
    const logs = await this.#provider.getLogs({
      address,
      topics: eventSignature ? [eventSignature] : undefined,
      fromBlock,
      toBlock
    })

    return logs.map((log) => ({
      blockNumber: log.blockNumber,
      // Not available from eth_getLogs without an extra per-block RPC call.
      blockTimestamp: null,
      transactionHash: log.transactionHash as `0x${string}`,
      address: log.address as `0x${string}`,
      topics: log.topics as unknown as `0x${string}`[],
      data: log.data as `0x${string}`
    }))
  }

  async ethCall(to: `0x${string}`, data: `0x${string}`): Promise<`0x${string}`> {
    return (await this.#provider.call({ to, data })) as `0x${string}`
  }

  async estimateGas(
    to: `0x${string}`,
    from: `0x${string}` | undefined,
    data: `0x${string}`
  ): Promise<bigint> {
    return this.#provider.estimateGas({ to, from, data })
  }

  async getGasPrice(): Promise<bigint> {
    const feeData = await this.#provider.getFeeData()
    return feeData.gasPrice ?? 0n
  }

  async getTransactionCount(address: `0x${string}`, block: number | undefined): Promise<bigint> {
    return BigInt(await this.#provider.getTransactionCount(address, block))
  }
}

export class RailgunController extends EventEmitter implements IRailgunController {
  #keystore: IKeystoreController

  #networks: INetworksController

  #providers: IProvidersController

  #selectedAccount: ISelectedAccountController

  #storage: IStorageController

  #fetch: Fetch

  #loadWasm: () => Promise<Response | BufferSource>

  #sendUiMessage: (params: object) => void

  #pimlicoApiKey?: string

  #pluginStorage: RailgunHostStorageAdapter

  // One plugin instance per chain: `createRailgunPlugin` resolves its ChainConfig from the
  // provider's chain id, so a plugin is bound to a single chain for its whole life.
  #plugins = new Map<string, RailgunPlugin>()

  /**
   * The provider instance each plugin was built with. ProvidersController destroys and replaces
   * providers when an RPC url changes or a network is removed, and a destroyed ethers provider
   * throws on use - so without this comparison a plugin would keep holding a dead provider and
   * Railgun would silently stop working until the background restarted.
   */
  #providerInstances = new Map<string, RPCProvider>()

  /** Chains the user opted into this session. Sync re-initializes any that got torn down. */
  #enabledChainIds = new Set<string>()

  #railgunKeystore: AmbireRailgunKeystore | null = null

  // Which seed `#railgunKeystore` derives from, so a changed selected account (a different
  // recovery phrase, hence a different Railgun identity) is detected and torn down.
  #railgunKeystoreSeedId: string | null = null

  #unsubscribers: (() => void)[] = []

  initialLoadPromise?: Promise<void>

  /**
   * The wallet's 0zk address - one for every chain, see #resolveRailgunAddress. Null until
   * Railgun has been initialized once, since deriving it needs an unlocked keystore and the WASM.
   */
  railgunAddress: string | null = null

  chains: { [chainId: string]: RailgunChainState } = {}

  activity: RailgunActivityEntry[] = []

  /**
   * Serializes everything that reaches into the SDK's WASM objects.
   *
   * wasm-bindgen keeps those objects behind a Rust RefCell, and every method the plugin drives
   * (`sync`, `balance`, `register`, `build`, `prepareUserOp`) takes `&mut self` - so a second
   * concurrent call aborts the module with "recursive use of an object detected which would lead
   * to unsafe aliasing in rust", and the promise it was driving never settles, leaving the UI on
   * "Syncing shielded balances..." forever.
   *
   * That is not hypothetical. Enabling Railgun emits an update the moment the plugin exists,
   * which starts the periodic balance refresh (ContinuousUpdatesController, with
   * `runImmediately: true`) while `#init`'s own first sync is still in flight - two `balance()`
   * calls on the same provider.
   */
  #wasmQueue: Promise<unknown> = Promise.resolve()

  // Private operations (prove + broadcast) take minutes. A background refresh queued behind one
  // would be pure waste, since the broadcast re-syncs when it settles - so those are skipped
  // outright rather than serialized. Not public state: the UI already tracks the same thing
  // through `statuses`.
  #isBroadcastingPrivateOperation = false

  // Reset by any successful sync - see MAX_QUIET_BACKGROUND_SYNC_FAILURES.
  #consecutiveBackgroundSyncFailures = 0

  statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS> = STATUS_WRAPPED_METHODS

  constructor({
    keystore,
    networks,
    providers,
    selectedAccount,
    storage,
    fetch,
    loadWasm,
    sendUiMessage,
    pimlicoApiKey,
    eventEmitterRegistry
  }: {
    keystore: IKeystoreController
    networks: INetworksController
    providers: IProvidersController
    selectedAccount: ISelectedAccountController
    storage: IStorageController
    fetch: Fetch
    // The WASM bytes are a build asset (see webpack CopyPlugin config) - ambire-common is
    // environment-agnostic and can't know the asset URL, so the loader is injected by the
    // platform layer (web/mobile).
    loadWasm: () => Promise<Response | BufferSource>
    sendUiMessage: (params: object) => void
    // Used only for the unshield/private-transfer broadcast path (ERC-4337 UserOp via
    // Pimlico). Optional - that flow simply isn't available without it.
    pimlicoApiKey?: string
    eventEmitterRegistry?: IEventEmitterRegistryController
  }) {
    super(eventEmitterRegistry)
    this.#keystore = keystore
    this.#networks = networks
    this.#providers = providers
    this.#selectedAccount = selectedAccount
    this.#storage = storage
    this.#fetch = fetch
    this.#loadWasm = loadWasm
    this.#sendUiMessage = sendUiMessage
    this.#pimlicoApiKey = pimlicoApiKey
    this.#pluginStorage = new RailgunHostStorageAdapter(storage, (error) =>
      this.emitError({
        message: 'Could not save the Railgun sync state. It will be rebuilt on the next sync.',
        level: 'silent',
        error: error instanceof Error ? error : new Error('railgun: plugin storage write failed')
      })
    )

    // Cleared when done, like the other controllers do, so the resolved promise isn't carried in
    // the serialized state sent to the UI on every update.
    this.initialLoadPromise = this.#load().finally(() => {
      this.initialLoadPromise = undefined
    })
  }

  async #load() {
    // Everything `supportedChainIds` and `unavailableReason` read has to be loaded first,
    // otherwise the UI is briefly told Railgun is unavailable ('no-seed', because the selected
    // account and the keystore's keys aren't there yet) on every start.
    await this.#networks.initialLoadPromise
    await this.#providers.initialLoadPromise
    await this.#keystore.initialLoadPromise
    await this.#selectedAccount.initialLoadPromise

    this.activity = await this.#storage.get('railgunActivity', [])

    this.#subscribeToDependencies()
    this.emitUpdate()
  }

  /**
   * Railgun holds derived key material and a live RPC provider, so it can't just read its
   * dependencies on demand - it has to react when they change. Each of these either
   * invalidates a plugin or changes what `supportedChainIds`/`unavailableReason` report, and
   * both of those are getters, whose values only reach the UI if an update is emitted.
   */
  #subscribeToDependencies() {
    this.#unsubscribers.push(
      this.#keystore.onUpdate((forceEmit) => {
        // Locking must drop the derived Railgun keys, not just hide the UI.
        if (!this.#keystore.isUnlocked && this.#plugins.size) this.#teardown()

        this.propagateUpdate(forceEmit)
      }, 'railgun'),

      this.#selectedAccount.onUpdate((forceEmit) => {
        const seedId = this.#getSeedIdForSelectedAccount()
        // A different recovery phrase is a different Railgun identity, so nothing built for
        // the previous one may be reused. Railgun stays opt-in, so the new account is not
        // initialized here - the user enables it.
        if (seedId !== this.#railgunKeystoreSeedId && this.#plugins.size) this.#teardown()

        this.propagateUpdate(forceEmit)
      }, 'railgun'),

      this.#providers.onUpdate((forceEmit) => {
        const staleChainIds = [...this.#plugins.keys()].filter(
          (chainId) => this.#providers.providers[chainId] !== this.#providerInstances.get(chainId)
        )

        // Kept in `#enabledChainIds`, so the next sync rebuilds them against the new provider
        // rather than leaving Railgun quietly dead.
        staleChainIds.forEach((chainId) => this.#teardownChain(chainId))

        this.propagateUpdate(forceEmit)
      }, 'railgun'),

      // Subscribed to purely so `supportedChainIds` (and everything derived from it) reaches
      // the UI: getter values are not propagated on their own.
      this.#networks.onUpdate((forceEmit) => this.propagateUpdate(forceEmit), 'railgun')
    )
  }

  /**
   * The chains Railgun can run on for this wallet: the SDK's own capability, narrowed to the
   * networks the user actually has and that have a provider.
   *
   * In practice this resolves to one chain: Sepolia only exists in the testnet network set and
   * Ethereum only in the mainnet one, so a wallet sees whichever matches its
   * `defaultNetworksMode` (both only if the other was added as a custom network).
   */
  get supportedChainIds(): string[] {
    return RAILGUN_SUPPORTED_CHAIN_IDS.map((chainId) => chainId.toString()).filter(
      (chainId) =>
        this.#networks.networks.some((network) => network.chainId.toString() === chainId) &&
        !!this.#providers.providers[chainId]
    )
  }

  /**
   * The chains that currently have a live plugin, i.e. the ones whose shielded balances can
   * actually be spent. A supported chain that failed to initialize (or whose sync timed out and
   * had its plugin discarded) is deliberately absent, so the UI can offer each action against
   * the chains that work instead of letting the user start one that can only fail.
   */
  get initializedChainIds(): string[] {
    // Ordered by `supportedChainIds` rather than by insertion order, so the chain order the UI
    // renders stays stable across re-initializations.
    return this.supportedChainIds.filter((chainId) => this.#plugins.has(chainId))
  }

  get unavailableReason(): RailgunUnavailableReason | null {
    // Structural reasons first: they don't change by unlocking, so reporting 'locked' for a
    // hardware-wallet account would send the user to do something that can't help.
    if (!this.#getSeedIdForSelectedAccount()) return 'no-seed'
    if (!this.supportedChainIds.length) return 'unsupported-network'
    if (!this.#keystore.isUnlocked) return 'locked'

    return null
  }

  get isAvailableForSelectedAccount(): boolean {
    return !this.unavailableReason
  }

  /**
   * Whether Railgun is usable at all (drives the Enable/refresh UI). Deliberately "any chain"
   * rather than "every chain": one supported network with a broken RPC must not hide a working
   * shielded balance on the other one - that chain reports its own failure through
   * `chains[chainId].error`.
   */
  get isInitialized(): boolean {
    return this.#plugins.size > 0
  }

  /**
   * The Railgun identity is derived from the recovery phrase the selected account's key comes
   * from, so it only exists for accounts that have one: hardware wallets, private-key imports
   * and view-only accounts have no seed to derive from.
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

  #getChainState(chainId: string): RailgunChainState {
    return (
      this.chains[chainId] || {
        chainId,
        wrappedBaseTokenAddress: null,
        syncStatus: 'idle',
        lastSyncedAt: null,
        balances: [],
        error: null
      }
    )
  }

  /**
   * Writes a chain's state and emits. The teardown paths below deliberately don't go through
   * this: they run from `onUpdate` callbacks, where an update has to be forwarded with
   * `propagateUpdate` rather than emitted, so they mutate state and leave emitting to the
   * caller.
   */
  #updateChainState(chainId: string, update: Partial<RailgunChainState>) {
    this.#setChainState(chainId, update)
    this.emitUpdate()
  }

  #setChainState(chainId: string, update: Partial<RailgunChainState>) {
    this.chains = {
      ...this.chains,
      [chainId]: { ...this.#getChainState(chainId), ...update }
    }
  }

  /** Does not emit - see #updateChainState. */
  #teardownChain(chainId: string) {
    this.#plugins.delete(chainId)
    this.#providerInstances.delete(chainId)
    this.#setChainState(chainId, { syncStatus: 'idle' })
  }

  /** Drops everything derived from the current keystore/account state. Does not emit. */
  #teardown() {
    this.#plugins.clear()
    this.#providerInstances.clear()
    this.#enabledChainIds.clear()
    this.#railgunKeystore = null
    this.#railgunKeystoreSeedId = null
    this.railgunAddress = null
    this.chains = Object.fromEntries(
      Object.keys(this.chains).map((chainId) => [
        chainId,
        {
          ...this.#getChainState(chainId),
          syncStatus: 'idle' as const,
          balances: [],
          // A teardown is not a failure of the chain, so a stale error from the previous
          // session must not survive into the next Enable.
          error: null
        }
      ])
    )

    // The last writes of an interrupted sync are still only in memory.
    this.#pluginStorage.flush().catch((error) => {
      this.emitError({
        message: 'Could not save the Railgun sync state.',
        level: 'silent',
        error
      })
    })
  }

  destroy() {
    this.#unsubscribers.forEach((unsubscribe) => unsubscribe())
    this.#unsubscribers = []
    this.#teardown()
    this.emitUpdate()
  }

  /**
   * Runs `operation` once every previously queued one has settled - see `#wasmQueue` for why
   * that has to be guaranteed. Every method here that touches a plugin goes through this, and
   * the ones it calls internally (`#initChain`, `#syncChain`, `#broadcastPrivateOperation`)
   * assume the queue is already held, so they must never be called from outside one.
   */
  #queueWasmOperation<T>(operation: () => Promise<T>): Promise<T> {
    // Chained off the previous operation's *settlement* rather than its success, so one failure
    // doesn't wedge the queue for the rest of the session.
    const operationPromise = this.#wasmQueue.then(operation, operation)

    this.#wasmQueue = operationPromise.then(
      () => {},
      () => {}
    )

    return operationPromise
  }

  /**
   * Enables Railgun for the selected chain. Opt-in by design: nothing here runs until the user
   * asks for it, because initializing means deriving privacy keys and syncing a shielded pool.
   */
  async init() {
    await this.withStatus('init', () => this.#queueWasmOperation(() => this.#init()), true)
  }

  /**
   * Brings up every supported chain, rather than one the user picked. The 0zk identity is
   * wallet-wide (see #resolveRailgunAddress) and each chain holds its own shielded pool, so
   * "which network am I on" is not a question the user should have to answer - the Privacy
   * screen shows every chain's balances at once, exactly like the dashboard does for public ones.
   *
   * Sequential on purpose, and not just because #queueWasmOperation would serialize it anyway:
   * each chain emits its state as soon as it lands, so the first chain's balances are on screen
   * while the next one is still walking its pool. A chain that fails is recorded in its own
   * state and skipped, so one dead RPC can't take the working chains down with it - only an
   * across-the-board failure is reported as one.
   */
  async #init() {
    await this.initialLoadPromise

    const chainIds = this.supportedChainIds
    if (!chainIds.length)
      throw new EmittableError({
        message:
          'Railgun is not available on any of your networks. Add Ethereum (or Sepolia in testnet mode) and try again.',
        level: 'expected',
        error: new Error('railgun: no supported chain available')
      })

    const errors: any[] = []

    for (const chainId of chainIds) {
      try {
        // Marked as enabled only once it actually came up: a chain that failed to initialize
        // (locked keystore, dead RPC) would otherwise stay in the set and make every periodic
        // sync retry - and fail - on its own, with the user never having a working Railgun to
        // show for it.
        await this.#initChain(chainId)
        this.#enabledChainIds.add(chainId)

        await this.#syncChain(chainId)
        this.#updateChainState(chainId, { error: null })
      } catch (error: any) {
        errors.push(error)
        this.#updateChainState(chainId, {
          error: error?.message || 'Could not enable Railgun on this network.'
        })
      }
    }

    // Every chain failed, so there is nothing on screen for the per-chain errors to sit next to -
    // the first one is re-thrown so `withStatus` surfaces it as the reason Enable did nothing.
    if (errors.length === chainIds.length) throw errors[0]
  }

  async #initChain(chainId: string) {
    if (this.#plugins.has(chainId)) return

    const unavailableReason = this.unavailableReason
    if (unavailableReason) {
      const messages: { [reason in RailgunUnavailableReason]: string } = {
        locked: 'Please unlock your wallet before enabling Railgun privacy features.',
        'no-seed':
          'Railgun privacy requires an account created from a recovery phrase stored in this wallet, because its private address is derived from that phrase. Hardware wallet and private key accounts cannot use it.',
        'unsupported-network': 'Railgun is not available on any of your networks.'
      }

      throw new EmittableError({
        message: messages[unavailableReason],
        level: 'expected',
        error: new Error(`railgun: unavailable (${unavailableReason})`)
      })
    }

    const seedId = this.#getSeedIdForSelectedAccount()
    if (!seedId)
      throw new EmittableError({
        message: 'Could not find the recovery phrase this account was created from.',
        level: 'major',
        error: new Error('railgun: no seed id for the selected account')
      })

    const provider = this.#providers.providers[chainId]
    if (!provider)
      throw new EmittableError({
        message: 'The RPC provider for this network is not available.',
        level: 'major',
        error: new Error(`railgun: missing provider for chain ${chainId}`)
      })

    this.#updateChainState(chainId, { syncStatus: 'initializing' })

    // Must precede any other call into the package: everything else (`chainConfig` included)
    // reaches into the WASM, and `createRailgunPlugin`'s own `ensureInitialized()` can't load
    // the bytes itself in this environment. It is a no-op once the module is up, so calling it
    // per chain is free.
    //
    // Deliberately called without a log level: `ensureInitialized` applies the level on every
    // call, so requesting one here and again through `createRailgunPlugin`'s config below would
    // request it twice - which panics. See #takeSdkLogLevel.
    await ensureInitialized(await this.#loadWasm())

    const chain = chainConfig(BigInt(chainId))
    if (!chain)
      throw new EmittableError({
        message: 'Railgun is not supported on this network.',
        level: 'major',
        error: new Error(
          `railgun: the SDK has no ChainConfig for chain ${chainId}, despite it being listed in RAILGUN_SUPPORTED_CHAIN_IDS`
        )
      })

    const railgunKeystore = this.#getRailgunKeystore(seedId)

    const host: RailgunHost = {
      keystore: railgunKeystore,
      storage: this.#pluginStorage,
      provider: toEthereumProvider(provider as JsonRpcProvider),
      network: {
        // node-fetch's Response/RequestInfo (Ambire's Fetch type) and the DOM lib's
        // Response/RequestInfo (Host.network's declared shape) are structurally
        // equivalent at runtime but distinct nominal types, hence the local cast here.
        fetch: (input, init) =>
          this.#fetch(input as unknown as string, init as any) as unknown as Promise<Response>
      }
    }

    const plugin = await createRailgunPlugin(host, {
      keyIndex: RAILGUN_KEY_INDEX,
      // The SDK syncs with `UtxoSyncer.chained([subsquid, rpc])`: the Subsquid indexer covers
      // history, and the RPC syncer scans everything above it. Crucially, Subsquid reports its
      // `latest_block` from `transactions(orderBy: blockNumber_DESC, limit: 1)` - the last
      // Railgun *transact* on the chain, NOT the indexer's head. On Sepolia those are sparse
      // (hours to days apart), so the RPC syncer is always handed a tail of thousands of blocks
      // that grows by ~7.2k blocks/day of testnet inactivity. At the SDK's default batch size of
      // 10 that is one `eth_getLogs` per 10 blocks, i.e. hundreds of sequential round-trips per
      // sync - which is why `sync()` never finished and the UI sat on "Syncing shielded
      // balances..." indefinitely. Hence the per-chain window - see
      // RAILGUN_RPC_SYNC_BATCH_SIZE_IN_BLOCKS for why Ethereum needs the opposite treatment.
      rpcBatchSize:
        RAILGUN_RPC_SYNC_BATCH_SIZE_IN_BLOCKS[chainId] ??
        DEFAULT_RAILGUN_RPC_SYNC_BATCH_SIZE_IN_BLOCKS,
      // POI (Proof of Innocence) is left at the SDK's default (enabled). It was disabled here
      // while the integration was Sepolia-only, on the belief that the POI aggregator did not
      // serve Sepolia - that turned out to be wrong: both chain configs point at
      // https://ppoi.fdi.network/ with the same list key, and the aggregator answers
      // `ppoi_validated_txid` and `ppoi_pois_per_list` for chain 11155111 as well as for 1.
      //
      // With POI on, `balance()` tags each amount with a PoiStatus and the SDK's note selection
      // will only spend 'Valid' notes - for unshields as well as private transfers. That is why
      // balances are kept split per status all the way to the UI (see
      // libs/railgun/balances.ts): a freshly shielded amount is 'Missing' for Railgun's ~1h
      // Unshield-Only Standby Period and genuinely cannot be moved yet.
      logLevel: this.#takeSdkLogLevel()
    })

    this.#plugins.set(chainId, plugin)
    this.#providerInstances.set(chainId, provider)
    await this.#resolveRailgunAddress(railgunKeystore)

    this.#updateChainState(chainId, {
      // The chain's wrapped native token (WETH here) - exposed so the UI can label the
      // corresponding shielded balance and the native shield/unshield flows without
      // hardcoding a possibly-stale address.
      wrappedBaseTokenAddress: chain.wrappedBaseToken,
      syncStatus: 'ready'
    })
  }

  /**
   * Resolves the one 0zk address shown for this wallet, deliberately built with no chain scope.
   *
   * `RailgunSigner.privateKey(spending, viewing, chainId)` maps a chain id to `ChainId::Evm` and
   * `undefined` to `ChainId::All` - a "any chain" address. The keys are the same either way: the
   * chain only changes the middle chunk of the bech32m encoding, while the master and viewing
   * public keys it carries are byte-identical (which is what makes the funds spendable no matter
   * which variant a sender used).
   *
   * The chain-scoped variant is what `plugin.instanceId()` reports, but showing it would describe
   * a restriction that does not exist on-chain. A Railgun commitment binds to
   * `npk = poseidon(masterPublicKey, random)`; there is no chain field anywhere in a note, and the
   * shield calldata this SDK builds is byte-identical for all three variants (verified by masking
   * out the per-build `random` and diffing). The chain field is a hint for the sender's wallet,
   * decoded and discarded - this SDK does not even validate it.
   *
   * So one address across chains is the accurate representation, not a convenience. What stays
   * per-chain is the balance: each chain has its own Railgun Smart Wallet and its own UTXO tree,
   * exactly like one EVM address holding separate balances per network.
   */
  async #resolveRailgunAddress(railgunKeystore: AmbireRailgunKeystore) {
    // Free after `createRailgunPlugin` derived the same two paths through this same instance -
    // AmbireRailgunKeystore caches per path, so this is a cache hit rather than another pbkdf2.
    const [spendingKey, viewingKey] = await Promise.all([
      railgunKeystore.deriveAt(RailgunSigner.spendingKeyPath(RAILGUN_KEY_INDEX)),
      railgunKeystore.deriveAt(RailgunSigner.viewingKeyPath(RAILGUN_KEY_INDEX))
    ])

    this.railgunAddress = RailgunSigner.privateKey(spendingKey, viewingKey, undefined).address
    this.emitUpdate()
  }

  /**
   * The log level to hand `createRailgunPlugin`, which is the single place the SDK's tracing
   * dispatcher may be installed from - see `hasInstalledSdkLogger`. Worth having at all because
   * a cold sync is a long opaque wait from the outside, and the SDK's own logs are the only thing
   * that narrates it (paginating the indexer, downloading POI artifacts, proving).
   */
  #takeSdkLogLevel(): LogLevel {
    if (!this.isDebugLogEnabled || hasInstalledSdkLogger) return 'Off'

    hasInstalledSdkLogger = true

    return 'Debug'
  }

  #getRailgunKeystore(seedId: string): AmbireRailgunKeystore {
    if (this.#railgunKeystore && this.#railgunKeystoreSeedId === seedId)
      return this.#railgunKeystore

    this.#railgunKeystoreSeedId = seedId
    this.#railgunKeystore = new AmbireRailgunKeystore((path) =>
      this.#keystore.deriveRailgunKey(seedId, path)
    )

    return this.#railgunKeystore
  }

  #addActivityEntry(
    entry: Omit<RailgunActivityEntry, 'id' | 'status' | 'createdAt'> & {
      status?: RailgunActivityStatus
    }
  ) {
    const createdAt = Date.now()
    // Unique without a uuid dependency: two entries can't be created for the same asset on the
    // same chain in the same millisecond, since every op goes through one awaited call per action.
    const id = `${entry.chainId}-${entry.type}-${entry.tokenAddress}-${createdAt}`

    this.activity = [
      { ...entry, id, status: entry.status || 'pending', createdAt },
      ...this.activity
    ].slice(0, MAX_ACTIVITY_ENTRIES)
    this.emitUpdate()
    this.#persistActivity()

    return id
  }

  #updateActivityEntry(id: string, update: Partial<RailgunActivityEntry>) {
    this.activity = this.activity.map((entry) =>
      entry.id === id ? { ...entry, ...update } : entry
    )
    this.emitUpdate()
    this.#persistActivity()
  }

  // Deliberately not awaited by the callers: the activity log is a UI convenience, so a slow
  // (or failed) write must not delay - or fail - the operation that produced the entry.
  #persistActivity() {
    this.#storage.set('railgunActivity', this.activity).catch((error) => {
      this.emitError({
        message: 'Could not save the Railgun activity log.',
        level: 'silent',
        error
      })
    })
  }

  /**
   * Marks pending shields as successful once their token's shielded balance grows. Shields are
   * broadcast through the regular sign & broadcast flow, so this controller never sees their
   * receipt - the balance is the only signal it gets. Deliberately a heuristic: an incoming
   * private transfer of the same token, in the same window, resolves the entry too. Acceptable
   * for now; a real implementation would match the shield's txn id.
   *
   * Compares totals across every POI status, not spendable amounts: a shield lands as 'Missing'
   * and only becomes 'Valid' about an hour later, so a spendable-only comparison would leave
   * every shield stuck on "pending" until the standby period elapsed.
   */
  #resolvePendingShields(chainId: string, previousBalances: RailgunShieldedBalance[]) {
    const currentBalances = this.#getChainState(chainId).balances

    const getTotal = (balances: RailgunShieldedBalance[], tokenAddress: string) =>
      getRailgunTokenBalance(balances, tokenAddress)?.totalAmount || 0n

    const hasGrown = (entry: RailgunActivityEntry) => {
      // Native shields land in the pool as the wrapped base token
      const poolTokenAddress = entry.isNative
        ? this.#getChainState(chainId).wrappedBaseTokenAddress
        : entry.tokenAddress
      if (!poolTokenAddress) return false

      return (
        getTotal(currentBalances, poolTokenAddress) > getTotal(previousBalances, poolTokenAddress)
      )
    }

    const resolvedActivity = this.activity.map((entry) =>
      entry.chainId === chainId &&
      entry.type === 'shield' &&
      entry.status === 'pending' &&
      hasGrown(entry)
        ? { ...entry, status: 'success' as const }
        : entry
    )

    const hasResolvedAny = resolvedActivity.some(
      (entry, index) => entry.status !== this.activity[index]?.status
    )
    if (!hasResolvedAny) return

    this.activity = resolvedActivity
    this.#persistActivity()
  }

  /**
   * `isBackgroundUpdate` marks the periodic refresh (see ContinuousUpdatesController) as opposed
   * to the user pressing refresh. It only changes how failures are reported: a background sync
   * fails for boring, transient reasons (an RPC hiccup, POI proving running long), and it runs
   * on a timer - so surfacing every failure would toast the user and report to Sentry on a loop.
   * Persistent failure still escalates, see MAX_QUIET_BACKGROUND_SYNC_FAILURES.
   */
  async sync(params?: { isBackgroundUpdate?: boolean }) {
    // A private operation in flight already re-syncs when it settles, so syncing alongside it
    // would be both redundant and a way to wedge the (non-reentrant) WASM module.
    if (this.#isBroadcastingPrivateOperation) {
      this.debugLog('sync', 'skipped - a private operation is in flight')
      return
    }

    await this.withStatus(
      'sync',
      () => this.#queueWasmOperation(() => this.#sync(!!params?.isBackgroundUpdate)),
      true
    )
  }

  async #sync(isBackgroundUpdate: boolean) {
    if (!this.#enabledChainIds.size)
      throw new EmittableError({
        message: 'Railgun is not initialized yet.',
        level: 'minor',
        error: new Error('railgun: sync called before init')
      })

    const errors: any[] = []

    /**
     * A user-initiated refresh retries every supported chain, not just the enabled ones. A chain
     * that failed at Enable time is deliberately left out of `#enabledChainIds` so the periodic
     * refresh doesn't keep hammering it, but that would otherwise make it unreachable: once one
     * chain is up, `isInitialized` is true, so the UI shows Refresh instead of Enable and there
     * is nothing left to press. Refresh IS the retry.
     */
    const chainIds = isBackgroundUpdate ? [...this.#enabledChainIds] : this.supportedChainIds

    // Sequentially, never in parallel - see #wasmQueue. This runs inside the queue, so no
    // other WASM operation can interleave with it either. Each chain's failure is caught and
    // recorded on that chain, so a refresh still updates the chains that do work.
    for (const chainId of chainIds) {
      const { lastSyncedAt } = this.#getChainState(chainId)
      const isFreshEnough =
        !!lastSyncedAt && Date.now() - lastSyncedAt < MIN_BACKGROUND_SYNC_AGE_IN_MS

      if (isBackgroundUpdate && isFreshEnough) {
        this.debugLog('sync', 'skipped a background sync - already fresh', {
          chainId,
          lastSyncedAt
        })
        continue
      }

      try {
        // A chain whose provider was replaced (or that was never built) is rebuilt here, so a
        // mid-session RPC change recovers on its own instead of needing a restart.
        if (!this.#plugins.has(chainId)) await this.#initChain(chainId)

        await this.#syncChain(chainId)
        // Same rule as in #init: a chain joins the periodic refresh only once it has actually
        // worked, which is what lets a manual refresh recover a chain that failed at Enable.
        this.#enabledChainIds.add(chainId)
        this.#updateChainState(chainId, { error: null })
      } catch (error: any) {
        errors.push(error)
        this.#updateChainState(chainId, {
          error: error?.message || 'Could not refresh the shielded balances on this network.'
        })
      }
    }

    if (!errors.length) {
      this.#consecutiveBackgroundSyncFailures = 0
      return
    }

    // Only the first failure is escalated: the rest are already on their own chain's state, and
    // stacking one toast per chain says nothing the screen doesn't already show.
    const [error] = errors

    if (!isBackgroundUpdate) throw error

    this.#consecutiveBackgroundSyncFailures += 1
    this.debugLog('sync', 'background sync failed', {
      consecutiveFailures: this.#consecutiveBackgroundSyncFailures,
      failedChainsCount: errors.length,
      error
    })

    if (this.#consecutiveBackgroundSyncFailures < MAX_QUIET_BACKGROUND_SYNC_FAILURES) return

    throw new EmittableError({
      message:
        'Your shielded balances have not refreshed for a while. Check your network connection and RPC for this network.',
      level: 'major',
      error
    })
  }

  async #syncChain(chainId: string) {
    const plugin = this.#plugins.get(chainId)
    if (!plugin)
      throw new EmittableError({
        message: 'Railgun is not initialized yet.',
        level: 'minor',
        error: new Error(`railgun: sync called before init for chain ${chainId}`)
      })

    const isFirstSync = !this.#getChainState(chainId).lastSyncedAt
    this.#updateChainState(chainId, { syncStatus: 'syncing' })
    // Logged on the way in as well as on the way out: without a start line there is no way to
    // tell a slow sync from a hung one in the log.
    this.debugLog('sync', 'shielded balance sync started', { chainId, isFirstSync })

    // `balance()` syncs the UTXO tree before answering, so its duration is dominated by the
    // chain scan (and, with POI on, by proving), not the balance math. Timed because a slow
    // scan is indistinguishable from a hang in the UI - see the rpcBatchSize note.
    const syncStartedAt = Date.now()
    let hasTimedOut = false
    try {
      // Soft timeout: the WASM scan keeps running in the background (withTimeout can't cancel
      // it), but giving up on awaiting it is what lets the status - and with it the refresh
      // button and every other action - come back. Because the scan is still running, this
      // chain's plugin is discarded in the finally below: the abandoned Rust object is still
      // mutably borrowed, so touching it again is what produces "recursive use of an object
      // detected". A rebuilt plugin is a different object, so it can't alias the abandoned one.
      //
      // `balance()` groups amounts per (asset, poiStatus) pair and tags each entry, which is
      // what the spendable/pending split below relies on. Worth confirming against a live chain:
      // the WASM's own doc comment for `RailgunProvider.balance` claims it "only returns the
      // spendable balance" when POI is enabled, which would contradict the SDK's TS layer
      // grouping by status. If a freshly shielded amount never shows up as pending, that doc
      // comment is the accurate one and this should read `plugin.notes()` instead - it returns
      // every unspent note with its own poiStatus, unfiltered.
      const balances = await withTimeout(() => plugin.balance(undefined), {
        timeoutMs: isFirstSync ? RAILGUN_FIRST_SYNC_TIMEOUT_IN_MS : RAILGUN_SYNC_TIMEOUT_IN_MS,
        message: RAILGUN_SYNC_TIMEOUT_MESSAGE
      })
      this.debugLog('sync', 'shielded balance sync completed', {
        chainId,
        isFirstSync,
        durationMs: Date.now() - syncStartedAt,
        balancesCount: balances.length
      })

      const previousBalances = this.#getChainState(chainId).balances
      this.#updateChainState(chainId, {
        balances: balances.filter(isErc20Balance).map((balance) => ({
          tokenAddress: balance.asset.contract,
          amount: balance.amount,
          poiStatus: toRailgunPoiStatus(balance.tag)
        })),
        lastSyncedAt: Date.now()
      })

      this.#resolvePendingShields(chainId, previousBalances)
    } catch (error: any) {
      // Compared against the exact message this call site handed to `withTimeout`, which is how
      // it reports a soft timeout - as opposed to an error raised by the scan itself.
      hasTimedOut = error?.message === RAILGUN_SYNC_TIMEOUT_MESSAGE

      throw error
    } finally {
      // The abandoned scan still holds a mutable borrow on this plugin's Rust objects, so the
      // plugin is dropped rather than reused. It stays in `#enabledChainIds`, so the next sync
      // builds a fresh one.
      if (hasTimedOut) this.#teardownChain(chainId)

      // Always leave a terminal status. 'ready' here means "not syncing any more", not "the sync
      // worked" - a failure is reported through emitError and `statuses.sync`. Without this a
      // failed or timed-out scan left `syncStatus` on 'syncing' forever, with nothing to reset it.
      this.#updateChainState(chainId, { syncStatus: hasTimedOut ? 'idle' : 'ready' })
    }
  }

  /**
   * Every action is scoped to the chain of the token it acts on (the UI resolves it from the
   * selected balance), because each chain is a separate shielded pool - running a chain's
   * operation through another chain's plugin would prove against the wrong UTXO tree.
   */
  #getChainPlugin(chainId: string): RailgunPlugin {
    const plugin = this.#plugins.get(chainId)

    if (!plugin)
      throw new EmittableError({
        message: 'Railgun is not ready on this network yet.',
        level: 'minor',
        error: new Error(`railgun: action attempted before init for chain ${chainId}`)
      })

    return plugin
  }

  /**
   * Builds the raw {to,data,value} calls for shielding (Ambire account -> 0zk). Shield
   * transactions must be self-broadcast (no proof/relayer needed - the source account is
   * already public), so the caller hands the returned calls to
   * `RequestsController.build({type:'calls', ...})` to go through the normal sign/broadcast
   * pipeline. Supports `dispatchAndWait` (see ProvidersController.callProviderAndSendResToUi
   * for the same requestId/sendUiMessage pattern) since `build`'s own dispatch is fire-and-forget.
   */
  async buildShieldCalls(
    {
      chainId,
      tokenAddress,
      isNative,
      amount
    }: { chainId: string; tokenAddress: `0x${string}`; isNative: boolean; amount: bigint },
    requestId: string
  ) {
    try {
      const plugin = this.#getChainPlugin(chainId)

      const asset: AssetId = isNative
        ? { __type: 'native' }
        : { __type: 'erc20', contract: tokenAddress }
      const txs = await this.#queueWasmOperation(() =>
        plugin.prepareShieldMulti([{ asset, amount }])
      )
      const shieldCalls: Call[] = txs.map((tx) => ({ to: tx.to, data: tx.data, value: tx.value }))

      // For ERC20 shields the Railgun Smart Wallet pulls the token via `transferFrom`, so it
      // needs an allowance first. The Kohaku SDK's shield builder emits ONLY the shield call
      // (no approve - confirmed there's no approve/allowance logic in the SDK or its WASM), so
      // prepend one here. Ambire batches the calls, so approve + shield land atomically. Native
      // shields wrap ETH via msg.value and need no approval.
      const calls: Call[] = []
      const [firstShieldCall] = shieldCalls
      if (!isNative && firstShieldCall) {
        // The shield call's `to` is the Railgun contract that runs `transferFrom`, i.e. the
        // exact spender to approve. Approve just `amount` (what shield pulls) - not unlimited.
        const spender = firstShieldCall.to
        const approveData = new Interface([
          'function approve(address spender, uint256 amount) returns (bool)'
        ]).encodeFunctionData('approve', [spender, amount])
        calls.push({ to: tokenAddress, data: approveData, value: 0n })
      }
      calls.push(...shieldCalls)

      // Recorded as pending here (not once signed): this is the last point in the shield flow
      // this controller is part of - from here the calls travel through RequestsController, and
      // whether they get signed and mined is only observable as a balance change on the next
      // sync (see #resolvePendingShields).
      this.#addActivityEntry({
        chainId,
        type: 'shield',
        tokenAddress,
        isNative,
        amount,
        recipient: null
      })

      this.#sendUiMessage({ requestId, ok: true, res: calls })
    } catch (error: any) {
      this.emitError({
        error,
        message: error?.message || 'Failed to build the shield transaction.',
        level: 'major'
      })
      this.#sendUiMessage({ requestId, ok: false, error: error?.message })
    }
  }

  /**
   * Broadcasts a proved private operation (unshield/transfer) via an ERC-4337 UserOp,
   * signed by a fresh disposable key generated per operation and never persisted. This is
   * what gives unshield/transfer real unlinkability: the bundler fee is paid from the
   * shielded balance itself (not this disposable key's balance, which is never funded),
   * and the disposable key/account has no other on-chain history tying it to the user -
   * this is why it differs from Shield's self-broadcast path.
   *
   * Pimlico URL uses the numeric chain id in the path (`/v2/<chainId>/rpc`), confirmed
   * against a working reference integration - an earlier guess using `/v2/sepolia/rpc`
   * was unverified and wrong. The disposable account is expected to be upgraded to a smart
   * account via EIP-7702 on the fly inside the UserOp, so a fresh, zero-balance,
   * never-delegated key should broadcast with no pre-funding.
   */
  async #broadcastPrivateOperation(
    chainId: string,
    plugin: RailgunPlugin,
    op: Parameters<RailgunPlugin['broadcast']>[0]
  ) {
    if (!this.#pimlicoApiKey)
      throw new EmittableError({
        message: 'Private sends are not available - no bundler is configured for this build.',
        level: 'major',
        error: new Error('railgun: missing Pimlico API key')
      })

    const provider = this.#providers.providers[chainId]
    if (!provider)
      throw new EmittableError({
        message: 'The RPC provider for this network is not available.',
        level: 'major',
        error: new Error(`railgun: missing provider for chain ${chainId}`)
      })

    // Fresh, single-use key - never derived from the wallet's seeds and never persisted.
    const disposableSigner = EthSigner.privateKey(Wallet.createRandom().privateKey as `0x${string}`)
    const ethersProvider = provider as JsonRpcProvider
    const eip1193Provider = new RailgunEip1193ProviderAdapter(ethersProvider)
    const smartAccount = new SimpleSmartAccount(
      disposableSigner.address,
      BigInt(chainId),
      eip1193Provider
    )
    const bundler = Bundler.pimlico(
      `https://api.pimlico.io/v2/${chainId}/rpc?apikey=${this.#pimlicoApiKey}`
    )

    plugin.setBundler(bundler)
    plugin.setSmartAccount(smartAccount, disposableSigner)

    // Snapshot the disposable EOA's on-chain state right before broadcasting, so a failure tells
    // us whether the on-the-fly EIP-7702 delegation of a zero-balance, never-delegated fresh key
    // is the blocker. Gated behind the RailgunController debug toggle and wrapped so a
    // diagnostic RPC hiccup can never abort the broadcast itself.
    if (this.isDebugLogEnabled) {
      try {
        const [nativeBalanceWei, code] = await Promise.all([
          ethersProvider.getBalance(disposableSigner.address),
          ethersProvider.getCode(disposableSigner.address)
        ])
        this.debugLog('broadcast', 'disposable signer pre-broadcast state', {
          chainId,
          address: disposableSigner.address,
          nativeBalanceWei,
          isZeroBalance: nativeBalanceWei === 0n,
          code,
          isAlreadyDelegated: code !== '0x'
        })
      } catch (diagnosticError) {
        this.debugLog('broadcast', 'failed to read disposable signer pre-broadcast state', {
          address: disposableSigner.address,
          diagnosticError
        })
      }
    }

    // Tap the raw bundler JSON-RPC traffic so we can see the actual UserOp on the wire (does it
    // carry the privacy paymaster and/or an eip7702Auth?) and the bundler's raw error response
    // (richer than the WASM-wrapped "-32521 reverted 0x"). The Kohaku bundler talks to Pimlico
    // via the GLOBAL fetch - confirmed in the SDK's wasm-bindgen shim, which calls
    // `fetch(request)` rather than the host fetch - so we wrap globalThis.fetch for the duration
    // of this broadcast only. Only wrapped when the RailgunController debug toggle is on (zero
    // overhead otherwise), and always restored in the finally below.
    const originalFetch = this.isDebugLogEnabled ? globalThis.fetch : null
    if (originalFetch) {
      const tappedFetch = async (input: any, init?: any): Promise<Response> => {
        const url = typeof input === 'string' ? input : input?.url
        const isBundlerCall = typeof url === 'string' && url.includes('api.pimlico.io')
        if (isBundlerCall) {
          try {
            const body =
              init?.body ??
              (typeof input?.clone === 'function' ? await input.clone().text() : undefined)
            this.debugLog('broadcast', 'bundler request', { url, body })
          } catch (tapError) {
            this.debugLog('broadcast', 'failed to tap bundler request', tapError)
          }
        }
        const response = await originalFetch(input, init)
        if (isBundlerCall) {
          try {
            // Clone before reading so the WASM still receives an unconsumed response body.
            this.debugLog('broadcast', 'bundler response', {
              status: response.status,
              body: await response.clone().text()
            })
          } catch (tapError) {
            this.debugLog('broadcast', 'failed to tap bundler response', tapError)
          }
        }
        return response
      }
      // Local cast: the wrapper is structurally fetch-compatible; reproducing the full
      // `typeof fetch` overload set is not worth it for a debug-only tap.
      globalThis.fetch = tappedFetch as typeof globalThis.fetch
    }

    try {
      await plugin.broadcast(op)
      this.debugLog('broadcast', 'broadcast succeeded', {
        chainId,
        disposableSignerAddress: disposableSigner.address
      })
    } catch (broadcastError) {
      // Log the full error (bundler AA codes, revert reasons and nested `cause`/`details`
      // usually live here) before it is re-thrown to the withStatus wrapper, which only
      // surfaces `.message` to the UI. Enable the RailgunController debug toggle to see it,
      // since debugLog is a no-op otherwise.
      this.debugLog('broadcast', 'broadcast failed', {
        chainId,
        disposableSignerAddress: disposableSigner.address,
        broadcastError
      })
      throw broadcastError
    } finally {
      // Restore the original fetch before anything else, even if the broadcast threw.
      if (originalFetch) globalThis.fetch = originalFetch
      // Re-sync regardless of outcome, and not only to refresh balances: with POI enabled the
      // SDK generates and submits the transact proof for this operation's outputs during a
      // sync, so skipping it can leave the recipient's (and the change) note without a POI,
      // i.e. unspendable. A bundler-side retry can also reject (e.g. "Note already spent")
      // even when an earlier attempt for the same op already landed on-chain, so the shielded
      // balance would otherwise stay stale after a "failed" broadcast that actually succeeded.
      // Its failure is caught here on purpose: a throw from a finally block replaces the
      // exception on its way out, so a failed re-sync would otherwise hide the broadcast error
      // that the user actually needs to see.
      try {
        await this.#syncChain(chainId)
      } catch (syncError: any) {
        this.emitError({
          message: 'Your shielded balances could not be refreshed. Please refresh manually.',
          level: 'silent',
          error: syncError
        })
      }
    }
  }

  /**
   * Unshield/transfer broadcasts (UserOp submission + bundler wait-for-receipt + re-sync)
   * routinely take longer than `dispatchAndWait`'s fixed 10s UI-side timeout (confirmed live:
   * the broadcast succeeds but the UI reports "timed out" first) - so unlike
   * `buildShieldCalls` (bounded, WASM-only), these use the same `withStatus` + polled
   * `statuses` pattern as `init`/`sync`, not requestId/sendUiMessage.
   */
  async buildAndBroadcastUnshield(params: {
    chainId: string
    tokenAddress: `0x${string}`
    isNative: boolean
    amount: bigint
    toAddress: `0x${string}`
  }) {
    await this.withStatus(
      'buildAndBroadcastUnshield',
      () => this.#queueWasmOperation(() => this.#buildAndBroadcastUnshield(params)),
      true
    )
  }

  async #buildAndBroadcastUnshield({
    chainId,
    tokenAddress,
    isNative,
    amount,
    toAddress
  }: {
    chainId: string
    tokenAddress: `0x${string}`
    isNative: boolean
    amount: bigint
    toAddress: `0x${string}`
  }) {
    const plugin = this.#getChainPlugin(chainId)

    const activityId = this.#addActivityEntry({
      chainId,
      type: 'unshield',
      tokenAddress,
      isNative,
      amount,
      recipient: toAddress
    })

    // Held across proving too, not just the broadcast: `prepareUnshield` drains notes through
    // the same WASM module a concurrent sync would use.
    this.#isBroadcastingPrivateOperation = true
    try {
      const asset: AssetId = isNative
        ? { __type: 'native' }
        : { __type: 'erc20', contract: tokenAddress }
      const op = await plugin.prepareUnshield({ asset, amount }, toAddress)
      await this.#broadcastPrivateOperation(chainId, plugin, op)

      this.#updateActivityEntry(activityId, { status: 'success' })
    } catch (error: any) {
      const message = getPrivateOperationErrorMessage(error, 'Failed to unshield.')
      this.#updateActivityEntry(activityId, { status: 'failed', error: message })

      throw new EmittableError({ message, level: 'major', error })
    } finally {
      this.#isBroadcastingPrivateOperation = false
    }
  }

  async buildAndBroadcastTransfer(params: {
    chainId: string
    tokenAddress: `0x${string}`
    amount: bigint
    toZkAddress: string
  }) {
    await this.withStatus(
      'buildAndBroadcastTransfer',
      () => this.#queueWasmOperation(() => this.#buildAndBroadcastTransfer(params)),
      true
    )
  }

  async #buildAndBroadcastTransfer({
    chainId,
    tokenAddress,
    amount,
    toZkAddress
  }: {
    chainId: string
    tokenAddress: `0x${string}`
    amount: bigint
    toZkAddress: string
  }) {
    const plugin = this.#getChainPlugin(chainId)

    const activityId = this.#addActivityEntry({
      chainId,
      type: 'transfer',
      tokenAddress,
      // Private transfers never involve the native asset - the pool holds none
      isNative: false,
      amount,
      recipient: toZkAddress
    })

    // See the note in #buildAndBroadcastUnshield - proving uses the same WASM module
    this.#isBroadcastingPrivateOperation = true
    try {
      const asset: ERC20AssetId = { __type: 'erc20', contract: tokenAddress }
      const op = await plugin.prepareTransfer({ asset, amount }, toZkAddress as RailgunAddress)
      await this.#broadcastPrivateOperation(chainId, plugin, op)

      this.#updateActivityEntry(activityId, { status: 'success' })
    } catch (error: any) {
      const message = getPrivateOperationErrorMessage(error, 'Failed to send privately.')
      this.#updateActivityEntry(activityId, { status: 'failed', error: message })

      throw new EmittableError({ message, level: 'major', error })
    } finally {
      this.#isBroadcastingPrivateOperation = false
    }
  }

  toJSON() {
    return {
      ...this,
      // Getters are on the prototype, so they are not picked up by the spread above and have
      // to be listed explicitly to reach the UI.
      railgunAddress: this.railgunAddress,
      supportedChainIds: this.supportedChainIds,
      initializedChainIds: this.initializedChainIds,
      unavailableReason: this.unavailableReason,
      isAvailableForSelectedAccount: this.isAvailableForSelectedAccount,
      isInitialized: this.isInitialized,
      chains: this.chains,
      activity: this.activity
    }
  }
}
