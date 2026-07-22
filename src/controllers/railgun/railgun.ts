import { JsonRpcProvider, Wallet } from 'ethers'

// Side-effect import: pulls the local ambient shim (see the file itself for why it's
// needed) into every tsconfig's program graph, including ones that exclude
// src/ambire-common/** from root file discovery and would otherwise never see it.
import './kohaku-provider-ethers'

import {
  Host as RailgunHost,
  MnemonicKeystore,
  Storage as RailgunHostStorage
} from '@kohaku-eth/plugins'
import { ethers as toEthereumProvider } from '@kohaku-eth/provider/ethers'
import {
  Bundler,
  createRailgunPlugin,
  ensureInitialized,
  Signer as EthSigner,
  SimpleSmartAccount
} from '@kohaku-eth/railgun'
import type { AssetAmount, AssetId, ERC20AssetId } from '@kohaku-eth/plugins'
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
  sync: 'INITIAL'
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

  #plugin: RailgunPlugin | null = null

  railgunAddress: string | null = null

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
      poi: true,
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
   * NOTE: the exact Pimlico Sepolia bundler URL format and the EIP-7702
   * `SimpleSmartAccount` delegation mechanics are unverified until tested against a real
   * bundler (flagged as an open item in the integration plan).
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

    // Fresh, single-use key - never derived from the wallet's seeds and never persisted.
    const disposableWallet = Wallet.createRandom()
    const disposableSigner = EthSigner.privateKey(disposableWallet.privateKey as `0x${string}`)
    const eip1193Provider = new RailgunEip1193ProviderAdapter(provider as JsonRpcProvider)
    const smartAccount = new SimpleSmartAccount(
      disposableSigner.address,
      BigInt(RAILGUN_SEPOLIA_CHAIN_ID),
      eip1193Provider
    )
    const bundler = Bundler.pimlico(
      `https://api.pimlico.io/v2/sepolia/rpc?apikey=${this.#pimlicoApiKey}`
    )

    this.#plugin.setBundler(bundler)
    this.#plugin.setSmartAccount(smartAccount, disposableSigner)

    await this.#plugin.broadcast(op)

    await this.#sync()
  }

  async buildAndBroadcastUnshield(
    {
      tokenAddress,
      isNative,
      amount,
      toAddress
    }: {
      tokenAddress: `0x${string}`
      isNative: boolean
      amount: bigint
      toAddress: `0x${string}`
    },
    requestId: string
  ) {
    if (!this.#plugin) {
      this.#sendUiMessage({ requestId, ok: false, error: 'Railgun is not initialized yet.' })
      return
    }

    try {
      const asset: AssetId = isNative
        ? { __type: 'native' }
        : { __type: 'erc20', contract: tokenAddress }
      const op = await this.#plugin.prepareUnshield({ asset, amount }, toAddress)
      await this.#broadcastPrivateOperation(op)

      this.#sendUiMessage({ requestId, ok: true, res: undefined })
    } catch (error: any) {
      this.emitError({
        error,
        message: error?.message || 'Failed to unshield.',
        level: 'major'
      })
      this.#sendUiMessage({ requestId, ok: false, error: error?.message })
    }
  }

  async buildAndBroadcastTransfer(
    {
      tokenAddress,
      amount,
      toZkAddress
    }: {
      tokenAddress: `0x${string}`
      amount: bigint
      toZkAddress: string
    },
    requestId: string
  ) {
    if (!this.#plugin) {
      this.#sendUiMessage({ requestId, ok: false, error: 'Railgun is not initialized yet.' })
      return
    }

    try {
      const asset: ERC20AssetId = { __type: 'erc20', contract: tokenAddress }
      const op = await this.#plugin.prepareTransfer(
        { asset, amount },
        toZkAddress as RailgunAddress
      )
      await this.#broadcastPrivateOperation(op)

      this.#sendUiMessage({ requestId, ok: true, res: undefined })
    } catch (error: any) {
      this.emitError({
        error,
        message: error?.message || 'Failed to send privately.',
        level: 'major'
      })
      this.#sendUiMessage({ requestId, ok: false, error: error?.message })
    }
  }

  toJSON() {
    return {
      ...this,
      railgunAddress: this.railgunAddress,
      isInitialized: this.isInitialized,
      syncStatus: this.syncStatus,
      shieldedBalances: this.shieldedBalances
    }
  }
}
