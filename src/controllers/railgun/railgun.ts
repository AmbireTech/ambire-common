import { Interface, JsonRpcProvider, Wallet } from 'ethers'

import {
  Host as RailgunHost,
  MnemonicKeystore,
  Storage as RailgunHostStorage
} from '@kohaku-eth/plugins'
import {
  Bundler,
  chainConfigSepolia,
  createRailgunPlugin,
  ensureInitialized,
  Signer as EthSigner,
  SimpleSmartAccount
} from '@kohaku-eth/railgun'
import type { AssetAmount, AssetId, ERC20AssetId } from '@kohaku-eth/plugins'
import type { EthereumProvider } from '@kohaku-eth/provider'
import type { Eip1193Provider, RailgunAddress, RailgunPlugin, RawLog } from '@kohaku-eth/railgun'

import EmittableError from '../../classes/EmittableError'
import { IEventEmitterRegistryController, Statuses } from '../../interfaces/eventEmitter'
import { Fetch } from '../../interfaces/fetch'
import { IKeystoreController } from '../../interfaces/keystore'
import { IProvidersController } from '../../interfaces/provider'
import {
  IRailgunController,
  RailgunActivityEntry,
  RailgunActivityStatus,
  RailgunShieldedBalance,
  RailgunSyncStatus
} from '../../interfaces/railgun'
import { IStorageController } from '../../interfaces/storage'
import { Call } from '../../libs/accountOp/types'
import { withTimeout } from '../../utils/with-timeout'
import EventEmitter from '../eventEmitter/eventEmitter'

// MVP targets Sepolia only (unaudited alpha SDK - see AGENTS.md / integration plan).
const RAILGUN_SEPOLIA_CHAIN_ID = '11155111'
const RAILGUN_SEED_LABEL = 'Railgun Privacy Seed'
const RAILGUN_KEY_INDEX = 0
// Blocks per `eth_getLogs` for the SDK's RPC-based UTXO syncer (SDK default is 10 - see the
// rationale at the `createRailgunPlugin` call site).
const RAILGUN_RPC_SYNC_BATCH_SIZE_IN_BLOCKS = 10_000
// Keeps the persisted activity log bounded - it exists to show the user their recent Railgun
// operations, not to be a complete audit trail.
const MAX_ACTIVITY_ENTRIES = 20
// A shielded balance sync scans the chain, so it is legitimately slow (see the rpcBatchSize
// note), but it must never be able to hang forever: `withStatus` refuses to start any action
// while another one is LOADING, so one wedged sync locks the user out of the whole screen -
// including the refresh button that would recover it.
const RAILGUN_SYNC_TIMEOUT_IN_MS = 3 * 60 * 1000

/**
 * The Privacy Paymaster fronts the gas for a private operation (which is why the disposable
 * broadcasting key needs no ETH), but it gets reimbursed inside the pool: `prepareUserOp` adds a
 * fee note transfer sized by iterating gas estimates. That note can only be denominated in the
 * wrapped base token - both the plugin (which passes `chain.wrappedBaseToken` as the fee token)
 * and the WASM ("Currently only the wrapped base token is supported for fee payment") enforce it.
 *
 * So both of these mean the same thing to the user: there isn't enough shielded WETH to pay the
 * relay fee. The first is raised when no workable set of notes exists at all, the second when the
 * estimate won't settle (some WETH, but not enough of it).
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
    return 'Could not pay the relay fee for this operation. It is always taken from your shielded WETH (never the token you are sending), so shield some ETH - or keep some out of the amount - and try again.'
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
 * Ambire's StorageController is a fixed-schema key store, not the arbitrary key-value
 * store the Railgun SDK's Host.storage expects, so writes are folded into a single flat
 * `railgunPluginStorage` blob. Writes are queued (never fired in parallel) to avoid
 * read-modify-write races and to respect the "never call storage.set in parallel" rule.
 */
class RailgunHostStorageAdapter implements RailgunHostStorage {
  readonly _brand = 'Storage' as const

  #storage: IStorageController

  #writeQueue: Promise<void> = Promise.resolve()

  constructor(storage: IStorageController) {
    this.#storage = storage
  }

