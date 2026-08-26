import { Interface, JsonRpcProvider, Wallet } from 'ethers'

import {
  Bundler,
  chainConfig,
  ensureInitialized,
  RailgunBuilder,
  RailgunPlugin,
  RailgunSigner,
  Signer as EthSigner,
  SignerPool,
  SimpleSmartAccount,
  UtxoSyncer
} from '@kohaku-eth/railgun'
import type { AssetAmount, AssetId, ERC20AssetId } from '@kohaku-eth/plugins'
import type {
  ChainConfig,
  Database as RailgunDatabase,
  Eip1193Provider,
  RailgunAddress,
  RailgunProvider,
  RawLog
} from '@kohaku-eth/railgun'

import EmittableError from '../../classes/EmittableError'
import {
  RAILGUN_INITIAL_SYNC_MAX_MINUTES,
  RAILGUN_KEY_INDEX,
  RAILGUN_SUPPORTED_CHAIN_IDS
} from '../../consts/railgun'
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
  RailgunChainSyncState,
  RailgunIdentityChainState,
  RailgunNetworkFeeEstimate,
  RailgunPoiStatus,
  RailgunPrivateOperation,
  RailgunPrivateOperationPhase,
  RailgunShieldedBalance,
  RailgunTokenData,
  RailgunUnavailableReason
} from '../../interfaces/railgun'
import { ISelectedAccountController } from '../../interfaces/selectedAccount'
import { IStorageController } from '../../interfaces/storage'
import { AccountOp } from '../../libs/accountOp/accountOp'
import { SubmittedAccountOp } from '../../libs/accountOp/submittedAccountOp'
import { AccountOpStatus, Call } from '../../libs/accountOp/types'
import { Portfolio } from '../../libs/portfolio'
import { getRailgunTokenBalance } from '../../libs/railgun/balances'
import { getRailgunUnshieldAmounts, RAILGUN_FEE_BPS } from '../../libs/railgun/protocolFee'
import {
  getRailgunTokensDataFromPortfolio,
  resolveRailgunTokensData
} from '../../libs/railgun/tokenData'
import { withTimeout } from '../../utils/with-timeout'
import EventEmitter from '../eventEmitter/eventEmitter'

/**
 * Blocks per `eth_getLogs` for the SDK's RPC-based UTXO syncer (its default of 10 is far too small).
 * Chain dependent because the two fail in opposite directions: on Sepolia the tail to cover is
 * thousands of blocks but the logs are few, so the window must be wide; on Ethereum the tail is
 * short but busy, and a 10k-block window can exceed a provider's 10k-log response cap.
 */
const RAILGUN_RPC_SYNC_BATCH_SIZE_IN_BLOCKS: { [chainId: string]: number } = {
  '1': 2_000,
  '11155111': 10_000
}
const DEFAULT_RAILGUN_RPC_SYNC_BATCH_SIZE_IN_BLOCKS = 2_000
// Keeps the persisted activity log bounded - it exists to show the user their recent Railgun
// operations, not to be a complete audit trail. Counted per identity, so a busy recovery phrase
// cannot evict the entries of one the user switches back to.
const MAX_ACTIVITY_ENTRIES = 20

/**
 * The outcomes of a shield's transaction that mean the funds will never arrive. 'broadcast-but-stuck'
 * and 'partially-complete' are deliberately absent - the first can still be mined, the second does
 * not say which call in the batch went through - so both are left to `#resolvePendingShields`.
 */
const FAILED_SHIELD_ACCOUNT_OP_STATUSES: (AccountOpStatus | undefined)[] = [
  AccountOpStatus.Failure,
  AccountOpStatus.Rejected,
  AccountOpStatus.UnknownButPastNonce
]
// Catching an identity up on a chain it already has state for only covers the tail (~6s on
// Ethereum). Bounded anyway, because a wedged sync locks the user out of the whole screen -
// `withStatus` refuses to start any action, including the refresh that would recover it.
const RAILGUN_CATCH_UP_TIMEOUT_IN_MS = 3 * 60 * 1000
// A first scan walks the pool's whole history and proves in WASM, so it gets the figure the UI
// states as its upper bound - we cannot give up before our own promise expires.
const RAILGUN_FIRST_SCAN_TIMEOUT_IN_MS = RAILGUN_INITIAL_SYNC_MAX_MINUTES * 60 * 1000
// Owned by this module and handed to `withTimeout`, so a soft timeout can be told apart from an
// error raised by the scan itself - see #syncChain.
const RAILGUN_SYNC_TIMEOUT_MESSAGE =
  'Syncing your shielded balances took too long. Please try again.'
// The SDK writes its UTXO/POI state key-by-key, so debouncing is what keeps a sync from rewriting
// the whole blob hundreds of times - see RailgunStorage.
const RAILGUN_STORAGE_WRITE_DEBOUNCE_IN_MS = 250
// How many periodic refreshes may fail before the user is told. The refresh runs on a timer, so
// reporting a transient RPC blip would toast (and report to Sentry) on every tick.
const MAX_QUIET_BACKGROUND_SYNC_FAILURES = 3
// A background refresh this soon after the last successful sync is skipped. Enabling Railgun emits
// an update that starts the periodic refresh with `runImmediately`, so without this the first thing
// after a long cold sync is the exact same sync again.
const MIN_BACKGROUND_SYNC_AGE_IN_MS = 60 * 1000
// Gas for one private operation's UserOperation, all limits included. A single conservative figure
// rather than a model: the real number only exists once the proof does, and erring high is the safe
// direction for a number labelled as an estimate.
const PRIVATE_OPERATION_GAS_ESTIMATE = 1_800_000n
// Room on top of the estimate the shielded WETH balance is checked against, since the fee is sized
// minutes later against a gas price that has moved by then.
const NETWORK_FEE_HEADROOM_MULTIPLIER = 3n
const NETWORK_FEE_HEADROOM_DIVISOR = 2n

/**
 * The Privacy Paymaster fronts the gas but is reimbursed inside the pool with a fee note that can
 * only be denominated in the wrapped base token. Both of these therefore mean the same thing to the
 * user - not enough *spendable* shielded WETH: the first when no workable set of notes exists at
 * all, the second when the estimate won't settle.
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
  // Kept apart from `init` so the UI can tell "deriving the identity" - instant, automatic on
  // opening the screen - from "scanning a pool", which takes minutes and is asked for.
  initIdentity: 'INITIAL',
  init: 'INITIAL',
  // The automatic catch-up on opening the screen, kept apart from `init` because they have
  // different owners: `init` belongs to the user pressing Enable, and a run of it survives an
  // account switch - so sharing one slot made the account switched *to* refuse to catch up at all.
  catchUp: 'INITIAL',
  sync: 'INITIAL',
  buildAndBroadcastUnshield: 'INITIAL',
  buildAndBroadcastTransfer: 'INITIAL'
} as const

const isErc20Balance = (balance: AssetAmount): balance is AssetAmount<ERC20AssetId> =>
  balance.asset.__type === 'erc20'

/**
 * `AssetAmount.tag` carries the SDK's `PoiStatus` as a loose string, so it is narrowed rather than
 * cast. An unrecognised tag becomes 'unknown', which the balance helpers treat as spendable -
 * matching how the SDK's own note selection treats a missing status.
 */
const toRailgunPoiStatus = (tag: string | undefined): RailgunPoiStatus => {
  if (tag === 'Valid' || tag === 'ProofSubmitted' || tag === 'Missing' || tag === 'ShieldBlocked')
    return tag

  return 'unknown'
}

/**
 * Decodes what the SDK hex-encoded. Falls back to the raw input if it isn't valid hex, which
 * `hasPendingPoi` treats as "cannot tell".
 */
const fromHexEncoded = (encoded: string) => {
  if (encoded.length % 2 !== 0) return encoded

  let decoded = ''
  for (let i = 0; i < encoded.length; i += 2) {
    const code = Number.parseInt(encoded.slice(i, i + 2), 16)
    if (Number.isNaN(code)) return encoded

    decoded += String.fromCharCode(code)
  }

  return decoded
}

/**
 * The SDK's `DatabaseAdapter` writes keys as `<chainId>:<hex(name)>`, so recognising an entry means
 * encoding the name the same way. ASCII-only, which is all the names and 0zk addresses ever are.
 */
const toHexKeyName = (name: string) =>
  [...name].map((char) => char.charCodeAt(0).toString(16).padStart(2, '0')).join('')

/**
 * The SDK's POI state for one chain: `{ pending, pois }`, where `pending` holds one witness per
 * transaction whose outputs have no innocence proof yet and `pois` is a re-fetchable cache.
 *
 * Singled out by name because it is the only entry the SDK cannot rebuild from chain state, which
 * is what makes it worth reading directly - see `hasPendingPoi`.
 */
const POI_STATE_KEY_NAME = 'poi_provider'

// Compared as hex so the read path never has to decode a key name.
const POI_STATE_KEY_NAME_IN_HEX = toHexKeyName(POI_STATE_KEY_NAME)

// The only `poi_provider` schema this code reads. Anything else is left alone - see hasPendingPoi.
const SUPPORTED_POI_STATE_SCHEMA_VERSION = 1

/**
 * Kept vague on purpose: the user cannot act on it, and the only thing that matters is that it
 * reaches the report, since it means the SDK changed a format this code depends on.
 */
const POI_STATE_READ_ERROR_MESSAGE =
  'A privacy pool check could not be completed. Your funds are not affected.'

/**
 * Backs the SDK's `Database` on top of Ambire's fixed-schema StorageController, by folding every
 * write into one flat `railgunPluginStorage` blob. One blob covers all chains: `forChain` prefixes
 * each key with the chain id, which is why one instance serves every chain's provider.
 *
 * The blob is hydrated once and cached, and `set` resolves as soon as the value is in that cache,
 * with the write debounced behind it. Load-bearing rather than an optimisation: the Rust side awaits
 * every `Database::set` in sequence, so waiting for the debounced write would cost the full interval
 * per key - and a mainnet sync touches them by the thousand. Read-after-write still holds, since
 * `get` reads the same cache.
 */
