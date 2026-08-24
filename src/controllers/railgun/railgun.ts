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
import type { Eip1193Provider, RailgunAddress, RailgunPlugin, RawLog } from '@kohaku-eth/railgun'

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
// Owned by this module too, so an operation abandoned because the selected identity changed can be
// told apart from a real failure - it is nobody's error and must not be reported as one.
const RAILGUN_ABORTED_MESSAGE = 'railgun: superseded by a newer identity'
// The SDK writes its UTXO/POI state key-by-key, so debouncing is what keeps a sync from rewriting
// the whole blob hundreds of times - see RailgunHostStorageAdapter.
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

/**
 * Satisfies the SDK's `Host.storage` on top of Ambire's fixed-schema StorageController, by folding
 * every write into one flat `railgunPluginStorage` blob. One blob covers all chains, since the SDK
 * prefixes each key with the chain id - which is why one instance serves every chain's Host.
 *
 * The blob is hydrated once and cached, and `set` resolves as soon as the value is in that cache,
 * with the write debounced behind it. Load-bearing rather than an optimisation: the Rust side awaits
 * every `Database::set` in sequence, so waiting for the debounced write would cost the full interval
 * per key - and a mainnet sync touches them by the thousand. Read-after-write still holds, since
 * `get` reads the same cache.
 */