  async get(key: string): Promise<string | null> {
    const blob = await this.#storage.get('railgunPluginStorage', {})
    return blob[key] ?? null
  }

  set(key: string, value: string): Promise<void> {
    this.#writeQueue = this.#writeQueue.then(async () => {
      const blob = await this.#storage.get('railgunPluginStorage', {})
      await this.#storage.set('railgunPluginStorage', { ...blob, [key]: value })
    })

    return this.#writeQueue
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

  #providers: IProvidersController

  #storage: IStorageController

  #fetch: Fetch

  #loadWasm: () => Promise<Response | BufferSource>

  #sendUiMessage: (params: object) => void

  #pimlicoApiKey?: string

  #railgunSepoliaTestDisposableSignerPrivateKey?: string

  #plugin: RailgunPlugin | null = null

  railgunAddress: string | null = null

  // The chain's wrapped native token (WETH on Sepolia) - exposed so the UI can label the
  // corresponding shielded balance/native shield-unshield flows correctly without
  // hardcoding a possibly-stale address. `chainConfigSepolia()` touches the WASM-backed
  // package, so it can only be called after `ensureInitialized()` - populated in `#init()`,
  // not here (a class field initializer runs synchronously at construction time, in
  // MainController's constructor, long before any WASM instantiation has happened).
  wrappedBaseTokenAddress: `0x${string}` | null = null

  isInitialized = false

  syncStatus: RailgunSyncStatus = 'idle'

  shieldedBalances: RailgunShieldedBalance[] = []

  // Lets the UI tell "never synced" (show placeholders) apart from "syncing again" (keep what
  // is on screen), so a refresh doesn't swap content in and out.
  lastSyncedAt: number | null = null

  activity: RailgunActivityEntry[] = []

  // Private operations (prove + broadcast) and syncing both drive the same WASM provider, and
  // it isn't reentrant - running them at once risks wedging it with no way back. Not public
  // state: the UI already tracks the same thing through `statuses`.
  #isBroadcastingPrivateOperation = false

  statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS> = STATUS_WRAPPED_METHODS

  constructor({
    keystore,
    providers,
    storage,
    fetch,
    loadWasm,
    sendUiMessage,
    pimlicoApiKey,
    railgunSepoliaTestDisposableSignerPrivateKey,
    eventEmitterRegistry
  }: {
    keystore: IKeystoreController
    providers: IProvidersController
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
    // TEMP DIAGNOSTIC (revert once the EIP-7702 delegation investigation - see the
    // integration plan - is resolved): private key of a disposable, Sepolia-only test EOA
    // pre-funded with native Sepolia ETH. Injected via env var (RAILGUN_SEPOLIA_TEST_
    // DISPOSABLE_SIGNER_PRIVATE_KEY, see .env-sample for the full rationale) instead of
    // being hardcoded here, so a real key is never committed to source. Optional - when
    // absent, `#broadcastPrivateOperation` falls back to a fresh, single-use
    // `Wallet.createRandom()` signer, which is the real intended behavior.
    railgunSepoliaTestDisposableSignerPrivateKey?: string
    eventEmitterRegistry?: IEventEmitterRegistryController
  }) {
    super(eventEmitterRegistry)
    this.#keystore = keystore
    this.#providers = providers
    this.#storage = storage
    this.#fetch = fetch
    this.#loadWasm = loadWasm
    this.#sendUiMessage = sendUiMessage
    this.#pimlicoApiKey = pimlicoApiKey
    this.#railgunSepoliaTestDisposableSignerPrivateKey =
      railgunSepoliaTestDisposableSignerPrivateKey
  }

  async init() {
    await this.withStatus('init', () => this.#init(), true)
  }

  async #init() {
    if (this.isInitialized) return

    if (!this.#keystore.isUnlocked) {
      this.syncStatus = 'unlock-required'
      this.emitUpdate()
      throw new EmittableError({
        message: 'Please unlock your wallet before enabling Railgun privacy features.',
        level: 'expected',
        error: new Error('railgun: keystore is locked')
      })
    }

    this.syncStatus = 'initializing'
    this.emitUpdate()

    const provider = this.#providers.providers[RAILGUN_SEPOLIA_CHAIN_ID]
    if (!provider) {
      throw new EmittableError({
        message: 'The Sepolia RPC provider is not available. Railgun (testnet) requires it.',
        level: 'major',
        error: new Error('railgun: missing Sepolia provider')
      })
    }

    const mnemonic = await this.#getOrCreateRailgunSeedMnemonic()

    await ensureInitialized(await this.#loadWasm())

    this.wrappedBaseTokenAddress = chainConfigSepolia().wrappedBaseToken
    this.activity = await this.#storage.get('railgunActivity', [])

    const host: RailgunHost = {
      keystore: new MnemonicKeystore(mnemonic),
      storage: new RailgunHostStorageAdapter(this.#storage),
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
      // Railgun *transact* on the chain, NOT the indexer's head - and Railgun transacts on
      // Sepolia are sparse (hours to days apart). So the RPC syncer is always handed a tail of
      // thousands of blocks that grows by ~7.2k blocks/day of testnet inactivity. At the SDK's
      // default batch size of 10 that is one `eth_getLogs` per 10 blocks, i.e. hundreds of
      // sequential round-trips per sync - which is why `sync()` never finished and the UI sat on
      // "Syncing shielded balances..." indefinitely. Railgun's Sepolia contract emits only a
      // few thousand logs in total, so a wide window stays far below Alchemy's response cap.
      rpcBatchSize: RAILGUN_RPC_SYNC_BATCH_SIZE_IN_BLOCKS,
      // Freshly shielded funds sit in a pending-POI state and are excluded from balance()
      // until validated by the POI aggregator - which does not serve Sepolia, so testnet
      // shields would never appear if POI stayed enabled. Disabled for this reason (not a
      // workaround for the tree-verification revert below, which turned out to be a
      // separate bug in this file's own provider adapter - see `toEthereumProvider.call`).
      poi: false,
      logLevel: 'Off'
    })

    this.#plugin = plugin
    this.railgunAddress = await plugin.instanceId()
    this.isInitialized = true
    this.syncStatus = 'ready'
    this.emitUpdate()
  }

  async #getOrCreateRailgunSeedMnemonic(): Promise<string> {
    const existingId = await this.#storage.get('railgunSeedId', null)

    if (existingId && this.#keystore.seeds.some((s) => s.id === existingId)) {
      const savedSeed = await this.#keystore.getSavedSeed(existingId)
      return savedSeed.seed
    }

    // No dedicated seed yet, or it was removed from the keystore (e.g. wallet reset) -
    // generate a fresh one. This is a wallet-global Railgun identity, separate from the
    // wallet's recovery seed(s) on purpose (see integration plan).
    await this.#keystore.generateTempSeed({})
    const persistedSeed = await this.#keystore.persistTempSeed()
    if (!persistedSeed) {
      throw new EmittableError({
        message: 'Could not create the Railgun privacy seed. Please try again.',
        level: 'major',
        error: new Error('railgun: persistTempSeed returned no seed')
      })
    }

    await this.#keystore.updateSeed({ id: persistedSeed.id, label: RAILGUN_SEED_LABEL })
    await this.#storage.set('railgunSeedId', persistedSeed.id)

    const savedSeed = await this.#keystore.getSavedSeed(persistedSeed.id)
    return savedSeed.seed
  }

  #addActivityEntry(
    entry: Omit<RailgunActivityEntry, 'id' | 'status' | 'createdAt'> & {
      status?: RailgunActivityStatus
    }
  ) {
    const createdAt = Date.now()
    // Unique without a uuid dependency: two entries can't be created for the same asset in the
    // same millisecond, since every op goes through one awaited call per action.
    const id = `${entry.type}-${entry.tokenAddress}-${createdAt}`

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
   * for the Sepolia MVP; a real implementation would match the shield's txn id.
   */
  #resolvePendingShields(previousBalances: RailgunShieldedBalance[]) {
    const getPoolAmount = (balances: RailgunShieldedBalance[], tokenAddress: string) =>
      balances.find((balance) => balance.tokenAddress.toLowerCase() === tokenAddress.toLowerCase())
        ?.amount || 0n

    const hasGrown = (entry: RailgunActivityEntry) => {
      // Native shields land in the pool as the wrapped base token
      const poolTokenAddress = entry.isNative ? this.wrappedBaseTokenAddress : entry.tokenAddress
      if (!poolTokenAddress) return false

      return (
        getPoolAmount(this.shieldedBalances, poolTokenAddress) >
        getPoolAmount(previousBalances, poolTokenAddress)
      )
    }

    const resolvedActivity = this.activity.map((entry) =>
      entry.type === 'shield' && entry.status === 'pending' && hasGrown(entry)
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

  async sync() {
    // A private operation in flight already re-syncs when it settles, so syncing alongside it
    // would be both redundant and a way to wedge the (non-reentrant) WASM provider.
    if (this.#isBroadcastingPrivateOperation) {
      this.debugLog('sync', 'skipped - a private operation is in flight')
      return
    }

    await this.withStatus('sync', () => this.#sync(), true)
  }

  async #sync() {
    const plugin = this.#plugin
    if (!plugin) {
      throw new EmittableError({
        message: 'Railgun is not initialized yet.',
        level: 'minor',
        error: new Error('railgun: sync called before init')
      })
    }

    this.syncStatus = 'syncing'
    this.emitUpdate()

    // `balance()` syncs the UTXO tree before answering, so its duration is dominated by the
    // chain scan, not the balance math. Timed because a slow scan is indistinguishable from a
    // hang in the UI (both just leave the sync status LOADING) - see the rpcBatchSize note.
    const syncStartedAt = Date.now()
    try {
      // Soft timeout: the WASM scan keeps running in the background (withTimeout can't cancel
      // it), but giving up on awaiting it is what lets the status - and with it the refresh
      // button and every other action - come back.
      const balances = await withTimeout(() => plugin.balance(undefined), {
        timeoutMs: RAILGUN_SYNC_TIMEOUT_IN_MS,
        message: 'Syncing your shielded balances took too long. Please try again.'
      })
      this.debugLog('sync', 'shielded balance sync completed', {
        durationMs: Date.now() - syncStartedAt,
        balancesCount: balances.length
      })

      const previousBalances = this.shieldedBalances
      this.shieldedBalances = balances
        .filter(isErc20Balance)
        .map((b) => ({ tokenAddress: b.asset.contract, amount: b.amount }))

      this.#resolvePendingShields(previousBalances)

      this.lastSyncedAt = Date.now()
    } finally {
      // Always leave a terminal status. 'ready' here means "not syncing any more", not "the sync
      // worked" - a failure is reported through emitError and `statuses.sync`. Without this a
      // failed or timed-out scan left `syncStatus` on 'syncing' forever, with nothing to reset it.
      this.syncStatus = 'ready'
      this.emitUpdate()
    }
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
      tokenAddress,
      isNative,
      amount
    }: { tokenAddress: `0x${string}`; isNative: boolean; amount: bigint },
    requestId: string
  ) {
    if (!this.#plugin) {
      this.#sendUiMessage({
        requestId,
        ok: false,
        error: 'Railgun is not initialized yet.'
      })
      return
    }

    try {
      const asset: AssetId = isNative
        ? { __type: 'native' }
        : { __type: 'erc20', contract: tokenAddress }
      const txs = await this.#plugin.prepareShieldMulti([{ asset, amount }])
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
      this.#addActivityEntry({ type: 'shield', tokenAddress, isNative, amount, recipient: null })

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
   * see the integration plan for why this differs from Shield's self-broadcast path.
   *
   * Pimlico URL uses the numeric chain id in the path (`/v2/11155111/rpc`), confirmed
   * against a working reference integration - an earlier guess using `/v2/sepolia/rpc`
   * was unverified and wrong. EIP-7702 `SimpleSmartAccount` delegation mechanics for a
   * brand-new (never-delegated) disposable account are still being verified against a
   * real bundler - see the integration plan for the current status of that investigation.
   */
  async #broadcastPrivateOperation(op: Parameters<RailgunPlugin['broadcast']>[0]) {
    if (!this.#plugin) {
      throw new EmittableError({
        message: 'Railgun is not initialized yet.',
        level: 'minor',
        error: new Error('railgun: broadcast called before init')
      })
    }

    if (!this.#pimlicoApiKey) {
      throw new EmittableError({
        message: 'Private sends are not available - no bundler is configured for this build.',
        level: 'major',
        error: new Error('railgun: missing Pimlico API key')
      })
    }

    const provider = this.#providers.providers[RAILGUN_SEPOLIA_CHAIN_ID]
    if (!provider) {
      throw new EmittableError({
        message: 'The Sepolia RPC provider is not available.',
        level: 'major',
        error: new Error('railgun: missing Sepolia provider')
      })
    }

    // TEMP DIAGNOSTIC (Railgun Sepolia MVP - see the integration plan). We are testing the
    // "traditional" Pimlico 4337 path (the option the Kohaku team recommends): the disposable
    // EOA is expected to be upgraded to a smart account via EIP-7702 *on the fly* inside the
    // UserOp, so a fresh, zero-balance, never-delegated key should broadcast with no
    // pre-funding. Setting RAILGUN_SEPOLIA_TEST_DISPOSABLE_SIGNER_PRIVATE_KEY instead reuses a
    // pre-funded (native Sepolia ETH) test key, to A/B whether an existing native balance is
    // what actually makes the delegation step succeed. The key lives in an env var (see
    // .env-sample) rather than hardcoded here so a real key is never committed to source, even
    // though it only ever holds testnet funds.
    // Fresh, single-use key - never derived from the wallet's seeds and never persisted.
    const usedPrefundedTestKey = !!this.#railgunSepoliaTestDisposableSignerPrivateKey
    const disposableSigner = usedPrefundedTestKey
      ? EthSigner.privateKey(this.#railgunSepoliaTestDisposableSignerPrivateKey as `0x${string}`)
      : EthSigner.privateKey(Wallet.createRandom().privateKey as `0x${string}`)
    const ethersProvider = provider as JsonRpcProvider
    const eip1193Provider = new RailgunEip1193ProviderAdapter(ethersProvider)
    const smartAccount = new SimpleSmartAccount(
      disposableSigner.address,
      BigInt(RAILGUN_SEPOLIA_CHAIN_ID),
      eip1193Provider
    )
    const bundler = Bundler.pimlico(
      `https://api.pimlico.io/v2/${RAILGUN_SEPOLIA_CHAIN_ID}/rpc?apikey=${this.#pimlicoApiKey}`
    )

    this.#plugin.setBundler(bundler)
    this.#plugin.setSmartAccount(smartAccount, disposableSigner)

    // Snapshot the disposable EOA's on-chain state right before broadcasting so a failure tells
    // us whether a zero-balance, never-delegated (code === '0x') fresh key is the real blocker
    // for the on-the-fly EIP-7702 delegation. Gated behind the RailgunController debug toggle
    // and wrapped so a diagnostic RPC hiccup can never abort the broadcast itself.
    if (this.isDebugLogEnabled) {
      try {
        const [nativeBalanceWei, code] = await Promise.all([
          ethersProvider.getBalance(disposableSigner.address),
          ethersProvider.getCode(disposableSigner.address)
        ])
        this.debugLog('broadcast', 'disposable signer pre-broadcast state', {
          address: disposableSigner.address,
          usedPrefundedTestKey,
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

    // TEMP DIAGNOSTIC: tap the raw bundler JSON-RPC traffic so we can see the actual UserOp on
    // the wire (does it carry the privacy paymaster and/or an eip7702Auth?) and the bundler's
    // raw error response (richer than the WASM-wrapped "-32521 reverted 0x"). The Kohaku bundler
    // talks to Pimlico via the GLOBAL fetch - confirmed in the SDK's wasm-bindgen shim, which
    // calls `fetch(request)` rather than the host fetch - so we wrap globalThis.fetch for the
    // duration of this broadcast only. Only wrapped when the RailgunController debug toggle is
    // on (zero overhead otherwise), and always restored in the finally below.
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
      // `typeof fetch` overload set is not worth it for a temp diagnostic.
      globalThis.fetch = tappedFetch as typeof globalThis.fetch
    }

    try {
      await this.#plugin.broadcast(op)
      this.debugLog('broadcast', 'broadcast succeeded', {
        usedPrefundedTestKey,
        disposableSignerAddress: disposableSigner.address
      })
    } catch (broadcastError) {
      // Log the full error (bundler AA codes, revert reasons and nested `cause`/`details`
      // usually live here) before it is re-thrown to the withStatus wrapper, which only
      // surfaces `.message` to the UI. Enable the RailgunController debug toggle to see it,
      // since debugLog is a no-op otherwise.
      this.debugLog('broadcast', 'broadcast failed', {
        usedPrefundedTestKey,
        disposableSignerAddress: disposableSigner.address,
        broadcastError
      })
      throw broadcastError
    } finally {
      // Restore the original fetch before anything else, even if the broadcast threw.
      if (originalFetch) globalThis.fetch = originalFetch
      // Re-sync regardless of outcome: a bundler-side retry can reject (e.g. "Note
      // already spent") even when an earlier attempt for the same op already landed
      // on-chain, so the UI's shielded balance would otherwise stay stale after a
      // "failed" broadcast that actually succeeded.
      // Its failure is caught here on purpose: a throw from a finally block replaces the
      // exception on its way out, so a failed re-sync would otherwise hide the broadcast error
      // that the user actually needs to see.
      try {
        await this.#sync()
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
    tokenAddress: `0x${string}`
    isNative: boolean
    amount: bigint
    toAddress: `0x${string}`
  }) {
    await this.withStatus(
      'buildAndBroadcastUnshield',
      () => this.#buildAndBroadcastUnshield(params),
      true
    )
  }

  async #buildAndBroadcastUnshield({
    tokenAddress,
    isNative,
    amount,
    toAddress
  }: {
    tokenAddress: `0x${string}`
    isNative: boolean
    amount: bigint
    toAddress: `0x${string}`
  }) {
    if (!this.#plugin) {
      throw new EmittableError({
        message: 'Railgun is not initialized yet.',
        level: 'minor',
        error: new Error('railgun: unshield called before init')
      })
    }

    const activityId = this.#addActivityEntry({
      type: 'unshield',
      tokenAddress,
      isNative,
      amount,
      recipient: toAddress
    })

    // Held across proving too, not just the broadcast: `prepareUnshield` drains notes through
    // the same WASM provider a concurrent sync would use.
    this.#isBroadcastingPrivateOperation = true
    try {
      const asset: AssetId = isNative
        ? { __type: 'native' }
        : { __type: 'erc20', contract: tokenAddress }
      const op = await this.#plugin.prepareUnshield({ asset, amount }, toAddress)
      await this.#broadcastPrivateOperation(op)

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
    tokenAddress: `0x${string}`
    amount: bigint
    toZkAddress: string
  }) {
    await this.withStatus(
      'buildAndBroadcastTransfer',
      () => this.#buildAndBroadcastTransfer(params),
      true
    )
  }

  async #buildAndBroadcastTransfer({
    tokenAddress,
    amount,
    toZkAddress
  }: {
    tokenAddress: `0x${string}`
    amount: bigint
    toZkAddress: string
  }) {
    if (!this.#plugin) {
      throw new EmittableError({
        message: 'Railgun is not initialized yet.',
        level: 'minor',
        error: new Error('railgun: transfer called before init')
      })
    }

    const activityId = this.#addActivityEntry({
      type: 'transfer',
      tokenAddress,
      // Private transfers never involve the native asset - the pool holds none
      isNative: false,
      amount,
      recipient: toZkAddress
    })

    // See the note in #buildAndBroadcastUnshield - proving uses the same WASM provider
    this.#isBroadcastingPrivateOperation = true
    try {
      const asset: ERC20AssetId = { __type: 'erc20', contract: tokenAddress }
      const op = await this.#plugin.prepareTransfer(
        { asset, amount },
        toZkAddress as RailgunAddress
      )
      await this.#broadcastPrivateOperation(op)

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
      railgunAddress: this.railgunAddress,
      wrappedBaseTokenAddress: this.wrappedBaseTokenAddress,
      isInitialized: this.isInitialized,
      syncStatus: this.syncStatus,
      shieldedBalances: this.shieldedBalances,
      lastSyncedAt: this.lastSyncedAt,
      activity: this.activity
    }
  }
}