export class RailgunStorage {
  #storage: IStorageController

  #onError: (error: unknown, message?: string) => void

  #cache: Record<string, string> | null = null

  #hydratePromise: Promise<Record<string, string>> | null = null

  // The write every `set` in the current burst joins, so they persist together.
  #scheduledWrite: Promise<void> | null = null

  #writeQueue: Promise<void> = Promise.resolve()

  // Since `set` does not await persistence, a failed write has no caller left to throw at - hence
  // the injected reporter. `message` is for the readers that report something other than a failed
  // write, and falls back to the write wording when omitted.
  constructor(storage: IStorageController, onError: (error: unknown, message?: string) => void) {
    this.#storage = storage
    this.#onError = onError
  }

  #hydrate(): Promise<Record<string, string>> {
    if (this.#cache) return Promise.resolve(this.#cache)

    if (!this.#hydratePromise) {
      this.#hydratePromise = this.#storage
        .get('railgunPluginStorage', {})
        .then((blob) => {
          // A concurrent hydrate may have already populated it - keep the same object identity,
          // since pending writes mutate whatever `#cache` pointed at.
          this.#cache = this.#cache || blob
          return this.#cache
        })
        .catch((error) => {
          // Cleared so the next caller retries. Without this a single failed read - a transient
          // storage error, say - left this promise rejected for the lifetime of the controller,
          // and every later get and set rejected with it.
          this.#hydratePromise = null

          throw error
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

    // The SDK re-serializes and hands back every key on every sync, changed or not: a catch-up with
    // zero new commitments still returns all four 18 MB UTXO trees byte-for-byte identical.
    // Comparing is memory bandwidth; persisting rewrites the whole blob.
    if (cache[key] === value) return

    cache[key] = value

    // Deliberately not returned: see the class comment for why the caller must not wait for
    // persistence. Failures are reported rather than thrown, since there is nobody left to
    // throw at.
    this.#scheduleWrite().catch(this.#onError)
  }

  /**
   * Removes the entry outright, rather than blanking it the way the SDK's own adapter does. These
   * entries hold an identity's decrypted notes, so forgetting one has to actually drop them.
   */
  async delete(key: string): Promise<void> {
    const cache = await this.#hydrate()
    if (!(key in cache)) return

    delete cache[key]
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

      const write = this.#writeQueue
        // Chained off the previous write's *settlement*, not its success. A rejected `#writeQueue`
        // would otherwise be inherited by every `.then` after it, so one failed write silently
        // stopped all persistence for the rest of the session.
        .then(
          () => this.#storage.set('railgunPluginStorage', { ...(this.#cache || {}) }),
          () => this.#storage.set('railgunPluginStorage', { ...(this.#cache || {}) })
        )

      // The queue keeps a settled-only view, so it can never carry a rejection forward. The
      // caller still gets the real outcome through the returned promise.
      this.#writeQueue = write.then(
        () => {},
        () => {}
      )

      return write
    })

    return this.#scheduledWrite
  }

  /**
   * Whether this identity has already been initialized on this chain - the persisted state IS the
   * flag, so there is no separate one to keep in sync. Biased towards "no": a false negative only
   * offers an initialization that turns out quick, a false positive applies the catch-up timeout to
   * a full history walk.
   *
   * `identityAddress` must be the SDK's chain-scoped variant, not the chain-agnostic address the UI
   * displays - the two differ in the middle of the bech32m, so the displayed one matches no key.
   */
  async hasStateForIdentity(chainId: string, identityAddress: string): Promise<boolean> {
    const cache = await this.#hydrate()
    const identityKeyFragment = toHexKeyName(identityAddress)

    return Object.keys(cache).some(
      (key) => key.startsWith(`${chainId}:`) && key.includes(identityKeyFragment)
    )
  }

  /** Persists everything still in flight. Used on teardown, so a sync's last writes survive. */
  async flush(): Promise<void> {
    if (this.#scheduledWrite) await this.#scheduledWrite
    await this.#writeQueue
  }

  /**
   * Drops the in-memory blob. Called when the wallet locks, because the persisted state includes an
   * `account:<0zk address>` entry holding that identity's *decrypted* notes - amounts and tokens -
   * and none of that should outlive the lock in memory. Re-read from storage on the next access,
   * which cannot happen while locked.
   *
   * Flush before calling, or pending writes are lost: they only exist in this cache.
   */
  clearCache() {
    this.#cache = null
    this.#hydratePromise = null
  }

  /**
   * This chain's slice of the blob. Every key the Rust side asks for is namespaced by chain id, so
   * one instance of this class backs the databases of all of them.
   *
   * Unguarded on purpose: a chain has exactly one provider, so these keys have exactly one writer.
   * That invariant is what `#holdWasmQueueUntil` maintains, and it is what makes this a plain view
   * rather than something that has to reason about which writer is still the current one.
   */
  forChain(chainId: string): RailgunDatabase {
    const scoped = (key: string) => `${chainId}:${key}`

    return {
      get: (key: string) => this.get(scoped(key)),
      set: (key: string, value: string) => this.set(scoped(key), value),
      delete: (key: string) => this.delete(scoped(key))
    }
  }

  /**
   * Whether the SDK still owes a POI proof for this chain, answered from its own persisted state.
   * The SDK drops a `pending` entry only once the aggregator accepts the proof, which it attempts on
   * every sync - so the state IS the marker and it clears itself.
   *
   * Only a schema version it recognises is read; anything else answers "no", which at worst delays
   * a submission to the next sync and can never affect what is submitted.
   */
  async hasPendingPoi(chainId: string): Promise<boolean> {
    const value = await this.get(`${chainId}:${POI_STATE_KEY_NAME_IN_HEX}`)
    if (!value) return false

    try {
      const state = JSON.parse(fromHexEncoded(value))
      if (state?.v !== SUPPORTED_POI_STATE_SCHEMA_VERSION) {
        this.#onError(
          new Error(
            `railgun: unrecognised poi_provider schema version ${state?.v}, cannot tell whether a POI proof is owed`
          ),
          POI_STATE_READ_ERROR_MESSAGE
        )

        return false
      }

      return Array.isArray(state?.data?.pending) && state.data.pending.length > 0
    } catch (error) {
      this.#onError(error, POI_STATE_READ_ERROR_MESSAGE)

      return false
    }
  }
}

/**
 * Derives one identity's Railgun keys, whose whole contract is "derive a BIP-32 path".
 *
 * Deliberately not the SDK's own `MnemonicKeystore`, which keeps the recovery phrase - that would
 * put the phrase inside an unaudited alpha dependency for the lifetime of the provider. This goes
 * through `KeystoreController.deriveRailgunKey`, which whitelists Railgun's two paths and never
 * returns the phrase. The cache keeps `deriveAt` off the seed's pbkdf2 and is dropped with the
 * instance on lock or seed change.
 */
export class AmbireRailgunKeystore {
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

const getChainIdOf = async (provider: JsonRpcProvider) => (await provider.getNetwork()).chainId

const getGasPriceOf = async (provider: JsonRpcProvider) =>
  (await provider.getFeeData()).gasPrice ?? 0n

/**
 * Satisfies @kohaku-eth/railgun's `Eip1193Provider`, which is what both `RailgunBuilder` and
 * `SimpleSmartAccount` bind against. The SDK's own adapter isn't exported from the package, and
 * reimplementing the seven methods over ethers is smaller than the two-hop shape it converts from.
 */
const toEip1193Provider = (provider: JsonRpcProvider): Eip1193Provider => ({
  getChainId: () => getChainIdOf(provider),
  getGasPrice: () => getGasPriceOf(provider),
  async getBlockNumber() {
    return BigInt(await provider.getBlockNumber())
  },
  async getLogs(address, eventSignature, fromBlock, toBlock) {
    const logs = await provider.getLogs({
      address,
      topics: eventSignature ? [eventSignature] : undefined,
      fromBlock,
      toBlock
    })

    return logs.map<RawLog>((log) => ({
      blockNumber: log.blockNumber,
      // Not available from eth_getLogs without an extra per-block RPC call.
      blockTimestamp: null,
      transactionHash: log.transactionHash as `0x${string}`,
      address: log.address as `0x${string}`,
      topics: log.topics as unknown as `0x${string}`[],
      data: log.data as `0x${string}`
    }))
  },
  ethCall: async (to, data) => (await provider.call({ to, data })) as `0x${string}`,
  estimateGas: (to, from, data) => provider.estimateGas({ to, from, data }),
  async getTransactionCount(address, block) {
    return BigInt(await provider.getTransactionCount(address, block))
  }
})

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

  #railgunStorage: RailgunStorage

  /**
   * One `RailgunProvider` per chain, shared by every identity on it. This is what owns the chain's
   * whole state - the UTXO trees, the sync cursor, the POI provider - so sharing it is what keeps a
   * second recovery phrase from re-downloading a pool the first one already has, and what leaves a
   * single writer on the chain-wide storage keys.
   */
  #chainProviders = new Map<string, RailgunProvider>()

  /**
   * One plugin per (chain, identity), keyed by `#pluginKey`. A plugin is a thin object over the
   * chain's shared provider plus this identity's signer, so several can coexist over one provider -
   * every read it does is addressed (`provider.balance(address)`) and every operation carries its
   * own signer.
   */
  #plugins = new Map<string, RailgunPlugin>()

  /**
   * The signers registered on each chain's provider, keyed by `#pluginKey` so they can be freed on
   * lock. They hold spending key material inside the WASM heap for as long as the provider lives,
   * which is why dropping the reference is not enough.
   */
  #signers = new Map<string, RailgunSigner>()

