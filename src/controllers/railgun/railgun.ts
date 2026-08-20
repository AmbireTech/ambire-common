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

/**
 * The outcomes of a shield's transaction that mean the funds will never arrive, so its activity
 * entry can stop waiting for them - see `handleShieldAccountOpStatusUpdate`.
 *
 * 'broadcast-but-stuck' and 'partially-complete' are deliberately absent: the first can still be
 * mined, and the second says some call in the batch went through without saying which - so both are
 * left to the balance to answer (see `#resolvePendingShields`).
 */
const FAILED_SHIELD_ACCOUNT_OP_STATUSES: (AccountOpStatus | undefined)[] = [
  AccountOpStatus.Failure,
  AccountOpStatus.Rejected,
  AccountOpStatus.UnknownButPastNonce
]
// Catching an identity up on a chain it has state for only covers the tail - measured at ~6s on
// Ethereum. The budget is generous against that, but bounded, because a wedged sync would otherwise
// lock the user out of the whole screen: `withStatus` refuses to start an action while another is
// LOADING, including the refresh that would recover it.
const RAILGUN_CATCH_UP_TIMEOUT_IN_MS = 3 * 60 * 1000
// An identity's *first* scan of a chain is a different animal: it walks the pool's whole history and
// runs Groth16 in WASM for the notes it finds. The budget is the same figure the UI states as the
// upper bound, so we cannot give up before our own promise expires - see
// RAILGUN_INITIAL_SYNC_MAX_MINUTES for the measurements behind it. The distinction that matters is
// first scan versus catch-up, and getting it from `lastSyncedAt` instead of from what is actually
// persisted is what used to apply the 3-minute budget to a 6-minute walk, timing it out on every
// attempt.
const RAILGUN_FIRST_SCAN_TIMEOUT_IN_MS = RAILGUN_INITIAL_SYNC_MAX_MINUTES * 60 * 1000
// Owned by this module and handed to `withTimeout` as its rejection message, so a soft timeout
// can be told apart from an error raised by the scan itself - see #syncChain.
const RAILGUN_SYNC_TIMEOUT_MESSAGE =
  'Syncing your shielded balances took too long. Please try again.'
// Owned by this module, like the timeout message above, so an operation abandoned because the
// selected identity changed can be told apart from a real failure - it is nobody's error and must
// not be reported as one. See #abortInFlightOperations.
const RAILGUN_ABORTED_MESSAGE = 'railgun: superseded by a newer identity'
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
 * What one private operation's UserOperation costs in gas, all limits included (execution, account
 * verification, and the paymaster's own verification of the proof).
 *
 * A single conservative figure rather than a model: the real number is only produced once the proof
 * exists, and erring high here is the safe direction - the estimate is labelled as one, and an
 * operation that turns out cheaper is a pleasant surprise, while one that turns out dearer than
 * promised is not.
 *
 * TODO(calibration): replace with a measurement once a few real operations have been observed - the
 * broadcast debug log records every UserOperation's gas fields.
 */
const PRIVATE_OPERATION_GAS_ESTIMATE = 1_800_000n
// How much room on top of the estimate the shielded WETH balance is checked against, since the fee
// is sized minutes later against a gas price that has moved by then.
const NETWORK_FEE_HEADROOM_MULTIPLIER = 3n
const NETWORK_FEE_HEADROOM_DIVISOR = 2n

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
  // Kept apart from `init` so the UI can tell "deriving the identity" - instant, automatic on
  // opening the screen - from "scanning a pool", which takes minutes and is asked for.
  initIdentity: 'INITIAL',
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
/**
 * Decodes what the SDK hex-encoded - key names for the measurement inventory above, and values for
 * `hasPendingPoi`, since the Rust side encodes both.
 * Falls back to the raw input if it isn't valid hex: a log line reads better with the raw string
 * than with nothing, and `hasPendingPoi` treats anything it cannot parse as "cannot tell".
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
 * transaction whose outputs have no innocence proof yet (`PendingPoiEntry` in the SDK's
 * `poi/provider.rs`) and `pois` is a re-fetchable cache of statuses.
 *
 * Singled out by name because it is the only entry the SDK cannot rebuild from chain state, which
 * makes it the exception on both paths that touch it - see `scopedTo` and `hasPendingPoi`.
 */
const POI_STATE_KEY_NAME = 'poi_provider'

// Compared as hex so the write path never has to decode a key name.
const POI_STATE_KEY_NAME_IN_HEX = toHexKeyName(POI_STATE_KEY_NAME)

const isPoiStateKey = (key: string) => key.slice(key.indexOf(':') + 1) === POI_STATE_KEY_NAME_IN_HEX

// The only `poi_provider` schema this code reads. Anything else is left alone - see hasPendingPoi.
const SUPPORTED_POI_STATE_SCHEMA_VERSION = 1

/**
 * Kept vague on purpose: the user cannot act on it, and the only thing that matters is that it
 * reaches the report, since it means the SDK changed a format this code depends on.
 */
const POI_STATE_READ_ERROR_MESSAGE =
  'A privacy pool check could not be completed. Your funds are not affected.'

export class RailgunHostStorageAdapter implements RailgunHostStorage {
  readonly _brand = 'Storage' as const

  #storage: IStorageController

  #onError: (error: unknown, message?: string) => void

  #cache: Record<string, string> | null = null

  #hydratePromise: Promise<Record<string, string>> | null = null

  // The write every `set` in the current burst joins, so they persist together.
  #scheduledWrite: Promise<void> | null = null

  #writeQueue: Promise<void> = Promise.resolve()