export class RailgunHostStorageAdapter implements RailgunHostStorage {
  readonly _brand = 'Storage' as const

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
   * A view of this storage bound to one plugin's lifetime: a write from a plugin that is no longer
   * the live one for its chain is dropped.
   *
   * This is what keeps an abandoned scan from corrupting the chain's cursor. A scan cannot be
   * cancelled - it keeps running inside WASM after we stop awaiting it - and writes the same
   * chain-wide keys (the trees, `utxo_indexer`) as the plugin that replaced it, so it can persist an
   * older `synced_block` over a newer one and force the next sync to redo the difference.
   *
   * `poi_provider` is exempt, because for it the trade is inverted: it holds the witnesses for POI
   * proofs not yet submitted, recorded once while building the transaction and rebuildable from
   * nothing. Refusing that write loses the only copy there is, and the notes stay unspendable. A
   * stale POI write cannot do matching damage - a superseded plugin only holds entries the live one
   * either also has or has already submitted.
   *
   * Reads are left alone: they cannot corrupt anything.
   */
  scopedTo(isLive: () => boolean): RailgunHostStorage {
    return {
      _brand: 'Storage' as const,
      get: (key: string) => this.get(key),
      set: async (key: string, value: string) => {
        if (!isLive() && !isPoiStateKey(key)) return

        await this.set(key, value)
      }
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
 * Satisfies the SDK's `Host.keystore`, whose whole contract is "derive a BIP-32 path".
 *
 * Deliberately not the SDK's own `MnemonicKeystore`, which keeps the recovery phrase - that would
 * put the phrase inside an unaudited alpha dependency for the lifetime of the plugin. This goes
 * through `KeystoreController.deriveRailgunKey`, which whitelists Railgun's two paths and never
 * returns the phrase. The cache satisfies the SDK's "same path MUST return the same key" rule and
 * keeps `deriveAt` off the seed's pbkdf2; it is dropped with the instance on lock or seed change.
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

const getChainIdOf = async (provider: JsonRpcProvider) => (await provider.getNetwork()).chainId

const getGasPriceOf = async (provider: JsonRpcProvider) =>
  (await provider.getFeeData()).gasPrice ?? 0n

const toEthereumProviderLog = (log: {
  blockNumber: number
  topics: readonly string[]
  data: string
  address: string
}) => ({
  blockNumber: BigInt(log.blockNumber),
  topics: log.topics as unknown as string[],
  data: log.data,
  address: log.address
})

/**
 * Satisfies @kohaku-eth/plugins' `Host.provider`, needed to build the Host passed to
 * `createRailgunPlugin`. `@kohaku-eth/provider` ships a ready-made version, but its subpath export
 * isn't resolvable under this repo's `moduleResolution: "node"`, and shimming that cascaded into
 * Webpack and service-worker failures - so the small interface is reimplemented over ethers here.
 * Parameter and return types are inferred contextually from `EthereumProvider<T>`.
 */
const toEthereumProvider = (provider: JsonRpcProvider): EthereumProvider<JsonRpcProvider> => ({
  _internal: provider,
  getChainId: () => getChainIdOf(provider),
  getGasPrice: () => getGasPriceOf(provider),
  async getLogs(filter) {
    const logs = await provider.getLogs(filter as any)
    return logs.map(toEthereumProviderLog)
  },
  async getBlockNumber() {
    return BigInt(await provider.getBlockNumber())
  },
  async waitForTransaction(txHash) {
    await provider.waitForTransaction(txHash)
  },
  getBalance: (address) => provider.getBalance(address),
  getCode: (address) => provider.getCode(address),
  async getTransactionReceipt(txHash) {
    const receipt = await provider.getTransactionReceipt(txHash)
    if (!receipt) return null

    return {
      blockNumber: BigInt(receipt.blockNumber),
      status: BigInt(receipt.status ?? 0),
      gasUsed: receipt.gasUsed,
      logs: receipt.logs.map(toEthereumProviderLog)
    }
  },
  request: (req) => provider.send(req.method, (req.params as unknown as any[]) ?? []),
  async call(callParams) {
    // `CallData` names its calldata field `input` while ethers expects `data` - passing the object
    // straight through silently drops the calldata and produces an empty `0x` call, which is what
    // once made the UTXO tree verification hard-revert with `require(false)`.
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
  estimateGas: (callParams) =>
    provider.estimateGas({
      to: callParams.to,
      from: callParams.from,
      data: callParams.input,
      value: callParams.value,
      gasPrice: callParams.gasPrice
    })
})

/**
 * Satisfies @kohaku-eth/railgun's `Eip1193Provider`, needed only by `SimpleSmartAccount` on the
 * disposable-key broadcast path. The SDK's own equivalent isn't exported from the package.
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
   * Symbol, decimals and price per chain, then per lowercased token address.
   *
   * Deliberately outside `#chainStatesByIdentity`: this describes the token contract and its
   * market, so it is identical for every identity, and keying it per identity would re-read it on
   * every switch. In memory only - a persisted price is a stale price.
   */
  #tokensDataByChain: { [chainId: string]: { [address: string]: RailgunTokenData } } = {}

  /**
   * Sync state per identity, then per chain. Keyed by the 0zk address because everything in
   * `RailgunChainState` except the pool flags belongs to an identity rather than to a network - by
   * chain alone, two recovery phrases share one slot and one identity's finished scan makes the
   * other look synced.
   *
   * Kept per identity rather than cleared on every switch, so switching back shows the last known
   * balances instead of re-scanning for them.
   */
  #chainStatesByIdentity: { [railgunAddress: string]: { [chainId: string]: RailgunChainState } } =
    {}

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
   * Serializes everything that reaches into the SDK's WASM objects. Every plugin method takes
   * `&mut self`, so a second concurrent call aborts the module with "recursive use of an object
   * detected" and the promise it was driving never settles.
   *
   * Not hypothetical: enabling Railgun emits an update the moment the plugin exists, which starts
   * the periodic refresh while `#init`'s own first sync is still in flight.
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
   * tell it is no longer the live one - see `RailgunHostStorageAdapter.scopedTo`. Per chain,
   * because that is the granularity at which plugins are replaced.
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

  /**
   * Deliberately not derived from any existing entry: an identity with no entry for this chain must
   * start from nothing, or it would copy whatever the selected identity happens to hold - the
   * cross-identity bleed this whole structure exists to prevent.
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
    return this.chains[chainId] || this.#getDefaultChainState(chainId)
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
   * Writes into a named identity's bucket. Every long operation captures the identity it started
   * for and writes through this, so an abandoned scan - which keeps running inside WASM, since it
   * cannot be cancelled - lands on its own identity instead of on the one now selected.
   *
   * `emit` is off for the teardown paths: they run from `onUpdate` callbacks, where an update has
   * to be forwarded with `propagateUpdate` rather than emitted.
   */
  #writeChainState(
    identityAddress: string | null,
    chainId: string,
    update: Partial<RailgunChainState>,
    { emit }: { emit: boolean } = { emit: true }
  ) {
    if (!identityAddress) return

    const identityChains = this.#chainStatesByIdentity[identityAddress] || {}
    const current = identityChains[chainId] || this.#getDefaultChainState(chainId)

    this.#chainStatesByIdentity = {
      ...this.#chainStatesByIdentity,
      [identityAddress]: { ...identityChains, [chainId]: { ...current, ...update } }
    }

    if (emit) this.emitUpdate()
  }

  /** `#writeChainState` against the identity currently on screen, which is the common case. */
  #updateChainState(chainId: string, update: Partial<RailgunChainState>) {
    this.#writeChainState(this.railgunAddress, chainId, update)
  }