  /**
   * The ethers provider each chain's `RailgunProvider` was built with. ProvidersController destroys
   * and replaces providers when an RPC url changes or a network is removed, and a destroyed ethers
   * provider throws on use - so without this comparison a chain would keep holding a dead provider
   * and Railgun would silently stop working until the background restarted.
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

  /**
   * Symbol, decimals and price per chain, then per lowercased token address.
   *
   * Deliberately outside the per-identity state: this describes the token contract and its
   * market, so it is identical for every identity, and keying it per identity would re-read it on
   * every switch. In memory only - a persisted price is a stale price.
   */
  #tokensDataByChain: { [chainId: string]: { [address: string]: RailgunTokenData } } = {}

  /**
   * What a chain is doing, per chain. Not per identity: `provider.sync()` takes no address and walks
   * the pool once for every identity registered on it, so a run started while one account was
   * selected is equally the other's run. Keying this per identity is what used to leave the account
   * you switched to looking idle while its own notes were being decrypted.
   */
  #syncStatesByChain: { [chainId: string]: RailgunChainSyncState } = {}

  /**
   * What a chain holds for one identity, keyed by the 0zk address. Balances genuinely are per
   * identity - two recovery phrases share the pool but not the notes in it.
   *
   * Kept per identity rather than cleared on every switch, so switching back shows the last known
   * balances instead of re-scanning for them.
   */
  #chainStatesByIdentity: {
    [railgunAddress: string]: { [chainId: string]: RailgunIdentityChainState }
  } = {}

  /**
   * Every identity's operations in one list, newest first, as persisted. Read through the
   * `activity` getter, which narrows it to the identity on screen - see there for why the log is
   * not split per identity in storage.
   */
  #activity: RailgunActivityEntry[] = []

  /**
   * The private operation on screen: the one running, or the last one until the user dismisses it.
   * A broadcast takes minutes and never opens the signing screen, so "it is running, this is how far
   * it got, this is how it ended" has to be state the UI can render - not a toast at the end.
   */
  privateOperation: RailgunPrivateOperation | null = null

  /**
   * The run in flight per chain, if any: bringing the chain up for the selected identity and reading
   * every registered identity's balances off the sync it performs.
   *
   * One per chain, and callers join it rather than starting a second. That is both what the SDK
   * allows - every provider method is `&mut self`, so a concurrent call aborts the module with
   * "recursive use of an object detected" - and what the work actually is: one pool walk that serves
   * everyone registered on it.
   *
   * Registered on the real run, never on how long a caller waits for it. A caller that gives up
   * waiting leaves the entry in place, so the next one joins the same run instead of starting one
   * the provider cannot accept.
   */
  #chainRuns = new Map<string, Promise<void>>()

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
    // The WASM bytes are a build asset; ambire-common can't know the URL, so the platform layer
    // injects the loader.
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
    this.#railgunStorage = new RailgunStorage(storage, (error, message) =>
      this.emitError({
        message:
          message || 'Could not save the Railgun sync state. It will be rebuilt on the next sync.',
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

    // Entries recorded before the log carried an identity cannot be attributed to one, so they are
    // dropped instead of being kept around unreachable.
    this.#activity = (await this.#storage.get('railgunActivity', [])).filter(
      (entry) => !!entry.railgunAddress
    )

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
        // Locking wipes the balances too: nothing derived from the seed may outlive the lock.
        // Keyed on the identity rather than on the plugins: deriving an identity is what puts the
        // spending and viewing keys in memory, whether or not a chain was ever scanned with them.
        if (!this.#keystore.isUnlocked && this.#railgunKeystoreSeedId)
          this.#teardown({ wipeBalances: true })

        this.propagateUpdate(forceEmit)
      }, 'railgun'),

      this.#selectedAccount.onUpdate((forceEmit) => {
        const seedId = this.#getSeedIdForSelectedAccount()
        // A different recovery phrase is a different Railgun identity, so nothing built for the
        // previous one may be reused - but its balances stay in their own bucket, so switching back
        // shows them at once. Railgun stays opt-in, so the new account is not initialized here.
        //
        // Keyed on there being an identity rather than on there being plugins: an account whose
        // identity was derived without any chain being scanned has no plugins, and would otherwise
        // leave its address - and everything the UI reads through it - on screen.
        if (this.#railgunKeystoreSeedId && seedId !== this.#railgunKeystoreSeedId)
          this.#teardown({ wipeBalances: false })

        this.propagateUpdate(forceEmit)
      }, 'railgun'),

      this.#providers.onUpdate((forceEmit) => {
        const staleChainIds = [...this.#chainProviders.keys()].filter(
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
   * The chains that currently have a live plugin for the identity on screen, i.e. the ones whose
   * shielded balances can actually be spent. A supported chain that failed to initialize (or whose
   * sync timed out and had its provider discarded) is deliberately absent, so the UI can offer each
   * action against the chains that work instead of letting the user start one that can only fail.
   *
   * Scoped to the identity rather than to the chain: a chain can have a provider up because another
   * recovery phrase brought it up, while this identity has never been registered on it.
   */
  get initializedChainIds(): string[] {
    // Ordered by `supportedChainIds` rather than by insertion order, so the chain order the UI
    // renders stays stable across re-initializations.
    return this.supportedChainIds.filter((chainId) => !!this.#getIdentityPlugin(chainId))
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
    return this.initializedChainIds.length > 0
  }

  /**
   * Per-chain state as the UI reads it: each chain's own sync merged with what it holds for the
   * identity on screen. A getter rather than a field, so the split above stays an implementation
   * detail and the UI keeps indexing by chain id.
   */
  get chains(): { [chainId: string]: RailgunChainState } {
    const chainIds = new Set([
      ...Object.keys(this.#syncStatesByChain),
      ...Object.keys(
        (this.railgunAddress && this.#chainStatesByIdentity[this.railgunAddress]) || {}
      )
    ])

    return Object.fromEntries(
      [...chainIds].map((chainId) => [chainId, this.#getChainState(chainId)])
    )
  }

  /**
   * Whether any chain has completed a scan for the current identity, i.e. whether there are
   * balances worth showing. Distinct from `isInitialized`: the identity can be derived and its
   * address on screen while no pool has ever been scanned for it.
   */
  get hasSyncedAnyChain(): boolean {
    return Object.values(this.chains).some((chain) => !!chain.lastSyncedAt)
  }

  /**
   * The Railgun identity is derived from the recovery phrase the selected account's key comes
   * from, so it only exists for accounts that have one: hardware wallets, private-key imports
   * and view-only accounts have no seed to derive from.
   */
  /**
   * The operations of the identity on screen, newest first - which is what the account the user is
   * on has done, since the identity is derived from its recovery phrase. Scoped here rather than in
   * the UI so another identity's operations cannot reach it at all.
   *
   * Scoped by identity rather than by account address, to match the balances it sits next to:
   * accounts sharing a recovery phrase share one 0zk address and one shielded pool, so the
   * operations on that pool are theirs jointly - and an account-scoped log would show an empty
   * history beside a non-empty balance.
   *
   * Empty until the identity is resolved, which the Railgun screen does as soon as it is opened.
   */
  get activity(): RailgunActivityEntry[] {
    if (!this.railgunAddress) return []

    return this.#activity.filter((entry) => entry.railgunAddress === this.railgunAddress)
  }

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

  #getChainSyncState(chainId: string): RailgunChainSyncState {
    return (
      this.#syncStatesByChain[chainId] || {
        wrappedBaseTokenAddress: null,
        syncStatus: 'idle',
        syncStartedAt: null,
        error: null
      }
    )
  }

  /**
   * Deliberately not derived from any existing entry: an identity with no entry for this chain must
   * start from nothing, or it would copy whatever the selected identity happens to hold - the
   * cross-identity bleed this split exists to prevent.
   */
  #getIdentityChainState(
    identityAddress: string | null,
    chainId: string
  ): RailgunIdentityChainState {
    const stored = identityAddress && this.#chainStatesByIdentity[identityAddress]?.[chainId]

    return stored || { hasIdentityData: false, lastSyncedAt: null, balances: [] }
  }

  /** The two halves as one, for the identity on screen. */
  #getChainState(chainId: string): RailgunChainState {
    return {
      chainId,
      ...this.#getChainSyncState(chainId),
      ...this.#getIdentityChainState(this.railgunAddress, chainId)
    }
  }

  get tokensData(): { [chainId: string]: { [address: string]: RailgunTokenData } } {
    return this.#tokensDataByChain
  }

  /**
   * Resolves symbol, decimals and price for everything this chain's pool holds, in one batch, right
   * after a sync has written the balances - the pool has no token list, so the scan result IS the
   * discovery. The wrapped base token is always included even at a zero balance, since the unshield
   * form needs its decimals to parse an unwrapped withdrawal.
   *
   * Never throws: the sync it runs at the end of has just produced correct balances of real money,
   * and a slow price server must not turn that into a failed sync.
   */
  async #resolveTokensData(chainId: string, tokenAddresses: string[]) {
    try {
      const network = this.#networks.networks.find(
        (someNetwork) => someNetwork.chainId.toString() === chainId
      )
      const provider = this.#providers.providers[chainId]
      if (!network || !provider) return

      const addresses = [...new Set(tokenAddresses.map((address) => address.toLowerCase()))]
      if (!addresses.length) return

      const { tokensData, errors } = await resolveRailgunTokensData({
        addresses,
        // Built per call rather than kept around. It is a plain object graph - constructing it
        // makes no request - and doing it here means it can never end up holding a provider that
        // ProvidersController has since destroyed, which is a bug the plugin cache above has to
        // guard against explicitly.
        portfolio: new Portfolio(this.#fetch, provider, network),
        knownTokensData: {
          // Seeded from the public portfolio so the metadata call can skip - or be avoided
          // entirely - for tokens it already read. See getRailgunTokensDataFromPortfolio.
          ...getRailgunTokensDataFromPortfolio(this.#selectedAccount.portfolio.tokens, chainId),
          // What earlier syncs read from the contracts wins: it was resolved for this pool
          // specifically and does not depend on which account happens to be selected.
          ...this.#tokensDataByChain[chainId]
        }
      })

      this.#tokensDataByChain = {
        ...this.#tokensDataByChain,
        [chainId]: { ...this.#tokensDataByChain[chainId], ...tokensData }
      }
      this.emitUpdate()

      // Console only, and never reported: this runs on every sync, including the periodic
      // background ones, so a token nobody prices would otherwise be raised forever. It is not a
      // failure the user can act on either - an unresolved token shows as such and is blocked in
      // the forms.
      if (errors.length)
        this.emitError({
          message: 'Some shielded tokens could not be fully identified.',
          level: 'silent',
          sendCrashReport: false,
          error: new Error(
            `railgun: could not resolve token data on chain ${chainId}: ${errors
              .map(({ address, message }) => `${address}: ${message}`)
              .join('; ')}`
          )
        })
    } catch (error: any) {
      // Same reason as above - never surfaced, never reported, but never swallowed either.
      this.emitError({
        message: 'Some shielded tokens could not be fully identified.',
        level: 'silent',
        sendCrashReport: false,
        error: error instanceof Error ? error : new Error('railgun: resolving token data failed')
      })
    }
  }

  /**
   * `emit` is off for the teardown paths: they run from `onUpdate` callbacks, where an update has to
   * be forwarded with `propagateUpdate` rather than emitted.
   */
  #writeChainSyncState(
    chainId: string,
    update: Partial<RailgunChainSyncState>,
    { emit }: { emit: boolean } = { emit: true }
  ) {
    this.#syncStatesByChain = {
      ...this.#syncStatesByChain,
      [chainId]: { ...this.#getChainSyncState(chainId), ...update }
    }

    if (emit) this.emitUpdate()
  }

  /**
   * Writes into a named identity's bucket. A run captures the identity each balance belongs to, so
   * a result that lands after the user switched accounts goes to the identity it was read for
   * rather than to whichever one is selected by then.
   */
  #writeIdentityChainState(
    identityAddress: string | null,
    chainId: string,
    update: Partial<RailgunIdentityChainState>,
    { emit }: { emit: boolean } = { emit: true }
  ) {
    if (!identityAddress) return

    const identityChains = this.#chainStatesByIdentity[identityAddress] || {}

    this.#chainStatesByIdentity = {
      ...this.#chainStatesByIdentity,
      [identityAddress]: {
        ...identityChains,
        [chainId]: { ...this.#getIdentityChainState(identityAddress, chainId), ...update }
      }
    }

    if (emit) this.emitUpdate()
  }

  /**
   * Where a chain's plugins are kept. The chain-agnostic 0zk address is the identity part, to match
   * `#chainStatesByIdentity` - the chain-scoped variant only ever reaches the signer and the
   * persisted `account:` keys.
   */
  #pluginKey(chainId: string, identityAddress: string): string {
    return `${chainId}:${identityAddress}`
  }

  /**
   * Every identity registered on this chain, the one on screen first - so the balances the user is
   * looking at are the first the run writes.
   */
  #chainPlugins(chainId: string): { identityAddress: string; plugin: RailgunPlugin }[] {
    const chainPrefix = `${chainId}:`

    return [...this.#plugins.entries()]
      .filter(([key]) => key.startsWith(chainPrefix))
      .map(([key, plugin]) => ({ identityAddress: key.slice(chainPrefix.length), plugin }))
      .sort(
        (left, right) =>
          Number(right.identityAddress === this.railgunAddress) -
          Number(left.identityAddress === this.railgunAddress)
      )
  }

  /** This chain's plugin for the identity on screen, if it has been registered on it. */
  #getIdentityPlugin(chainId: string): RailgunPlugin | undefined {
    if (!this.railgunAddress) return undefined

    return this.#plugins.get(this.#pluginKey(chainId, this.railgunAddress))
  }

  /**
   * Releases a WASM object's heap allocation. Failures are recorded but never reported: freeing
   * throws when an abandoned scan still holds a mutable borrow on the object, which is expected on
   * the teardown paths and nothing the user can act on - the reference is dropped either way.
   */
  #freeWasmObject(wasmObject: { free: () => void }) {
    try {
      wasmObject.free()
    } catch (error: any) {
      this.emitError({
        message: 'Some Railgun memory could not be released.',
        level: 'silent',
        sendCrashReport: false,
        error: error instanceof Error ? error : new Error('railgun: freeing a WASM object failed')
      })
    }
  }

  /**
   * Drops a chain's provider and every plugin over it, so the next operation on it builds a fresh
   * one. Does not emit - see #updateChainState.
   *
   * Reached only when the chain's ethers provider was replaced, which means the RPC url changed or
   * the network was removed. Safe from here precisely because it leaves `#chainRuns` alone: a run in
   * flight keeps its entry, so the next caller joins it rather than building the replacement, and the
   * chain never has two providers writing at once.
   *
   * Deliberately does not free the WASM objects: a scan may still be running on them. Leaking them
   * until the next background restart is the lesser evil - see `#teardown` for where they are freed.
   */
  #teardownChain(chainId: string) {
    const chainPluginKeys = [...this.#plugins.keys()].filter((key) => key.startsWith(`${chainId}:`))
    chainPluginKeys.forEach((key) => {
      this.#plugins.delete(key)
      this.#signers.delete(key)
    })

    this.#chainProviders.delete(chainId)
    this.#providerInstances.delete(chainId)
    this.#writeChainSyncState(chainId, { syncStatus: 'idle', syncStartedAt: null }, { emit: false })
  }

  /**
   * Drops everything derived from the current keystore/account state. Does not emit.
   *
   * `wipeBalances` separates the two reasons this runs. Locking the wallet must not leave balances
   * in memory; selecting another account must, because they belong to an identity that is still
   * perfectly valid and re-scanning for them costs seconds the user does not need to spend.
   *
   * Which is also why only locking drops the chains' providers. An account switch is the case the
   * shared provider exists for: the next identity registers on the provider this one already built,
   * so its pool is not downloaded a second time, and switching back finds its plugin still there.
   *
   * A run in flight is deliberately left alone, and nothing about it is cancelled. Its pool walk
   * serves every identity registered on the chain, the one being switched to included, so there is
   * nothing here worth interrupting - and each of its results lands in the bucket of the identity it
   * was read for.
   */
  #teardown({ wipeBalances }: { wipeBalances: boolean }) {
    // Whatever the sheet was showing belonged to the identity being dropped, so it must not be
    // presented as the next one's.
    this.privateOperation = null

    if (wipeBalances) {
      // Unlike #teardownChain this does free them: a provider holds every registered identity's
      // spending key inside the WASM heap, and dropping the reference alone would leave that key
      // material there for the rest of the session - which is exactly what locking must not do.
      this.#signers.forEach((signer) => this.#freeWasmObject(signer))
      this.#chainProviders.forEach((provider) => this.#freeWasmObject(provider))
      this.#signers.clear()
      this.#plugins.clear()
      this.#chainProviders.clear()
      this.#providerInstances.clear()
    }

    this.#enabledChainIds.clear()
    this.#railgunKeystore = null
    this.#railgunKeystoreSeedId = null

    this.railgunAddress = null

    // Only locking touches any of this. On an account switch the chain's status has to stand - a run
    // may still be under way, and it is as much the next identity's as it was this one's - and the
    // dropped identity's balances stay in their own bucket, which is what makes switching back
    // instant.
    if (wipeBalances) {
      Object.keys(this.#syncStatesByChain).forEach((chainId) =>
        this.#writeChainSyncState(
          chainId,
          {
            syncStatus: 'idle',
            syncStartedAt: null,
            // A teardown is not a failure of the chain, so a stale error must not survive into the
            // next attempt.
            error: null
          },
          { emit: false }
        )
      )

      this.#chainStatesByIdentity = {}
    }

    // The last writes of an interrupted sync are still only in memory.
    this.#railgunStorage
      .flush()
      .catch((error) => {
        this.emitError({
          message: 'Could not save the Railgun sync state.',
          level: 'silent',
          error
        })
      })
      .finally(() => {
        // Only after the flush, and only when locking: the cached blob holds this identity's
        // decrypted notes, which must not stay in memory past the lock. Dropping it on an account
        // switch instead would just force a 140 MB re-read for no benefit.
        if (wipeBalances) this.#railgunStorage.clearCache()
      })
  }

  destroy() {
    this.#unsubscribers.forEach((unsubscribe) => unsubscribe())
    this.#unsubscribers = []
    this.#teardown({ wipeBalances: true })
    this.emitUpdate()
  }

  /**
   * Derives the 0zk identity and nothing else: no provider, no pool, no chain data. Cheap enough to
   * run on every visit to the screen, which is what puts the address up - and makes it usable to
   * receive - before any scan has been started. Deliberately does NOT bring up the chains:
   * `#initChain` registers the signer, which for an unseen identity trial-decrypts every commitment
   * in the pool.
   *
   * Finishes by catching up the chains this identity already has state for - seconds of work, and
   * since `chains` is not persisted it is the only thing that puts those balances back on screen
   * after a background restart.
   */
  async initIdentity() {
    await this.withStatus('initIdentity', () => this.#resolveIdentity(), true)

    const chainIdsToCatchUp = this.supportedChainIds.filter(
      (chainId) => this.#getChainState(chainId).hasIdentityData
    )
    if (!chainIdsToCatchUp.length) return

    await this.withStatus('catchUp', () => this.#init(chainIdsToCatchUp), true)
  }

  /**
   * Brings up every supported chain and scans it. This is the explicit, user-initiated first scan -
   * it walks each pool's whole history, measured at ~11 minutes on Ethereum for the first identity
   * and ~6 for a further one, and it grows with the pool.
   */
  async init() {
    await this.withStatus('init', () => this.#init(this.supportedChainIds), true)
  }

  /**
   * The first scan of one pool. Exists because being scanned is per chain, not wallet-wide: an
   * identity can be fully synced on Ethereum and have nothing on Sepolia, and that Sepolia scan is
   * still its own deliberate choice.
   */
  async initChainAndSync(chainId: string) {
    await this.withStatus('init', () => this.#init([chainId]), true)
  }

  /**
   * Brings up every supported chain rather than one the user picked: the 0zk identity is wallet-wide
   * and each chain holds its own pool, so "which network am I on" is not a question the user should
   * have to answer.
   *
   * Chains run in parallel: each has its own provider, so nothing about one's pool walk constrains
   * another's, and each emits as soon as it lands. A failing chain records the reason on its own
   * state - only an across-the-board failure is reported as one.
   */
  async #init(chainIds: string[]) {
    await this.initialLoadPromise

    if (!chainIds.length)
      throw new EmittableError({
        message:
          'Railgun is not available on any of your networks. Add Ethereum (or Sepolia in testnet mode) and try again.',
        level: 'expected',
        error: new Error('railgun: no supported chain available')
      })

    // Cheap and idempotent (the derived keys are cached), and needed because this is also reached
    // without `initIdentity` having run - `sync` rebuilds a chain whose provider changed.
    await this.#resolveIdentity()

    const errors = await this.#runChains(chainIds, 'Could not enable Railgun on this network.')

    // Every chain failed, so there is nothing on screen for the per-chain errors to sit next to -
    // the first one is re-thrown so `withStatus` surfaces it as the reason the scan did nothing.
    if (errors.length === chainIds.length) throw errors[0]
  }

  /**
   * Runs the given chains and collects what failed. Shared by the first scan and the refresh, which
   * differ only in which chains they pick and how they report.
   *
   * A chain joins `#enabledChainIds` only once it has actually worked - see `#runChain`. One that
   * failed to come up (locked keystore, dead RPC) would otherwise stay in the set and make every
   * periodic refresh retry, and fail, on its own.
   */
  async #runChains(chainIds: string[], failureMessage: string): Promise<any[]> {
    const outcomes = await Promise.all(
      chainIds.map(async (chainId) => {
        // The budget follows the work the identity on screen faces: a chain it has never scanned is
        // the full history walk, everything else is the tail. Soft - the run keeps going either way,
        // this is only how long the screen waits before it stops blocking on it.
        const timeoutMs = this.#getChainState(chainId).hasIdentityData
          ? RAILGUN_CATCH_UP_TIMEOUT_IN_MS
          : RAILGUN_FIRST_SCAN_TIMEOUT_IN_MS

        try {
          await withTimeout(() => this.#syncChain(chainId), {
            timeoutMs,
            message: RAILGUN_SYNC_TIMEOUT_MESSAGE
          })

          return null
        } catch (error: any) {
          return error
        }
      })
    )

    const errors = outcomes.filter((error) => !!error)

    // A soft timeout is not the chain's failure: the run it gave up on is still going and will write
    // its own outcome, so overwriting the status now would replace "syncing" with an error the chain
    // has not actually hit.
    outcomes.forEach((error, index) => {
      if (!error || error.message === RAILGUN_SYNC_TIMEOUT_MESSAGE) return

      this.#writeChainSyncState(chainIds[index]!, { error: error?.message || failureMessage })
    })

    return errors
  }

  /**
   * Refuses to go on unless Railgun can run for the selected account, and returns the seed its
   * identity derives from. Shared by the identity and per-chain paths so both fail with the same
   * explainable reason instead of one of them throwing something generic.
   */
  #assertAvailableAndGetSeedId(): string {
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

    return seedId
  }

  /**
   * The chain's shared `RailgunProvider`, built on first use. Every identity on the chain registers
   * on this one instance, which is what makes a second recovery phrase cheap: the trees, the sync
   * cursor and the POI provider are already there, so all it costs is trial-decrypting what is
   * already on the device.
   */
  async #getChainProvider(
    chainId: string,
    chain: ChainConfig,
    ethersProvider: RPCProvider
  ): Promise<RailgunProvider> {
    const existing = this.#chainProviders.get(chainId)
    if (existing) return existing

    const eip1193Provider = toEip1193Provider(ethersProvider as JsonRpcProvider)

    const railgunProvider = await new RailgunBuilder(chain, eip1193Provider)
      .withDatabase(this.#railgunStorage.forChain(chainId))
      // The SDK's own default chains these two as well, but its RPC syncer batch size is not
      // configurable through the builder. Subsquid reports its head as the last Railgun *transact*,
      // not the last indexed block, so on a quiet chain the RPC syncer is left a tail of thousands
      // of blocks - which at the SDK's default of 10 is hundreds of sequential round-trips per sync.
      // See RAILGUN_RPC_SYNC_BATCH_SIZE_IN_BLOCKS.
      .withUtxoSyncer(
        UtxoSyncer.chained([
          UtxoSyncer.subsquid(chain),
          UtxoSyncer.rpc(
            chain,
            eip1193Provider,
            BigInt(
              RAILGUN_RPC_SYNC_BATCH_SIZE_IN_BLOCKS[chainId] ??
                DEFAULT_RAILGUN_RPC_SYNC_BATCH_SIZE_IN_BLOCKS
            )
          )
        ])
      )
      // POI (Proof of Innocence) is on, matching the SDK's own default - the aggregator serves both
      // chains. With it on, `balance()` tags each amount with a PoiStatus and note selection only
      // spends 'Valid' ones, which is why balances are kept split per status all the way to the UI:
      // a freshly shielded amount is 'Missing' for Railgun's ~1h standby period and genuinely cannot
      // be moved yet.
      .withPoi()
      .build()

    this.#chainProviders.set(chainId, railgunProvider)
    this.#providerInstances.set(chainId, ethersProvider)

    return railgunProvider
  }

  /**
   * Brings up one chain for the identity on screen: builds the chain's provider if it is the first
   * identity to need it, registers this identity's signer on it, and wraps the pair in a plugin.
   *
   * Replaces the SDK's `createRailgunPlugin`, which builds a provider of its own per call - and with
   * it a second database, syncer and POI provider over the same storage keys. That is what made two
   * recovery phrases on one chain download the same pool twice and overwrite each other's sync
   * cursor.
   */
  async #initChain(chainId: string) {
    // The cheap exit for an already-registered identity, so the common no-op path costs nothing.
    // The authoritative check is the one below, against the address this run resolved.
    if (this.#getIdentityPlugin(chainId)) return

    const seedId = this.#assertAvailableAndGetSeedId()

    const ethersProvider = this.#providers.providers[chainId]
    if (!ethersProvider)
      throw new EmittableError({
        message: 'The RPC provider for this network is not available.',
        level: 'major',
        error: new Error(`railgun: missing provider for chain ${chainId}`)
      })

    // Must precede any other call into the package: everything else (`chainConfig` included)
    // reaches into the WASM, which can't load the bytes itself in this environment. It is a no-op
    // once the module is up, so calling it per chain is free.
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
    // The plugin is keyed by identity, so the address has to be resolved before it can be stored.
    // Cheap: both this and the derivation below read the keystore's per-path cache.
    await this.#resolveRailgunAddress(railgunKeystore)

    const identityAddress = this.railgunAddress
    if (!identityAddress)
      throw new EmittableError({
        message: 'Railgun is not initialized yet.',
        level: 'minor',
        error: new Error(`railgun: no identity to initialize chain ${chainId} for`)
      })

    const pluginKey = this.#pluginKey(chainId, identityAddress)
    if (this.#plugins.has(pluginKey)) return

    this.#writeChainSyncState(chainId, { syncStatus: 'initializing' })

    const railgunProvider = await this.#getChainProvider(chainId, chain, ethersProvider)

    const [spendingKey, viewingKey] = await Promise.all([
      railgunKeystore.deriveAt(RailgunSigner.spendingKeyPath(RAILGUN_KEY_INDEX)),
      railgunKeystore.deriveAt(RailgunSigner.viewingKeyPath(RAILGUN_KEY_INDEX))
    ])
    // Chain-scoped on purpose: the persisted `account:` entry is keyed by this variant of the
    // address, so passing `undefined` here would point every identity at state it has never written.
    const signer = RailgunSigner.privateKey(spendingKey, viewingKey, BigInt(chainId))

    // Not cheap: for an identity this pool has never seen, registering trial-decrypts every existing
    // commitment. The whole cost of a further identity on an already-downloaded chain sits here,
    // not in the sync below.
    await railgunProvider.register(signer)

    this.#plugins.set(pluginKey, new RailgunPlugin(chain, railgunProvider, new SignerPool(signer)))
    this.#signers.set(pluginKey, signer)

    // Only the address, not a status: this runs inside `#runChain`, which owns the chain's status
    // and moves it on to 'syncing' the moment this returns.
    this.#writeChainSyncState(chainId, {
      // The chain's wrapped native token (WETH here) - exposed so the UI can label the
      // corresponding shielded balance and the native shield/unshield flows without
      // hardcoding a possibly-stale address.
      wrappedBaseTokenAddress: chain.wrappedBaseToken
    })
  }

  /**
   * Derives the identity and records, per chain, what is already on the device for it. Everything
   * here is either a cached key derivation or a read of the persisted blob - no chain data, no
   * plugin - which is what makes it safe to run on every visit to the Privacy screen.
   */
  async #resolveIdentity() {
    const seedId = this.#assertAvailableAndGetSeedId()

    await ensureInitialized(await this.#loadWasm())
    await this.#resolveRailgunAddress(this.#getRailgunKeystore(seedId))
  }

  /**
   * Resolves the one 0zk address shown for this wallet, deliberately built with no chain scope.
   *
   * `RailgunSigner.privateKey(spending, viewing, chainId)` maps a chain id to `ChainId::Evm` and
   * `undefined` to `ChainId::All`. The keys are the same either way - the chain only changes the
   * middle chunk of the bech32m, while the master and viewing public keys are byte-identical, which
   * is what makes the funds spendable whichever variant a sender used. There is no chain field in a
   * note at all, so showing the chain-scoped variant would describe a restriction that does not
   * exist. What genuinely stays per chain is the balance: each has its own pool and UTXO tree.
   */
  async #resolveRailgunAddress(railgunKeystore: AmbireRailgunKeystore) {
    // Free once `#initChain` has derived the same two paths through this same instance -
    // AmbireRailgunKeystore caches per path, so this is a cache hit rather than another pbkdf2.
    const [spendingKey, viewingKey] = await Promise.all([
      railgunKeystore.deriveAt(RailgunSigner.spendingKeyPath(RAILGUN_KEY_INDEX)),
      railgunKeystore.deriveAt(RailgunSigner.viewingKeyPath(RAILGUN_KEY_INDEX))
    ])

    const railgunAddress = RailgunSigner.privateKey(spendingKey, viewingKey, undefined).address

    // Whether this identity has been initialized on each chain, which is what tells the one-time
    // initialization apart from a seconds-long catch-up.
    //
    // Looked up by the SDK's chain-scoped variant of the address rather than the chain-agnostic one
    // above: `instanceId()` is `RailgunSigner.privateKey(spending, viewing, chainId)`, and the two
    // differ in the middle of the bech32m, so the displayed address matches no persisted key.
    await Promise.all(
      this.supportedChainIds.map(async (chainId) => {
        const chainScopedAddress = RailgunSigner.privateKey(
          spendingKey,
          viewingKey,
          BigInt(chainId)
        ).address

        this.#writeIdentityChainState(
          railgunAddress,
          chainId,
          {
            hasIdentityData: await this.#railgunStorage.hasStateForIdentity(
              chainId,
              chainScopedAddress
            )
          },
          { emit: false }
        )
      })
    )

    // Published only now, together with the state that describes it: assigning it before the reads
    // above leaves a window - long enough, since hydrating the blob can mean ~140 MB - in which the
    // UI sees an identity with no chain state and every network looks un-enabled.
    this.railgunAddress = railgunAddress
    this.emitUpdate()
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
    entry: Omit<RailgunActivityEntry, 'id' | 'railgunAddress' | 'status' | 'createdAt'> & {
      status?: RailgunActivityStatus
    }
  ) {
    const { railgunAddress } = this
    // Every caller holds a plugin, and a plugin is built from the identity - so this narrows the
    // type rather than describing a reachable state.
    if (!railgunAddress) throw new Error('railgun: no identity to record the operation against')

    const createdAt = Date.now()
    // Unique without a uuid dependency: two entries can't be created for the same asset on the
    // same chain in the same millisecond, since every op goes through one awaited call per action.
    const id = `${entry.chainId}-${entry.type}-${entry.tokenAddress}-${createdAt}`

    // Trimmed within the identity, then put back in front of the rest: the cap must not let this
    // identity's operations push another's out of the log.
    this.#activity = [
      ...[
        { ...entry, id, railgunAddress, status: entry.status || 'pending', createdAt },
        ...this.#activity.filter((other) => other.railgunAddress === railgunAddress)
      ].slice(0, MAX_ACTIVITY_ENTRIES),
      ...this.#activity.filter((other) => other.railgunAddress !== railgunAddress)
    ]
    this.emitUpdate()
    this.#persistActivity()

    return id
  }

  #updateActivityEntry(id: string, update: Partial<RailgunActivityEntry>) {
    this.#activity = this.#activity.map((entry) =>
      entry.id === id ? { ...entry, ...update } : entry
    )
    this.emitUpdate()
    this.#persistActivity()
  }

  // Deliberately not awaited by the callers: the activity log is a UI convenience, so a slow
  // (or failed) write must not delay - or fail - the operation that produced the entry.
  #persistActivity() {
    this.#storage.set('railgunActivity', this.#activity).catch((error) => {
      this.emitError({
        message: 'Could not save the Railgun activity log.',
        level: 'silent',
        error
      })
    })
  }

  /**
   * Starts narrating a private operation, replacing whatever the sheet was showing: only one can run
   * at a time (the WASM module is single-threaded), so a new one always supersedes the last result.
   */
  #startPrivateOperation(
    operation: Omit<RailgunPrivateOperation, 'status' | 'phase' | 'startedAt' | 'error'>
  ) {
    this.privateOperation = {
      ...operation,
      status: 'pending',
      phase: 'preparing',
      startedAt: Date.now(),
      error: null
    }
    this.emitUpdate()
  }

  /**
   * Moves the operation on screen forward. Ignores anything for an operation that is no longer the
   * current one, so a late callback from an abandoned run can't rewrite what the user is looking at.
   */
  #updatePrivateOperation(id: string, update: Partial<RailgunPrivateOperation>) {
    if (this.privateOperation?.id !== id) return

    this.privateOperation = { ...this.privateOperation, ...update }
    this.emitUpdate()
  }

  #setPrivateOperationPhase(id: string, phase: RailgunPrivateOperationPhase) {
    this.#updatePrivateOperation(id, { phase })
  }

  /** Called by the UI when the user closes the operation sheet, so the next one starts clean. */
  dismissPrivateOperation() {
    // A running operation keeps going: the sheet can be closed and reopened, and closing it must not
    // (and does not) cancel a broadcast that is already paying a fee.
    if (!this.privateOperation || this.privateOperation.status === 'pending') return

    this.privateOperation = null
    this.emitUpdate()
  }

  /**
   * What broadcasting an unshield or a private transfer is expected to cost, for the form to show
   * before the user commits. Only the network fee - Railgun's own is arithmetic the UI does itself
   * (see getPrivacyProtocolFee), while this one needs the gas price and the shielded balance.
   *
   * Bounded and cheap, hence `#sendUiMessage` rather than a status.
   */
  async estimateNetworkFee(
    {
      chainId,
      tokenAddress,
      isNative,
      spentAmount
    }: {
      chainId: string
      tokenAddress: string
      isNative: boolean
      // What the operation takes out of the pool for the asset itself, so the balance left over for
      // the fee is judged against what will actually remain
      spentAmount: bigint
    },
    requestId: string
  ) {
    try {
      const provider = this.#providers.providers[chainId]
      const { wrappedBaseTokenAddress, balances } = this.#getChainState(chainId)
      if (!provider || !wrappedBaseTokenAddress) {
        this.#sendUiMessage({ requestId, ok: true, res: null })

        return
      }

      const { maxFeePerGas, gasPrice } = await provider.getFeeData()
      const pricePerGas = maxFeePerGas || gasPrice
      if (!pricePerGas) {
        this.#sendUiMessage({ requestId, ok: true, res: null })

        return
      }

      const amount = PRIVATE_OPERATION_GAS_ESTIMATE * pricePerGas
      const maxAmount = (amount * NETWORK_FEE_HEADROOM_MULTIPLIER) / NETWORK_FEE_HEADROOM_DIVISOR
      const shieldedWrappedBaseTokenAmount =
        getRailgunTokenBalance(balances, wrappedBaseTokenAddress)?.spendableAmount || 0n
      // Only what the operation itself spends of the fee token is unavailable to pay with - for any
      // other asset the whole shielded WETH balance is.
      const isWrappedBaseToken =
        isNative || tokenAddress.toLowerCase() === wrappedBaseTokenAddress.toLowerCase()
      const remaining = shieldedWrappedBaseTokenAmount - (isWrappedBaseToken ? spentAmount : 0n)

      const estimate: RailgunNetworkFeeEstimate = {
        amount,
        maxAmount,
        tokenAddress: wrappedBaseTokenAddress,
        hasEnough: remaining >= maxAmount,
        shieldedWrappedBaseTokenAmount
      }

      this.#sendUiMessage({ requestId, ok: true, res: estimate })
    } catch (error: any) {
      // Silent: a missing estimate is shown in the form as "not known yet", and a toast per
      // keystroke would be worse than the missing figure.
      this.emitError({
        error,
        message: 'Could not estimate the network fee for this operation.',
        level: 'silent'
      })
      this.#sendUiMessage({ requestId, ok: false, error: error?.message })
    }
  }

  /**
   * Marks pending shields as successful once their token's shielded balance grows. The fallback, not
   * the main path - it covers shields whose transaction was never seen from here (broadcast before a
   * background restart, or from another device on the same phrase). Deliberately a heuristic: an
   * incoming private transfer of the same token resolves the entry too.
   *
   * Compares totals across every POI status: a shield lands as 'Missing' and only becomes 'Valid'
   * an hour later, so a spendable-only comparison would leave every shield pending until then.
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

    // The balances compared above are the current identity's, so only its shields may be resolved
    // from them.
    const resolvedActivity = this.#activity.map((entry) =>
      entry.railgunAddress === this.railgunAddress &&
      entry.chainId === chainId &&
      entry.type === 'shield' &&
      entry.status === 'pending' &&
      hasGrown(entry)
        ? { ...entry, status: 'success' as const }
        : entry
    )

    const hasResolvedAny = resolvedActivity.some(
      (entry, index) => entry.status !== this.#activity[index]?.status
    )
    if (!hasResolvedAny) return

    this.#activity = resolvedActivity
    this.emitUpdate()
    this.#persistActivity()
  }

  /**
   * The pending shield an account op is carrying, or undefined when it carries none. Matched on the
   * tag the shield's own activity entry left on the op (see `buildShieldCalls`), because a shield
   * leaves this controller as plain calls and comes back only as somebody else's transaction.
   */
  #getPendingShieldFor(op: Pick<AccountOp, 'meta'>) {
    const activityId = op.meta?.railgunShieldActivityId
    if (!activityId) return undefined

    // Deliberately the whole log, not the identity-scoped view: the transaction carrying a shield
    // can settle after the user has switched accounts, and its entry still has to be resolved.
    return this.#activity.find((entry) => entry.id === activityId && entry.status === 'pending')
  }

  /**
   * A shield's transaction was signed and sent. Recorded so the UI can stop asking for a signature
   * it already has and wait for the funds instead - the two are indistinguishable from here
   * otherwise, which is what left a rejected shield "waiting for the funds to arrive" forever.
   */
  handleShieldBroadcasted(op: SubmittedAccountOp) {
    const shield = this.#getPendingShieldFor(op)
    if (!shield) return

    this.#updateActivityEntry(shield.id, { broadcastedAt: Date.now() })
  }

  /**
   * What a shield's transaction did, as the Activity controller resolved it - the accurate signal
   * that a shield landed, and the fast one, since the balance heuristic only speaks on the next
   * pool scan.
   *
   * A confirmed shield is followed by a scan, because the pool has to be read for the balance to
   * appear. Skipped when there is nothing to scan with, or while a scan is already running - the
   * periodic refresh covers the tail either way.
   */
  async handleShieldAccountOpStatusUpdate(op: SubmittedAccountOp) {
    const shield = this.#getPendingShieldFor(op)
    if (!shield) return

    if (op.status === AccountOpStatus.Success) {
      this.#updateActivityEntry(shield.id, { status: 'success' })

      if (this.isInitialized && this.statuses.sync !== 'LOADING') await this.sync()

      return
    }

    if (FAILED_SHIELD_ACCOUNT_OP_STATUSES.includes(op.status))
      this.#updateActivityEntry(shield.id, {
        status: 'failed',
        error: 'The transaction did not go through, so nothing was shielded.'
      })
  }

  /**
   * A shield whose transaction never made it onto the chain - the user rejected it, or it could not
   * be sent. Nothing was spent and nothing will arrive, which the entry has to say: no transaction
   * means no outcome will ever come back for it.
   */
  handleShieldNotBroadcasted(op: Pick<AccountOp, 'meta'>, cause: 'rejected' | 'broadcast-failed') {
    const shield = this.#getPendingShieldFor(op)
    if (!shield) return

    this.#updateActivityEntry(shield.id, {
      status: 'failed',
      error:
        cause === 'rejected'
          ? 'You rejected the transaction, so nothing was shielded.'
          : 'The transaction could not be sent, so nothing was shielded.'
    })
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
    if (this.#isBroadcastingPrivateOperation) return

    await this.withStatus('sync', () => this.#sync(!!params?.isBackgroundUpdate), true)
  }

  async #sync(isBackgroundUpdate: boolean) {
    // A user-initiated refresh retries every supported chain, not just the enabled ones: a chain
    // that failed at Enable time is left out of `#enabledChainIds` so the timer doesn't hammer it,
    // and once one chain is up the UI shows Refresh instead of Enable. Refresh IS the retry.
    // Cheap and idempotent, and needed because a refresh can be the first thing that runs after a
    // chain was torn down. Also refreshes the per-chain summaries the filter below reads.
    await this.#resolveIdentity()

    const candidateChainIds = isBackgroundUpdate
      ? [...this.#enabledChainIds]
      : this.supportedChainIds

    /**
     * The chains whose POI proofs the SDK has recorded but not submitted yet, read up front because
     * the filter below is synchronous. They are exempt from the freshness check: only a sync
     * submits, and never the one the broadcast itself runs (the aggregator has to validate the txid
     * first), so a chain that is "fresh enough" to skip is exactly the case where it never does.
     */
    const chainIdsOwingPoi = new Set(
      (
        await Promise.all(
          candidateChainIds.map(async (chainId) =>
            (await this.#railgunStorage.hasPendingPoi(chainId)) ? chainId : null
          )
        )
      ).filter((chainId): chainId is string => !!chainId)
    )

    const chainIds = candidateChainIds.filter((chainId) => {
      const { hasIdentityData, lastSyncedAt } = this.#getChainState(chainId)

      // A refresh only ever catches up. A chain this identity has never scanned would turn it into
      // the minutes-long first walk, which is the user's choice to make - see `initChainAndSync`.
      if (!hasIdentityData) return false

      const isFreshEnough =
        !!lastSyncedAt &&
        Date.now() - lastSyncedAt < MIN_BACKGROUND_SYNC_AGE_IN_MS &&
        !chainIdsOwingPoi.has(chainId)

      return !(isBackgroundUpdate && isFreshEnough)
    })

    // Nothing this identity has ever scanned, so there is nothing to catch up - which is the normal
    // state right after switching to an account that has never enabled Railgun, and no more an error
    // than an empty inbox is.
    if (!chainIds.length) return

    const errors = await this.#runChains(
      chainIds,
      'Could not refresh the shielded balances on this network.'
    )

    if (!errors.length) {
      this.#consecutiveBackgroundSyncFailures = 0
      return
    }

    // Only the first failure is escalated: the rest are already on their own chain's state, and
    // stacking one toast per chain says nothing the screen doesn't already show.
    const [error] = errors

    if (!isBackgroundUpdate) throw error

    this.#consecutiveBackgroundSyncFailures += 1

    if (this.#consecutiveBackgroundSyncFailures < MAX_QUIET_BACKGROUND_SYNC_FAILURES) return

    throw new EmittableError({
      message:
        'Your shielded balances have not refreshed for a while. Check your network connection and RPC for this network.',
      level: 'major',
      error
    })
  }

  /**
   * The chain's run, shared by everyone who asks for it. Brings the chain up for the selected
   * identity if needed, then reads every registered identity's balances off the one pool walk the
   * SDK performs.
   *
   * A caller that finds a run in flight joins it. That is the whole of the concurrency control here:
   * the provider is not reentrant, and a sync is not per-account work that could sensibly be queued
   * behind another - it is the chain's work, and everyone registered on it is already in it.
   *
   * Registered on the run itself, not on how long a caller waits. Callers apply their own soft
   * timeout (see `#runChains`), and giving up on waiting leaves the run - and the entry - in place.
   */
  #syncChain(chainId: string): Promise<void> {
    const inFlight = this.#chainRuns.get(chainId)
    // A run is only this identity's run once it is registered on the chain - then the pool walk
    // decrypts for it too, and there is nothing to add.
    if (inFlight && this.#getIdentityPlugin(chainId)) return inFlight

    // Otherwise this identity has to be registered first, and `register()` is `&mut` on the shared
    // provider - so it goes after whatever is in flight rather than beside it. The only real wait
    // left in here, and an unavoidable one.
    const run = (inFlight ? inFlight.catch(() => {}) : Promise.resolve())
      .then(() => this.#runChain(chainId))
      .finally(() => {
        // Only if it is still the current one: a later caller may already have chained onto it.
        if (this.#chainRuns.get(chainId) === run) this.#chainRuns.delete(chainId)
      })

    this.#chainRuns.set(chainId, run)

    return run
  }

  async #runChain(chainId: string) {
    // Brought up here rather than by the callers, so it is inside the run: `register()` is `&mut` on
    // the shared provider, so it cannot overlap a sync, and being part of the run is what guarantees
    // it does not. A chain whose provider was replaced, or that this identity was never registered
    // on, recovers on its own instead of needing a restart.
    await this.#initChain(chainId)

    // Captured before any await: a run outlives an account switch, and each result must land in the
    // bucket of the identity it was read for.
    const plugins = this.#chainPlugins(chainId)

    this.#writeChainSyncState(chainId, {
      syncStatus: 'syncing',
      syncStartedAt: Date.now(),
      error: null
    })

    try {
      // Sequential, and per identity rather than once for the chain, because `balance()` answers for
      // one address. Only the first call walks the pool - it syncs before answering - so the rest are
      // the near-empty tail plus their own balance math.
      for (const { identityAddress, plugin } of plugins) {
        await this.#readBalances(chainId, identityAddress, plugin)
      }

      // Recorded by the run, not by whoever started it: a run that lands after its caller stopped
      // waiting still worked, and the chain still belongs in the periodic refresh.
      this.#enabledChainIds.add(chainId)
      this.#writeChainSyncState(chainId, { syncStatus: 'ready', syncStartedAt: null })
    } catch (error) {
      // 'idle' rather than 'ready': nothing was read, so the row has to keep offering to try again.
      // The reason is written by `#runChains`, which is where it can tell a real failure from a
      // caller that merely stopped waiting.
      this.#writeChainSyncState(chainId, { syncStatus: 'idle', syncStartedAt: null })

      throw error
    }
  }

  /**
   * One identity's balances, written into its own bucket.
   *
   * `balance()` syncs the UTXO tree before answering, so on the first call of a run its duration is
   * the chain scan (and, with POI on, the proving) rather than the balance math. It groups amounts
   * per (asset, poiStatus) pair, which is what the spendable/pending split relies on.
   */
  async #readBalances(chainId: string, identityAddress: string, plugin: RailgunPlugin) {
    const balances = await plugin.balance(undefined)

    const { balances: previousBalances } = this.#getIdentityChainState(identityAddress, chainId)
    const shieldedBalances = balances.filter(isErc20Balance).map((balance) => ({
      tokenAddress: balance.asset.contract,
      amount: balance.amount,
      poiStatus: toRailgunPoiStatus(balance.tag)
    }))

    this.#writeIdentityChainState(identityAddress, chainId, {
      balances: shieldedBalances,
      lastSyncedAt: Date.now(),
      // This run is what created the identity's persisted entry, so a later one on this chain is a
      // catch-up and gets the short budget.
      hasIdentityData: true
    })

    // Both only concern the identity on screen: one resolves its pending shields, the other fills
    // the token metadata its balances are rendered with.
    if (identityAddress !== this.railgunAddress) return

    this.#resolvePendingShields(chainId, previousBalances)

    const { wrappedBaseTokenAddress } = this.#getChainSyncState(chainId)
    await this.#resolveTokensData(chainId, [
      ...shieldedBalances.map((balance) => balance.tokenAddress),
      ...(wrappedBaseTokenAddress ? [wrappedBaseTokenAddress] : [])
    ])
  }

  /**
   * Every action is scoped to the chain of the token it acts on (the UI resolves it from the
   * selected balance), because each chain is a separate shielded pool - running a chain's
   * operation through another chain's plugin would prove against the wrong UTXO tree.
   */
  #getChainPlugin(chainId: string): RailgunPlugin {
    const plugin = this.#getIdentityPlugin(chainId)

    if (!plugin)
      throw new EmittableError({
        message: 'Railgun is not ready on this network yet.',
        level: 'minor',
        error: new Error(`railgun: action attempted before init for chain ${chainId}`)
      })

    // Refused rather than made to wait: the provider is not reentrant, and a run can take minutes -
    // long enough that silently blocking would read as a hung wallet. The screen already shows the
    // network as syncing, so this only catches an action started just before it began.
    if (this.#chainRuns.has(chainId))
      throw new EmittableError({
        message:
          'This network is refreshing your shielded balances. Please try again once it finishes.',
        level: 'expected',
        error: new Error(`railgun: action attempted during a run on chain ${chainId}`)
      })

    // Same reason, for the operations that hold the module for minutes of proving.
    if (this.#isBroadcastingPrivateOperation)
      throw new EmittableError({
        message: 'Another private operation is still running. Please wait for it to finish.',
        level: 'expected',
        error: new Error('railgun: action attempted during a private operation')
      })

    return plugin
  }

  /**
   * Builds the raw {to,data,value} calls for shielding (Ambire account -> 0zk). A shield needs no
   * proof or relayer - the source account is already public - so it is self-broadcast: the caller
   * hands these calls to `RequestsController.build` and they go through the normal sign/broadcast
   * pipeline. Answers through `requestId`/`sendUiMessage`, since `build`'s own dispatch is
   * fire-and-forget.
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
      const txs = await plugin.prepareShieldMulti([{ asset, amount }])
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

      // Recorded as pending here (not once signed): from here the calls travel through
      // RequestsController, and what happens to them comes back through the account op that
      // carries them - see `handleShieldAccountOpStatusUpdate`.
      const activityId = this.#addActivityEntry({
        chainId,
        type: 'shield',
        tokenAddress,
        isNative,
        amount,
        recipient: null
      })

      // The activity entry travels back with the calls so the UI can follow this shield to its end,
      // and so the caller can tag the account op with it - see
      // `AccountOp['meta'].railgunShieldActivityId`, which is what brings the transaction's outcome
      // back to this controller.
      this.#sendUiMessage({ requestId, ok: true, res: { calls, activityId } })
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
   * Fresh, single-use key that signs one private operation's UserOp - never derived from the
   * wallet's seeds and never persisted. Its address is also the smart account's address (the
   * UserOp sender, upgraded via EIP-7702 on the fly), which is why a native unshield has to
   * create it before *building* the operation: the pool must send the WETH to that very
   * account, since `WETH.withdraw` burns from `msg.sender`.
   */
  #createDisposableBroadcastSigner() {
    return EthSigner.privateKey(Wallet.createRandom().privateKey as `0x${string}`)
  }

  /**
   * Broadcasts a proved private operation via an ERC-4337 UserOp signed by a fresh disposable key.
   * This is what gives unshield and transfer their unlinkability: the fee comes out of the shielded
   * balance rather than that key's (never funded) one, and the key has no on-chain history tying it
   * to the user - which is why it differs from shield's self-broadcast path. The account is upgraded
   * to a smart account via EIP-7702 inside the UserOp, so no pre-funding is needed.
   *
   * `disposableSigner` is passed in when the operation had to be *built* against the smart account's
   * address - native unshields do, see `#createDisposableBroadcastSigner`.
   */
  async #broadcastPrivateOperation(
    chainId: string,
    plugin: RailgunPlugin,
    op: Parameters<RailgunPlugin['broadcast']>[0],
    disposableSigner: EthSigner = this.#createDisposableBroadcastSigner()
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

    const smartAccount = new SimpleSmartAccount(
      disposableSigner.address,
      BigInt(chainId),
      toEip1193Provider(provider as JsonRpcProvider)
    )

    plugin.setBundler(
      Bundler.pimlico(`https://api.pimlico.io/v2/${chainId}/rpc?apikey=${this.#pimlicoApiKey}`)
    )
    plugin.setSmartAccount(smartAccount, disposableSigner)

    try {
      await plugin.broadcast(op)
    } finally {
      // The sheet's last step: the re-sync below is what confirms the result, since it is the
      // shielded balance - not the bundler's receipt - that tells the user what actually happened.
      if (this.privateOperation)
        this.#setPrivateOperationPhase(this.privateOperation.id, 'finalizing')
      // Re-synced regardless of outcome, and not only to refresh balances: with POI enabled the SDK
      // generates and submits the transact proof for this operation's outputs during a sync, so
      // skipping it can leave the recipient's (and the change) note unspendable. A bundler retry
      // can also reject an op that already landed, which would otherwise leave the balance stale
      // after a "failed" broadcast that actually succeeded.
      //
      // Its failure is caught on purpose: a throw from a finally block replaces the exception on
      // its way out, and would hide the broadcast error the user actually needs to see.
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
   * Runs one private operation end to end: record it, narrate it, prove it, broadcast it, resolve
   * it. Shared by unshield and private transfer, which differ only in what `prepare` builds and in
   * what Railgun's treasury takes.
   *
   * Unlike `buildShieldCalls` (bounded, WASM-only), these routinely outlast `dispatchAndWait`'s
   * fixed 10s UI-side timeout, so they report through `withStatus` and the polled `statuses` the
   * way `init` and `sync` do.
   */
  async #runPrivateOperation({
    chainId,
    type,
    tokenAddress,
    isNative,
    amount,
    recipient,
    protocolFee,
    failureMessage,
    prepare
  }: {
    chainId: string
    type: RailgunPrivateOperation['type']
    tokenAddress: `0x${string}`
    isNative: boolean
    amount: bigint
    recipient: string
    protocolFee: bigint
    failureMessage: string
    prepare: (
      plugin: RailgunPlugin,
      asset: AssetId
    ) => Promise<{
      op: Parameters<RailgunPlugin['broadcast']>[0]
      disposableSigner?: EthSigner
    }>
  }) {
    const plugin = this.#getChainPlugin(chainId)

    const activityId = this.#addActivityEntry({
      chainId,
      type,
      tokenAddress,
      isNative,
      amount,
      recipient,
      protocolFee
    })

    this.#startPrivateOperation({
      id: activityId,
      chainId,
      type,
      tokenAddress,
      isNative,
      amount,
      recipient
    })

    // Held across proving too, not just the broadcast: preparing an operation drains notes through
    // the same WASM module a concurrent sync would use.
    this.#isBroadcastingPrivateOperation = true
    try {
      const asset: AssetId = isNative
        ? { __type: 'native' }
        : { __type: 'erc20', contract: tokenAddress }

      const { op, disposableSigner } = await prepare(plugin, asset)
      // The notes are picked at this point, so what is left is the long part: proving, submitting
      // and waiting for the bundler.
      this.#setPrivateOperationPhase(activityId, 'proving')
      await this.#broadcastPrivateOperation(chainId, plugin, op, disposableSigner)

      this.#updateActivityEntry(activityId, { status: 'success' })
      this.#updatePrivateOperation(activityId, { status: 'success' })
    } catch (error: any) {
      const message = getPrivateOperationErrorMessage(error, failureMessage)
      this.#updateActivityEntry(activityId, { status: 'failed', error: message })
      this.#updatePrivateOperation(activityId, { status: 'failed', error: message })

      throw new EmittableError({ message, level: 'major', error })
    } finally {
      this.#isBroadcastingPrivateOperation = false
    }
  }

  async buildAndBroadcastUnshield({
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
    await this.withStatus(
      'buildAndBroadcastUnshield',
      () =>
        this.#runPrivateOperation({
          chainId,
          type: 'unshield',
          tokenAddress,
          isNative,
          amount,
          recipient: toAddress,
          // Railgun's cut is arithmetic on the amount, so it is recorded up front: the operation
          // spends the grossed-up amount, and this is the part the recipient never sees.
          protocolFee: getRailgunUnshieldAmounts(amount, RAILGUN_FEE_BPS).feeAmount,
          failureMessage: 'Failed to unshield.',
          prepare: async (plugin, asset) => {
            // The pool holds no ETH, so a native unshield is really a WETH unshield followed by
            // `WETH.withdraw`, which burns from `msg.sender` - the smart account that runs the
            // UserOp. Unshielding straight to the recipient cannot work (the WETH would sit on an
            // address the UserOp can't spend from, and the unwrap would revert), so the pool pays
            // the smart account and a tail call on the same UserOp forwards the ETH on. ERC-20
            // unshields need none of this and go straight to the recipient.
            const disposableSigner = isNative ? this.#createDisposableBroadcastSigner() : undefined
            const unshieldToAddress = disposableSigner ? disposableSigner.address : toAddress

            const op = await plugin.prepareUnshield({ asset, amount }, unshieldToAddress, {
              tailCalls: disposableSigner
                ? async (smartAccountAddress) => {
                    // Guards against the SDK resolving the tails against a different address than
                    // the one the WETH was unshielded to - that would forward ETH the account
                    // doesn't hold, reverting the UserOp at best and stranding the funds at worst.
                    if (smartAccountAddress.toLowerCase() !== unshieldToAddress.toLowerCase())
                      throw new Error(
                        `railgun: unshield tail call address mismatch (built for ${unshieldToAddress}, resolved ${smartAccountAddress})`
                      )

                    return [{ to: toAddress, data: '0x', value: amount }]
                  }
                : undefined
            })

            return { op, disposableSigner }
          }
        }),
      true
    )
  }

  async buildAndBroadcastTransfer({
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
    await this.withStatus(
      'buildAndBroadcastTransfer',
      () =>
        this.#runPrivateOperation({
          chainId,
          type: 'transfer',
          tokenAddress,
          // Private transfers never involve the native asset - the pool holds none
          isNative: false,
          amount,
          recipient: toZkAddress,
          // Nothing crosses the pool's boundary, which is the only place Railgun charges
          protocolFee: 0n,
          failureMessage: 'Failed to send privately.',
          prepare: async (plugin, asset) => ({
            op: await plugin.prepareTransfer(
              { asset: asset as ERC20AssetId, amount },
              toZkAddress as RailgunAddress
            )
          })
        }),
      true
    )
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
      hasSyncedAnyChain: this.hasSyncedAnyChain,
      chains: this.chains,
      tokensData: this.tokensData,
      activity: this.activity
    }
  }
}
