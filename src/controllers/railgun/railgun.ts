import { JsonRpcProvider, Wallet } from 'ethers'

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
  RailgunShieldedBalance,
  RailgunSyncStatus
} from '../../interfaces/railgun'
import { IStorageController } from '../../interfaces/storage'
import { Call } from '../../libs/accountOp/types'
import EventEmitter from '../eventEmitter/eventEmitter'

// MVP targets Sepolia only (unaudited alpha SDK - see AGENTS.md / integration plan).
const RAILGUN_SEPOLIA_CHAIN_ID = '11155111'
const RAILGUN_SEED_LABEL = 'Railgun Privacy Seed'
const RAILGUN_KEY_INDEX = 0

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

  async sync() {
    await this.withStatus('sync', () => this.#sync(), true)
  }

  async #sync() {
    if (!this.#plugin) {
      throw new EmittableError({
        message: 'Railgun is not initialized yet.',
        level: 'minor',
        error: new Error('railgun: sync called before init')
      })
    }

    this.syncStatus = 'syncing'
    this.emitUpdate()

    const balances = await this.#plugin.balance(undefined)
    this.shieldedBalances = balances
      .filter(isErc20Balance)
      .map((b) => ({ tokenAddress: b.asset.contract, amount: b.amount }))

    this.syncStatus = 'ready'
    this.emitUpdate()
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
      const calls: Call[] = txs.map((tx) => ({ to: tx.to, data: tx.data, value: tx.value }))

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

    // TEMP DIAGNOSTIC (revert once the EIP-7702 delegation investigation - see the
    // integration plan - is resolved): when RAILGUN_SEPOLIA_TEST_DISPOSABLE_SIGNER_PRIVATE_KEY
    // is set, reuse that pre-funded (native Sepolia ETH) test key instead of a fresh one, to
    // test whether the disposable signer needs an existing native balance for the EIP-7702
    // delegation step to succeed (as opposed to a zero-balance fresh key). The key lives in
    // an env var (see .env-sample) rather than hardcoded here so a real key is never
    // committed to source, even though it only ever holds testnet funds.
    // Fresh, single-use key - never derived from the wallet's seeds and never persisted.
    const disposableSigner = this.#railgunSepoliaTestDisposableSignerPrivateKey
      ? EthSigner.privateKey(this.#railgunSepoliaTestDisposableSignerPrivateKey as `0x${string}`)
      : EthSigner.privateKey(Wallet.createRandom().privateKey as `0x${string}`)
    const eip1193Provider = new RailgunEip1193ProviderAdapter(provider as JsonRpcProvider)
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

    try {
      await this.#plugin.broadcast(op)
    } finally {
      // Re-sync regardless of outcome: a bundler-side retry can reject (e.g. "Note
      // already spent") even when an earlier attempt for the same op already landed
      // on-chain, so the UI's shielded balance would otherwise stay stale after a
      // "failed" broadcast that actually succeeded.
      await this.#sync()
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

    try {
      const asset: AssetId = isNative
        ? { __type: 'native' }
        : { __type: 'erc20', contract: tokenAddress }
      const op = await this.#plugin.prepareUnshield({ asset, amount }, toAddress)
      await this.#broadcastPrivateOperation(op)
    } catch (error: any) {
      throw new EmittableError({
        message: error?.message || 'Failed to unshield.',
        level: 'major',
        error
      })
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

    try {
      const asset: ERC20AssetId = { __type: 'erc20', contract: tokenAddress }
      const op = await this.#plugin.prepareTransfer(
        { asset, amount },
        toZkAddress as RailgunAddress
      )
      await this.#broadcastPrivateOperation(op)
    } catch (error: any) {
      throw new EmittableError({
        message: error?.message || 'Failed to send privately.',
        level: 'major',
        error
      })
    }
  }

  toJSON() {
    return {
      ...this,
      railgunAddress: this.railgunAddress,
      wrappedBaseTokenAddress: this.wrappedBaseTokenAddress,
      isInitialized: this.isInitialized,
      syncStatus: this.syncStatus,
      shieldedBalances: this.shieldedBalances
    }
  }
}