  #skippedWriteCount = 0

  // Since `set` no longer awaits persistence, a failed write has no caller left to throw at -
  // hence the injected reporter. `message` is for the readers that report something other than a
  // failed write, and falls back to the write wording when omitted.
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

    // The SDK re-serializes and hands back every key on every sync, whether or not it changed: a
    // catch-up with zero new commitments still returns all four 18 MB UTXO trees byte-for-byte
    // identical. Comparing is memory bandwidth; persisting is a rewrite of the whole blob, so an
    // unchanged value must never reach the write queue.
    if (cache[key] === value) {
      this.#skippedWriteCount += 1

      return
    }

    cache[key] = value

    // Deliberately not returned: see the class comment for why the caller must not wait for
    // persistence. Failures are reported rather than thrown, since there is nobody left to
    // throw at.
    this.#scheduleWrite().catch(this.#onError)
  }

  /** How many identical writes have been skipped, so the effect of the check above is measurable. */
  get skippedWriteCount(): number {
    return this.#skippedWriteCount
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
   * TEMPORARY, for the cold-sync measurement: what the persisted blob currently holds, with the
   * SDK's hex-encoded key names decoded. Exists to establish which entries are shared per chain
   * (the trees, which is where the megabytes are) and which are per identity (the decrypted-notes
   * entry, keyed by the chain-scoped 0zk address), and how much a second identity therefore has to
   * redo. Values are never read - only key names and byte lengths.
   */
  async inventory(): Promise<{ key: string; bytes: number }[]> {
    const cache = await this.#hydrate()

    return Object.entries(cache)
      .map(([key, value]) => {
        const separatorIndex = key.indexOf(':')
        const chainId = key.slice(0, separatorIndex)
        const encodedName = key.slice(separatorIndex + 1)

        return { key: `${chainId}:${fromHexEncoded(encodedName)}`, bytes: value.length }
      })
      .sort((a, b) => b.bytes - a.bytes)
  }

  /**
   * Whether this identity has already been initialized on this chain, answered from the one place
   * that knows: the persisted blob. No separate "already set up" flag has to be kept in sync with
   * it, because the state IS the flag.
   *
   * `identityAddress` must be the SDK's own chain-scoped variant (`instanceId()`, i.e.
   * `RailgunSigner.privateKey(spending, viewing, chainId)`), not the chain-agnostic address the UI
   * displays: the two encode the same keys but differ in the middle of the bech32m, so looking an
   * identity up by the displayed one never matches anything.
   *
   * Biased towards "no": a false negative only offers an initialization that turns out quick, while
   * a false positive would apply the catch-up timeout to a full history walk.
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
   * A view of this storage bound to one plugin's lifetime. `isLive` is asked on every write, and a
   * write from a plugin that is no longer the live one for its chain is dropped.
   *
   * This is what keeps an abandoned scan from corrupting the chain's cursor. A scan cannot be
   * cancelled - it keeps running inside WASM after we stop awaiting it - and the chain-wide keys
   * (`utxo_indexer`, the trees) are the same ones the plugin that replaced it writes. Without this,
   * the abandoned scan can persist an older `synced_block` on top of a newer one, or a shorter tree
   * over a longer one, and the next sync has to redo the difference.
   *
   * `poi_provider` is deliberately exempt, because for it the trade is inverted. Every other entry
   * is a snapshot of chain state, so refusing a stale write costs a rescan at worst - while
   * `pending` holds the witnesses for POI proofs that have not been submitted yet, which the SDK
   * records once, while building the transaction (`register_ops`), and can rebuild from nothing.
   * Refusing that write therefore does not lose a refresh, it loses the only copy there is: the
   * note's outputs stay without an innocence proof, and the SDK's own note selection then refuses
   * to spend them - for unshields as much as for private transfers. A stale POI write cannot cause
   * the matching damage, since a superseded plugin can only have entries the live one either also
   * has or has already submitted.
   *
   * Reads are left alone: they cannot corrupt anything, and refusing them would only make the
   * abandoned scan fail in less predictable ways.
   */
  scopedTo(isLive: () => boolean, onRefusedWrite?: (keyName: string) => void): RailgunHostStorage {
    return {
      _brand: 'Storage' as const,
      get: (key: string) => this.get(key),
      set: async (key: string, value: string) => {
        if (!isLive() && !isPoiStateKey(key)) {
          // Reported rather than silent: a refused write used to leave no trace at all, which is
          // what made a lost POI witness look like the aggregator taking its time.
          onRefusedWrite?.(fromHexEncoded(key.slice(key.indexOf(':') + 1)))

          return
        }

        await this.set(key, value)
      }
    }
  }

  /**
   * Whether the SDK still owes a POI proof for this chain, answered from its own persisted state
   * rather than from a flag of ours.
   *
   * `poi_provider.pending` holds one entry per transaction whose outputs have no innocence proof
   * yet, and the SDK removes an entry only once the aggregator has accepted the proof - which it
   * attempts on every `provider.sync()`. So the state IS the marker: there is nothing to keep in
   * sync, and it clears itself.
   *
   * Reads the length and nothing else, and only for a schema version it recognises. Anything else
   * answers "no": being wrong here delays a submission until the next sync at worst, and can never
   * affect what is submitted.
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

  /**
   * Sync state per identity, then per chain.
   *
   * Keyed by the 0zk address rather than only by chain because everything in `RailgunChainState`
   * except the pool flags belongs to an identity, not to a network: balances, `lastSyncedAt`, the
   * synced-through block. Keying it by chain alone meant two recovery phrases shared one slot, so
   * one identity's finished scan made the other look synced - and, worse, made `isFirstSync` false
   * for a scan that had never run, which applied the 3-minute timeout to a 6-minute walk and left
   * the chain in a permanent retry loop.
   *
   * Kept per identity rather than cleared on every switch so that switching back shows the last
   * known balances immediately instead of re-scanning for them.
   */
  /**
   * Symbol, decimals and price for every token seen in a pool, keyed by chain and then by
   * lowercased token address.
   *
   * Kept outside `#chainStatesByIdentity` on purpose, even though everything else about a pool
   * lives there: this is a property of the token contract and of its market, so it is identical
   * for every identity. Keying it per identity would re-read it on every identity switch and
   * would let one identity's failed lookup present itself as another's unknown token.
   *
   * In memory only, like the chain states: a persisted price is a stale price, and symbol/decimals
   * cost one batched `eth_call` per session to read again.
   */
  #tokensDataByChain: { [chainId: string]: { [address: string]: RailgunTokenData } } = {}

  #chainStatesByIdentity: { [railgunAddress: string]: { [chainId: string]: RailgunChainState } } =
    {}

  activity: RailgunActivityEntry[] = []

  /**
   * The private operation on screen: the one running, or the last one until the user dismisses it.
   * A broadcast takes minutes and never opens the signing screen, so "it is running, this is how far
   * it got, this is how it ended" has to be state the UI can render - not a toast at the end.
   */
  privateOperation: RailgunPrivateOperation | null = null

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

  // Aborted whenever what is being synced stops being what the user is looking at.
  #abortController = new AbortController()

  /**
   * Bumped every time a chain's plugin is discarded, so the storage view handed to that plugin can
   * tell it is no longer the live one - see `RailgunHostStorageAdapter.scopedTo`.
   *
   * Per chain rather than global because that is the granularity at which plugins are replaced: a
   * timed-out scan discards one chain's plugin and the next sync builds a fresh one, while the
   * abandoned scan keeps running against the same chain-wide keys.
   */
  #chainPluginGenerations = new Map<string, number>()

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
    this.#pluginStorage = new RailgunHostStorageAdapter(storage, (error, message) =>
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
        // shows them at once instead of re-scanning. Railgun stays opt-in, so the new account is not
        // initialized here - the user enables it.
        //
        // Keyed on there being an identity rather than on there being plugins, for the same reason
        // as the lock above: an account whose identity was derived without any chain being scanned
        // has no plugins, so the old condition left that identity up - and with it an address, and
        // everything the UI reads through it, belonging to an account that is no longer selected.
        if (this.#railgunKeystoreSeedId && seedId !== this.#railgunKeystoreSeedId)
          this.#teardown({ wipeBalances: false })

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
   * The current identity's per-chain state, which is what the UI reads. A getter rather than a
   * field, so the identity-keyed buckets above stay an implementation detail and the UI keeps
   * indexing by chain id.
   */
  get chains(): { [chainId: string]: RailgunChainState } {
    return (this.railgunAddress && this.#chainStatesByIdentity[this.railgunAddress]) || {}
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

  /**
   * Deliberately not derived from any existing entry: a write for an identity that has no entry for
   * this chain yet must start from nothing, or it would copy whatever the currently selected
   * identity happens to hold - which is the cross-identity bleed this whole structure exists to
   * prevent.
   */

  #getDefaultChainState(chainId: string): RailgunChainState {
    return {
      chainId,
      wrappedBaseTokenAddress: null,
      syncStatus: 'idle',
      hasIdentityData: false,
      lastSyncedAt: null,
      syncStartedAt: null,
      balances: [],
      error: null
    }
  }

  #getChainState(chainId: string): RailgunChainState {
    return (
      this.chains[chainId] || {
        chainId,
        wrappedBaseTokenAddress: null,
        syncStatus: 'idle',
        hasIdentityData: false,
        lastSyncedAt: null,
        syncStartedAt: null,
        balances: [],
        error: null
      }
    )
  }

  get tokensData(): { [chainId: string]: { [address: string]: RailgunTokenData } } {
    return this.#tokensDataByChain
  }

  /**
   * Resolves symbol, decimals and price for the tokens this chain's pool holds, in one batch for
   * all of them, right after a sync has written the balances. Runs there rather than lazily from
   * the UI because the balances are what reveal which tokens exist: the pool has no token list, so
   * the scan result IS the discovery.
   *
   * The wrapped base token is always included, even at a zero balance, because the unshield form
   * offers to take shielded ETH out unwrapped and needs its decimals to parse the amount.
   *
   * Never throws: the sync it runs at the end of has just produced correct balances of real money,
   * and a slow price server must not turn that into a failed sync. A token left unresolved shows
   * as such and is blocked in the forms - see the RailgunTokenData docs.
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

      // Debug-logged rather than emitted: this runs on every sync, including the periodic
      // background ones, so a token cena doesn't know would otherwise toast forever.
      if (errors.length)
        this.debugLog('sync', 'could not resolve data for every shielded token', {
          chainId,
          errors
        })
    } catch (error: any) {
      this.debugLog('sync', 'resolving shielded token data failed', {
        chainId,
        error: error?.message
      })
    }
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
    if (!this.railgunAddress) return

    this.#setChainStateFor(this.railgunAddress, chainId, update)
  }

  /**
   * Writes into a named identity's bucket. Every long operation captures the identity it started
   * for and writes through this, so an abandoned scan - which keeps running inside WASM, since it
   * cannot be cancelled - lands on its own identity instead of on the one now selected.
   */
  #setChainStateFor(identityAddress: string, chainId: string, update: Partial<RailgunChainState>) {
    const identityChains = this.#chainStatesByIdentity[identityAddress] || {}
    const current = identityChains[chainId] || this.#getDefaultChainState(chainId)

    this.#chainStatesByIdentity = {
      ...this.#chainStatesByIdentity,
      [identityAddress]: { ...identityChains, [chainId]: { ...current, ...update } }
    }
  }

  #updateChainStateFor(
    identityAddress: string,
    chainId: string,
    update: Partial<RailgunChainState>
  ) {
    this.#setChainStateFor(identityAddress, chainId, update)
    this.emitUpdate()
  }

  /**
   * Marks the chains that will wait their turn, and returns the undo. Scans cannot overlap (the WASM
   * module is single-threaded and non-reentrant), so everything after the first is genuinely queued
   * and saying so beats a second spinner that never moves.
   *
   * The undo is not optional: a run can end without touching every chain it marked - a background
   * refresh skips one that is already fresh, an abort breaks out early - and a 'queued' status left
   * behind is a row that waits forever for something that already finished.
   */
  #markQueued(chainIds: string[]): () => void {
    const queuedChainIds = chainIds.slice(1)
    queuedChainIds.forEach((chainId) => this.#updateChainState(chainId, { syncStatus: 'queued' }))

    return () => {
      queuedChainIds.forEach((chainId) => {
        if (this.#getChainState(chainId).syncStatus !== 'queued') return

        // 'ready' means "not doing anything", not "the scan worked" - a chain that has never been
        // scanned goes back to 'idle' so its row keeps offering to start one.
        this.#updateChainState(chainId, {
          syncStatus: this.#getChainState(chainId).lastSyncedAt ? 'ready' : 'idle'
        })
      })
    }
  }

  #getChainPluginGeneration(chainId: string): number {
    return this.#chainPluginGenerations.get(chainId) ?? 0
  }

  /** Does not emit - see #updateChainState. */
  #teardownChain(chainId: string) {
    // Before the plugin is dropped: from here on, anything it still writes is a write from a
    // superseded plugin and has to be refused.
    this.#chainPluginGenerations.set(chainId, this.#getChainPluginGeneration(chainId) + 1)
    this.#plugins.delete(chainId)
    this.#providerInstances.delete(chainId)
    this.#setChainState(chainId, { syncStatus: 'idle', syncStartedAt: null })
  }

  /**
   * Stops awaiting everything in flight and makes any result that still arrives be discarded.
   *
   * The work itself cannot be cancelled - the WASM module is single-threaded and offers no abort -
   * so this is two things at once: stop waiting, which frees the queue for the identity that
   * replaced this one, and refuse the result, which is what `#setChainStateFor` guarantees by
   * writing to the identity the operation started for.
   */
  #abortInFlightOperations() {
    this.#abortController.abort()
    this.#abortController = new AbortController()
  }

  /**
   * Rejects with `RAILGUN_ABORTED_MESSAGE` as soon as the current operations are aborted, so a call
   * into the WASM can be given up on. The underlying work keeps running - see
   * #abortInFlightOperations.
   */
  #withAbort<T>(operation: Promise<T>): Promise<T> {
    const { signal } = this.#abortController
    if (signal.aborted) return Promise.reject(new Error(RAILGUN_ABORTED_MESSAGE))

    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(new Error(RAILGUN_ABORTED_MESSAGE))
      signal.addEventListener('abort', onAbort, { once: true })

      operation.then(resolve, reject).finally(() => {
        signal.removeEventListener('abort', onAbort)
      })
    })
  }

  /**
   * Drops everything derived from the current keystore/account state. Does not emit.
   *
   * `wipeBalances` separates the two reasons this runs. Locking the wallet must not leave balances
   * in memory; selecting another account must, because they belong to an identity that is still
   * perfectly valid and re-scanning for them costs seconds the user does not need to spend.
   */
  #teardown({ wipeBalances }: { wipeBalances: boolean }) {
    this.#abortInFlightOperations()
    // Whatever the sheet was showing belonged to the identity being dropped, so it must not be
    // presented as the next one's - even a run that is still finishing inside the WASM, whose result
    // can no longer be attributed to what is now on screen.
    this.privateOperation = null
    // Same reason as in #teardownChain, for every chain at once.
    this.#plugins.forEach((_, chainId) =>
      this.#chainPluginGenerations.set(chainId, this.#getChainPluginGeneration(chainId) + 1)
    )
    this.#plugins.clear()
    this.#providerInstances.clear()
    this.#enabledChainIds.clear()
    this.#railgunKeystore = null
    this.#railgunKeystoreSeedId = null

    const identityAddress = this.railgunAddress
    this.railgunAddress = null

    if (identityAddress)
      Object.keys(this.#chainStatesByIdentity[identityAddress] || {}).forEach((chainId) =>
        this.#setChainStateFor(identityAddress, chainId, {
          syncStatus: 'idle',
          syncStartedAt: null,
          // A teardown is not a failure of the chain, so a stale error must not survive into the
          // next attempt.
          error: null,
          ...(wipeBalances && { balances: [] })
        })
      )

    if (wipeBalances) this.#chainStatesByIdentity = {}

    // The last writes of an interrupted sync are still only in memory.
    this.#pluginStorage
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
        if (wipeBalances) this.#pluginStorage.clearCache()
      })
  }

  destroy() {
    this.#unsubscribers.forEach((unsubscribe) => unsubscribe())
    this.#unsubscribers = []
    this.#teardown({ wipeBalances: true })
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
   * Derives the 0zk identity and nothing else: no provider, no pool, no chain data. Cheap enough to
   * run on every visit to the Privacy screen, which is what lets the address be shown - and used to
   * receive - before any scan has been started.
   *
   * Deliberately does NOT build the plugins. `createRailgunPlugin` deserializes the persisted pool
   * state and calls `provider.register(signer)`, which for an identity the pool has not seen means
   * trial-decrypting every commitment in it; doing that on a screen visit is what previously made
   * opening Privacy start a multi-minute scan nobody asked for.
   *
   * Finishes by catching up the chains this identity already has state for - seconds of work, and
   * since `chains` is not persisted it is the only thing that can put those balances back on screen
   * after a background restart.
   */
  async initIdentity() {
    /**
     * Deliberately NOT queued behind #wasmQueue, unlike everything else that reaches into the SDK.
     * That queue exists because two concurrent calls on the *same* plugin abort the module, and
     * deriving an identity touches no plugin at all: it initializes the module (a no-op after the
     * first time), derives two keys through the keystore's own cache, builds fresh `RailgunSigner`
     * objects and reads the persisted blob.
     *
     * Queueing it meant that switching accounts while a private operation was proving left the new
     * account with no address and no screen state for minutes, waiting on work that had nothing to do
     * with it.
     */
    await this.withStatus('initIdentity', () => this.#resolveIdentity(), true)

    const chainIdsToCatchUp = this.supportedChainIds.filter(
      (chainId) => this.#getChainState(chainId).hasIdentityData
    )
    if (!chainIdsToCatchUp.length) return

    await this.withStatus(
      'init',
      () => this.#queueWasmOperation(() => this.#init(chainIdsToCatchUp)),
      true
    )
  }

  /**
   * Brings up every supported chain and scans it. This is the explicit, user-initiated first scan -
   * it walks each pool's whole history, measured at ~11 minutes on Ethereum for the first identity
   * and ~6 for a further one, and it grows with the pool.
   */
  async init() {
    await this.withStatus(
      'init',
      () => this.#queueWasmOperation(() => this.#init(this.supportedChainIds)),
      true
    )
  }

  /**
   * The first scan of one pool. Exists because being scanned is per chain, not wallet-wide: an
   * identity can be fully synced on Ethereum and have nothing on Sepolia, and that Sepolia scan is
   * still its own deliberate choice.
   */
  async initChainAndSync(chainId: string) {
    await this.withStatus('init', () => this.#queueWasmOperation(() => this.#init([chainId])), true)
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

    const errors: any[] = []

    // Marked up front, so a chain that is going to be scanned says so instead of looking idle:
    // scans cannot overlap (single-threaded, non-reentrant WASM), so everything after the first is
    // genuinely waiting its turn.
    const clearQueuedStatus = this.#markQueued(chainIds)

    try {
      await this.#initAndSyncChains(chainIds, errors)
    } finally {
      clearQueuedStatus()
    }

    // Every chain failed, so there is nothing on screen for the per-chain errors to sit next to -
    // the first one is re-thrown so `withStatus` surfaces it as the reason the scan did nothing.
    if (errors.length === chainIds.length) throw errors[0]
  }

  /** The per-chain loop of #init, split out so its queued markers can be cleared in one place. */
  async #initAndSyncChains(chainIds: string[], errors: any[]) {
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
        // The identity this ran for is no longer selected: #teardown has already reset its chains
        // and there is nobody left to report to. The rest of the run is equally pointless.
        if (error?.message === RAILGUN_ABORTED_MESSAGE) break

        errors.push(error)
        this.#updateChainState(chainId, {
          error: error?.message || 'Could not enable Railgun on this network.'
        })
      }
    }
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

  async #initChain(chainId: string) {
    if (this.#plugins.has(chainId)) return

    const seedId = this.#assertAvailableAndGetSeedId()

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

    // Captured before the plugin exists, so the view it gets is bound to exactly this instance.
    const pluginGeneration = this.#getChainPluginGeneration(chainId)

    // One line per entry rather than per write: an abandoned mainnet scan keeps writing the same
    // handful of keys thousands of times, and a log nobody can read is as good as no log.
    const keyNamesRefusedForThisPlugin = new Set<string>()

    const host: RailgunHost = {
      keystore: railgunKeystore,
      storage: this.#pluginStorage.scopedTo(
        () => this.#getChainPluginGeneration(chainId) === pluginGeneration,
        (keyName) => {
          if (keyNamesRefusedForThisPlugin.has(keyName)) return

          keyNamesRefusedForThisPlugin.add(keyName)
          this.debugLog('sync', 'refused a write from a superseded plugin', { chainId, keyName })
        }
      ),
      provider: toEthereumProvider(provider as JsonRpcProvider),
      network: {
        // node-fetch's Response/RequestInfo (Ambire's Fetch type) and the DOM lib's
        // Response/RequestInfo (Host.network's declared shape) are structurally
        // equivalent at runtime but distinct nominal types, hence the local cast here.
        fetch: (input, init) =>
          this.#fetch(input as unknown as string, init as any) as unknown as Promise<Response>
      }
    }

    // Timed for the measurement: `createRailgunPlugin` loads the persisted pool state and calls
    // `provider.register(signer)`. For an identity this pool has never seen, that registration is
    // what trial-decrypts every existing commitment - i.e. the whole cost of a *second* identity on
    // an already-downloaded chain sits here, not in the sync below.
    // Read before the build, not after: the build itself writes state, so an inventory taken
    // afterwards could not tell a first identity from a second one.
    const storageBefore = this.isDebugLogEnabled ? await this.#pluginStorage.inventory() : []
    const pluginBuildStartedAt = Date.now()

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

    this.debugLog('sync', 'plugin built', {
      chainId,
      durationMs: Date.now() - pluginBuildStartedAt,
      // What was on disk before this ran, so the duration can be attributed: an empty inventory
      // means nothing to load and nothing to decrypt, entries for this chain mean the trees were
      // there, and an entry ending in this identity's chain-scoped address means even the notes
      // were - which is the difference between a first and a second identity.
      storageBefore
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
  /**
   * Derives the identity and records, per chain, what is already on the device for it. Everything
   * here is either a cached key derivation or a read of the persisted blob - no chain data, no
   * plugin - which is what makes it safe to run on every visit to the Privacy screen.
   */
  async #resolveIdentity() {
    const seedId = this.#assertAvailableAndGetSeedId()

    // Deliberately called without a log level here as well - see #takeSdkLogLevel.
    await ensureInitialized(await this.#loadWasm())
    await this.#resolveRailgunAddress(this.#getRailgunKeystore(seedId))
  }

  async #resolveRailgunAddress(railgunKeystore: AmbireRailgunKeystore) {
    // Free after `createRailgunPlugin` derived the same two paths through this same instance -
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

        this.#setChainStateFor(railgunAddress, chainId, {
          hasIdentityData: await this.#pluginStorage.hasStateForIdentity(
            chainId,
            chainScopedAddress
          )
        })
      })
    )

    // Published only now, together with the state that describes it. Assigning it before the reads
    // above left a window in which the UI saw an identity with no chain state yet - long enough,
    // because reading the persisted blob can mean re-hydrating ~140 MB - and every network looked
    // un-enabled. That is what made the "enable on all networks" banner flash on account switch for
    // an identity that was already enabled.
    this.railgunAddress = railgunAddress
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
   * before the user commits to it.
   *
   * Only the network fee: Railgun's own fee is arithmetic on the amount and a fixed rate, which the
   * UI does itself (see getPrivacyProtocolFee) so that no figure in the form ever waits on - or is
   * lost to - a round trip. This one needs the background for the gas price and the shielded balance.
   *
   * Bounded and cheap (one gas-price read), hence `#sendUiMessage` rather than a status - see
   * buildShieldCalls for the same pattern.
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
   * Marks pending shields as successful once their token's shielded balance grows.
   *
   * The fallback, not the main path: a shield normally resolves from its own transaction (see
   * `handleShieldAccountOpStatusUpdate`), and this covers the shields whose transaction was never
   * seen from here - one broadcast before a background restart, or from another device on the same
   * recovery phrase. Deliberately a heuristic: an incoming private transfer of the same token, in
   * the same window, resolves the entry too.
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

    return this.activity.find((entry) => entry.id === activityId && entry.status === 'pending')
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
   * What a shield's transaction did, as the Activity controller resolved it. This is the accurate
   * signal that a shield landed, and the fast one: the balance heuristic it replaces only speaks on
   * the next pool scan, which is up to a few minutes away and minutes long on Ethereum.
   *
   * A confirmed shield is followed by a scan, because the shielded balance is what the user is
   * sent back to look at and the pool has to be read for it to appear. Skipped when there is
   * nothing to scan with (a background restart drops every plugin) or while a scan is already
   * running - both only produce an error the user can do nothing about, and the periodic refresh
   * covers the tail either way.
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
    // Cheap and idempotent, and needed because a refresh can be the first thing that runs after a
    // chain was torn down - #initChain no longer resolves the identity itself. Also refreshes the
    // per-chain summaries the filter below reads.
    await this.#resolveIdentity()

    const candidateChainIds = isBackgroundUpdate
      ? [...this.#enabledChainIds]
      : this.supportedChainIds

    /**
     * The chains whose POI proofs the SDK has recorded but not submitted yet. Read up front because
     * the filter below is synchronous, and per chain because a proof can only be submitted by a
     * plugin for the chain that holds the transaction.
     *
     * This is what makes the freshness check below not apply to them: submitting is something only
     * a sync does, and it cannot succeed on the sync the broadcast itself runs - the aggregator has
     * to validate the transaction's txid first, which takes minutes. So the proof always lands on a
     * later sync, and a chain that is "fresh enough" to skip is exactly the case where it never
     * does.
     */
    const chainIdsOwingPoi = new Set(
      (
        await Promise.all(
          candidateChainIds.map(async (chainId) =>
            (await this.#pluginStorage.hasPendingPoi(chainId)) ? chainId : null
          )
        )
      ).filter((chainId): chainId is string => !!chainId)
    )

    if (chainIdsOwingPoi.size)
      this.debugLog('sync', 'chains with a POI proof still to submit', {
        chainIds: [...chainIdsOwingPoi]
      })

    // Every exclusion is decided here, before anything is marked as queued. Marking first and
    // filtering inside the loop is what used to leave a skipped chain showing "waiting" forever: a
    // background refresh right after a scan finds that chain fresh, `continue`s past it, and never
    // writes a terminal status.
    const chainIds = candidateChainIds.filter((chainId) => {
      const { hasIdentityData, lastSyncedAt } = this.#getChainState(chainId)

      // A refresh only ever catches up. A chain this identity has never scanned would turn it into
      // the minutes-long first walk, which is the user's choice to make - see `initChainAndSync`.
      if (!hasIdentityData) {
        this.debugLog('sync', 'skipped a chain this identity has never scanned', { chainId })

        return false
      }

      const isFreshEnough =
        !!lastSyncedAt &&
        Date.now() - lastSyncedAt < MIN_BACKGROUND_SYNC_AGE_IN_MS &&
        !chainIdsOwingPoi.has(chainId)

      if (isBackgroundUpdate && isFreshEnough) {
        this.debugLog('sync', 'skipped a background sync - already fresh', {
          chainId,
          lastSyncedAt
        })

        return false
      }

      return true
    })

    const clearQueuedStatus = this.#markQueued(chainIds)

    try {
      await this.#syncChains(chainIds, errors)
    } finally {
      clearQueuedStatus()
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

  /**
   * The per-chain loop of #sync, split out so its queued markers can be cleared in one place.
   *
   * Sequentially, never in parallel - see #wasmQueue. This runs inside the queue, so no other WASM
   * operation can interleave with it either. Each chain's failure is caught and recorded on that
   * chain, so a refresh still updates the chains that do work.
   */
  async #syncChains(chainIds: string[], errors: any[]) {
    for (const chainId of chainIds) {
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
        // Superseded by another identity: its chains are already reset and the rest of this run is
        // for an identity nobody is looking at.
        if (error?.message === RAILGUN_ABORTED_MESSAGE) break

        errors.push(error)
        this.#updateChainState(chainId, {
          error: error?.message || 'Could not refresh the shielded balances on this network.'
        })
      }
    }
  }

  async #syncChain(chainId: string) {
    const plugin = this.#plugins.get(chainId)
    if (!plugin)
      throw new EmittableError({
        message: 'Railgun is not initialized yet.',
        level: 'minor',
        error: new Error(`railgun: sync called before init for chain ${chainId}`)
      })

    // The identity this scan belongs to, captured before any await. The scan cannot be cancelled -
    // it keeps running inside WASM even after we stop awaiting it - so every write below goes to
    // this identity's bucket rather than to whichever one is selected when it finishes.
    const identityAddress = this.railgunAddress
    if (!identityAddress)
      throw new EmittableError({
        message: 'Railgun is not initialized yet.',
        level: 'minor',
        error: new Error(`railgun: sync called without an identity for chain ${chainId}`)
      })

    // Read from the persisted state, not from `lastSyncedAt`. They disagree in exactly the case
    // that matters: a further identity on an already-scanned chain has no state of its own, so its
    // scan is a full history walk (measured ~6 min on Ethereum) even though the chain looks synced.
    // Deriving this from `lastSyncedAt` in a chain-keyed slot is what applied the 3-minute budget to
    // that walk and left it retrying forever.
    const { hasIdentityData } = this.#getChainState(chainId)
    const isFirstScanForIdentity = !hasIdentityData
    this.#updateChainStateFor(identityAddress, chainId, {
      syncStatus: 'syncing',
      syncStartedAt: Date.now()
    })
    // Logged on the way in as well as on the way out: without a start line there is no way to
    // tell a slow sync from a hung one in the log.
    this.debugLog('sync', 'shielded balance sync started', { chainId, isFirstScanForIdentity })

    // `balance()` syncs the UTXO tree before answering, so its duration is dominated by the
    // chain scan (and, with POI on, by proving), not the balance math. Timed because a slow
    // scan is indistinguishable from a hang in the UI - see the rpcBatchSize note.
    const syncStartedAt = Date.now()
    let hasTimedOut = false
    let wasAborted = false
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
      const balances = await this.#withAbort(
        withTimeout(() => plugin.balance(undefined), {
          timeoutMs: isFirstScanForIdentity
            ? RAILGUN_FIRST_SCAN_TIMEOUT_IN_MS
            : RAILGUN_CATCH_UP_TIMEOUT_IN_MS,
          message: RAILGUN_SYNC_TIMEOUT_MESSAGE
        })
      )
      this.debugLog('sync', 'shielded balance sync completed', {
        chainId,
        isFirstScanForIdentity,
        durationMs: Date.now() - syncStartedAt,
        balancesCount: balances.length,
        // Cumulative for the session. On a catch-up with no new commitments this should account for
        // every key the SDK handed back, i.e. the whole blob was left unwritten.
        skippedIdenticalWrites: this.#pluginStorage.skippedWriteCount
      })

      const { balances: previousBalances, wrappedBaseTokenAddress } = this.#getChainState(chainId)
      const shieldedBalances = balances.filter(isErc20Balance).map((balance) => ({
        tokenAddress: balance.asset.contract,
        amount: balance.amount,
        poiStatus: toRailgunPoiStatus(balance.tag)
      }))

      this.#updateChainStateFor(identityAddress, chainId, {
        balances: shieldedBalances,
        lastSyncedAt: Date.now(),
        // This run is what created the identity's persisted entry, so a later one on this chain is
        // a catch-up and gets the short budget.
        hasIdentityData: true
      })

      this.#resolvePendingShields(chainId, previousBalances)

      await this.#resolveTokensData(chainId, [
        ...shieldedBalances.map((balance) => balance.tokenAddress),
        ...(wrappedBaseTokenAddress ? [wrappedBaseTokenAddress] : [])
      ])
    } catch (error: any) {
      // Compared against the exact message this call site handed to `withTimeout`, which is how
      // it reports a soft timeout - as opposed to an error raised by the scan itself.
      hasTimedOut = error?.message === RAILGUN_SYNC_TIMEOUT_MESSAGE
      // Handled like a timeout, and for the same reason: the scan keeps running inside WASM, so its
      // plugin is poisoned and has to be discarded. Unlike a timeout it is not a failure - the
      // callers drop it instead of reporting it.
      wasAborted = error?.message === RAILGUN_ABORTED_MESSAGE

      throw error
    } finally {
      // The abandoned scan still holds a mutable borrow on this plugin's Rust objects, so the
      // plugin is dropped rather than reused. It stays in `#enabledChainIds`, so the next sync
      // builds a fresh one.
      if (hasTimedOut || wasAborted) this.#teardownChain(chainId)

      // Always leave a terminal status. 'ready' here means "not syncing any more", not "the sync
      // worked" - a failure is reported through emitError and `statuses.sync`. Without this a
      // failed or timed-out scan left `syncStatus` on 'syncing' forever, with nothing to reset it.
      // Skipped when aborted: #teardown has already reset this identity's chains, and writing a
      // status now would resurrect state for an identity that is no longer selected.
      if (!wasAborted)
        this.#updateChainStateFor(identityAddress, chainId, {
          syncStatus: hasTimedOut ? 'idle' : 'ready',
          syncStartedAt: null
        })
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
   *
   * `disposableSigner` may be passed in by the caller when the operation had to be *built*
   * against the smart account's address - native unshields do, see
   * `#createDisposableBroadcastSigner`.
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
      // The sheet's last step: the re-sync below is what confirms the result, since it is the
      // shielded balance - not the bundler's receipt - that tells the user what actually happened.
      if (this.privateOperation)
        this.#setPrivateOperationPhase(this.privateOperation.id, 'finalizing')
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
      recipient: toAddress,
      // Railgun's cut is arithmetic on the amount, so it is recorded up front: the operation spends
      // the grossed-up amount, and this is the part of it the recipient never sees.
      protocolFee: getRailgunUnshieldAmounts(amount, RAILGUN_FEE_BPS).feeAmount
    })

    this.#startPrivateOperation({
      id: activityId,
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

      // The pool holds no ETH, so a native unshield is really a WETH unshield followed by
      // `WETH.withdraw`, which burns from `msg.sender` - the smart account that runs the UserOp.
      // Unshielding straight to the user's recipient therefore cannot work (the WETH would sit on
      // an address the UserOp can't spend from, and the unwrap would revert): the pool must pay
      // the smart account, and a tail call appended to the same UserOp forwards the unwrapped ETH
      // on to the recipient. Ambire's broadcaster is a fresh disposable key, so it can never be
      // the recipient itself - which is what makes the tail call necessary rather than optional.
      // ERC-20 unshields need none of this and go straight to the recipient.
      const disposableSigner = isNative ? this.#createDisposableBroadcastSigner() : undefined
      const unshieldToAddress = disposableSigner ? disposableSigner.address : toAddress
      if (disposableSigner)
        this.debugLog('broadcast', 'native unshield routed through the smart account', {
          chainId,
          smartAccountAddress: unshieldToAddress,
          recipient: toAddress,
          amount
        })

      const op = await plugin.prepareUnshield({ asset, amount }, unshieldToAddress, {
        tailCalls: disposableSigner
          ? async (smartAccountAddress) => {
              // Guards against the SDK resolving the tails against a different address than the
              // one the WETH was unshielded to - that would forward ETH the account doesn't hold
              // (reverting the whole UserOp at best, stranding the funds at worst).
              if (smartAccountAddress.toLowerCase() !== unshieldToAddress.toLowerCase())
                throw new Error(
                  `railgun: unshield tail call address mismatch (built for ${unshieldToAddress}, resolved ${smartAccountAddress})`
                )

              return [{ to: toAddress, data: '0x', value: amount }]
            }
          : undefined
      })
      // The notes are picked at this point, so what is left is the long part: proving, submitting
      // and waiting for the bundler.
      this.#setPrivateOperationPhase(activityId, 'proving')
      await this.#broadcastPrivateOperation(chainId, plugin, op, disposableSigner)

      this.#updateActivityEntry(activityId, { status: 'success' })
      this.#updatePrivateOperation(activityId, { status: 'success' })
    } catch (error: any) {
      const message = getPrivateOperationErrorMessage(error, 'Failed to unshield.')
      this.#updateActivityEntry(activityId, { status: 'failed', error: message })
      this.#updatePrivateOperation(activityId, { status: 'failed', error: message })

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
      recipient: toZkAddress,
      // Nothing crosses the pool's boundary, which is the only place Railgun charges
      protocolFee: 0n
    })

    this.#startPrivateOperation({
      id: activityId,
      chainId,
      type: 'transfer',
      tokenAddress,
      isNative: false,
      amount,
      recipient: toZkAddress
    })

    // See the note in #buildAndBroadcastUnshield - proving uses the same WASM module
    this.#isBroadcastingPrivateOperation = true
    try {
      const asset: ERC20AssetId = { __type: 'erc20', contract: tokenAddress }
      const op = await plugin.prepareTransfer({ asset, amount }, toZkAddress as RailgunAddress)
      // See the note in #buildAndBroadcastUnshield - from here on it is proving and broadcasting.
      this.#setPrivateOperationPhase(activityId, 'proving')
      await this.#broadcastPrivateOperation(chainId, plugin, op)

      this.#updateActivityEntry(activityId, { status: 'success' })
      this.#updatePrivateOperation(activityId, { status: 'success' })
    } catch (error: any) {
      const message = getPrivateOperationErrorMessage(error, 'Failed to send privately.')
      this.#updateActivityEntry(activityId, { status: 'failed', error: message })
      this.#updatePrivateOperation(activityId, { status: 'failed', error: message })

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
      hasSyncedAnyChain: this.hasSyncedAnyChain,
      chains: this.chains,
      tokensData: this.tokensData,
      activity: this.activity
    }
  }
}