  /**
   * Marks the chains that will wait their turn, and returns the undo. Scans cannot overlap, so
   * everything after the first is genuinely queued and saying so beats a spinner that never moves.
   *
   * The undo is not optional: a run can end without touching every chain it marked (a fresh chain
   * is skipped, an abort breaks out early) and a leftover 'queued' waits forever.
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
    this.#writeChainState(
      this.railgunAddress,
      chainId,
      { syncStatus: 'idle', syncStartedAt: null },
      { emit: false }
    )
  }

  /**
   * Stops awaiting everything in flight and makes any result that still arrives be discarded.
   *
   * The work itself cannot be cancelled - the WASM module is single-threaded and offers no abort -
   * so this is two things at once: stop waiting, which frees the queue for the identity that
   * replaced this one, and refuse the result, which is what `#writeChainState` guarantees by
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
    // presented as the next one's.
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
        this.#writeChainState(
          identityAddress,
          chainId,
          {
            syncStatus: 'idle',
            syncStartedAt: null,
            // A teardown is not a failure of the chain, so a stale error must not survive into the
            // next attempt.
            error: null,
            ...(wipeBalances && { balances: [] })
          },
          { emit: false }
        )
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
   * run on every visit to the screen, which is what puts the address up - and makes it usable to
   * receive - before any scan has been started. Deliberately does NOT build the plugins:
   * `createRailgunPlugin` registers the signer, which for an unseen identity trial-decrypts every
   * commitment in the pool.
   *
   * Finishes by catching up the chains this identity already has state for - seconds of work, and
   * since `chains` is not persisted it is the only thing that puts those balances back on screen
   * after a background restart.
   */
  async initIdentity() {
    // Deliberately NOT queued behind #wasmQueue: that queue exists because two concurrent calls on
    // the same plugin abort the module, and deriving an identity touches no plugin at all. Queueing
    // it would leave a newly selected account with no address for the length of a private operation.
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
   * Brings up every supported chain rather than one the user picked: the 0zk identity is wallet-wide
   * and each chain holds its own pool, so "which network am I on" is not a question the user should
   * have to answer.
   *
   * Sequential, and each chain emits as soon as it lands, so the first chain's balances are on
   * screen while the next is still walking its pool. A failing chain is recorded on its own state
   * and skipped - only an across-the-board failure is reported as one.
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

    const host: RailgunHost = {
      keystore: railgunKeystore,
      storage: this.#pluginStorage.scopedTo(
        () => this.#getChainPluginGeneration(chainId) === pluginGeneration
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

    // Not cheap: `createRailgunPlugin` loads the persisted pool state and calls
    // `provider.register(signer)`, which for an identity this pool has never seen trial-decrypts
    // every existing commitment. The whole cost of a second identity on an already-downloaded chain
    // sits here, not in the sync below.
    const plugin = await createRailgunPlugin(host, {
      keyIndex: RAILGUN_KEY_INDEX,
      // The SDK chains a Subsquid indexer with an RPC syncer for everything above it, but Subsquid
      // reports its head as the last Railgun *transact*, not the last indexed block. On a quiet
      // chain that leaves the RPC syncer a tail of thousands of blocks, which at the SDK's default
      // batch size of 10 is hundreds of sequential round-trips per sync - see
      // RAILGUN_RPC_SYNC_BATCH_SIZE_IN_BLOCKS.
      rpcBatchSize:
        RAILGUN_RPC_SYNC_BATCH_SIZE_IN_BLOCKS[chainId] ??
        DEFAULT_RAILGUN_RPC_SYNC_BATCH_SIZE_IN_BLOCKS
      // POI (Proof of Innocence) is left at the SDK's default (enabled) - the aggregator serves
      // both chains. With it on, `balance()` tags each amount with a PoiStatus and the SDK's note
      // selection only spends 'Valid' ones, which is why balances are kept split per status all the
      // way to the UI: a freshly shielded amount is 'Missing' for Railgun's ~1h standby period and
      // genuinely cannot be moved yet.
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

        this.#writeChainState(
          railgunAddress,
          chainId,
          {
            hasIdentityData: await this.#pluginStorage.hasStateForIdentity(
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
            (await this.#pluginStorage.hasPendingPoi(chainId)) ? chainId : null
          )
        )
      ).filter((chainId): chainId is string => !!chainId)
    )

    // Every exclusion is decided here, before anything is marked as queued - marking first and
    // filtering inside the loop leaves a skipped chain showing "waiting" with nothing left to write
    // it a terminal status.
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
    this.#writeChainState(identityAddress, chainId, {
      syncStatus: 'syncing',
      syncStartedAt: Date.now()
    })

    let hasTimedOut = false
    let wasAborted = false
    try {
      // Soft timeout: the WASM scan keeps running, but giving up on awaiting it is what lets the
      // status - and with it every action - come back. Because it is still running, this chain's
      // plugin is discarded in the finally below: the abandoned Rust object is still mutably
      // borrowed, and touching it again produces "recursive use of an object detected".
      //
      // `balance()` syncs the UTXO tree before answering, so its duration is the chain scan (and,
      // with POI on, the proving) rather than the balance math. It groups amounts per (asset,
      // poiStatus) pair, which is what the spendable/pending split below relies on.
      const balances = await this.#withAbort(
        withTimeout(() => plugin.balance(undefined), {
          timeoutMs: isFirstScanForIdentity
            ? RAILGUN_FIRST_SCAN_TIMEOUT_IN_MS
            : RAILGUN_CATCH_UP_TIMEOUT_IN_MS,
          message: RAILGUN_SYNC_TIMEOUT_MESSAGE
        })
      )
      const { balances: previousBalances, wrappedBaseTokenAddress } = this.#getChainState(chainId)
      const shieldedBalances = balances.filter(isErc20Balance).map((balance) => ({
        tokenAddress: balance.asset.contract,
        amount: balance.amount,
        poiStatus: toRailgunPoiStatus(balance.tag)
      }))

      this.#writeChainState(identityAddress, chainId, {
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
        this.#writeChainState(identityAddress, chainId, {
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
        this.#queueWasmOperation(() =>
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
              const disposableSigner = isNative
                ? this.#createDisposableBroadcastSigner()
                : undefined
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
          })
        ),
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
        this.#queueWasmOperation(() =>
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
          })
        ),
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
