import { JsonRpcProvider } from 'ethers'

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
import { createRailgunPlugin, ensureInitialized } from '@kohaku-eth/railgun'
import type { AssetAmount, ERC20AssetId } from '@kohaku-eth/plugins'
import type { RailgunPlugin } from '@kohaku-eth/railgun'

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

export class RailgunController extends EventEmitter implements IRailgunController {
  #keystore: IKeystoreController

  #providers: IProvidersController

  #storage: IStorageController

  #fetch: Fetch

  #loadWasm: () => Promise<Response | BufferSource>

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
    eventEmitterRegistry?: IEventEmitterRegistryController
  }) {
    super(eventEmitterRegistry)
    this.#keystore = keystore
    this.#providers = providers
    this.#storage = storage
    this.#fetch = fetch
    this.#loadWasm = loadWasm
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
