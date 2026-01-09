import { IEventEmitterRegistryController, Statuses } from '../../interfaces/eventEmitter'
import { INetworksController, Network } from '../../interfaces/network'
import { IProvidersController, RPCProviders } from '../../interfaces/provider'
import { IStorageController } from '../../interfaces/storage'
/* eslint-disable no-underscore-dangle */
import { getProviderBatchMaxCount } from '../../libs/networks/networks'
import { getRpcProvider } from '../../services/provider'
import EventEmitter from '../eventEmitter/eventEmitter'

const STATUS_WRAPPED_METHODS = {
  toggleBatching: 'INITIAL'
} as const

/**
 * The ProvidersController manages RPC providers, enabling the extension to communicate with the blockchain.
 * Each network requires an initialized JsonRpcProvider, and the provider must be reinitialized whenever network.selectedRpcUrl changes.
 */
export class ProvidersController extends EventEmitter implements IProvidersController {
  #networks: INetworksController

  #storage: IStorageController

  providers: RPCProviders = {}

  // Holds the initial load promise, so that one can wait until it completes
  initialLoadPromise?: Promise<void>

  isBatchingEnabled = true

  statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS> = STATUS_WRAPPED_METHODS

  constructor(
    eventEmitterRegistry: IEventEmitterRegistryController,
    networks: INetworksController,
    storage: IStorageController
  ) {
    super(eventEmitterRegistry)

    this.#networks = networks
    this.#storage = storage
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.initialLoadPromise = this.#load().finally(() => {
      this.initialLoadPromise = undefined
    })
  }

  get isInitialized() {
    return this.#networks.isInitialized && !!Object.keys(this.providers).length
  }

  async #load() {
    await this.#networks.initialLoadPromise

    const storageIsBatchingEnabled = await this.#storage.get(
      'isBatchingEnabled',
      this.isBatchingEnabled
    )

    this.isBatchingEnabled = storageIsBatchingEnabled

    this.#networks.allNetworks.forEach((n) => this.setProvider(n))
    this.emitUpdate()
  }

  setProvider(network: Network, opts?: { forceUpdate: boolean }) {
    const { forceUpdate = false } = opts || {}
    const stringChainId = network.chainId.toString()
    const provider = this.providers[stringChainId]
    const isRpcUrlChanged = provider?._getConnection().url !== network.selectedRpcUrl

    if (!provider || isRpcUrlChanged || forceUpdate) {
      const oldRPC = this.providers[stringChainId]

      // If an RPC fails once it will try to reconnect every second. If we don't destroy the old RPC it will keep trying to reconnect forever.
      try {
        if (oldRPC) oldRPC.destroy()
      } catch (error: any) {
        // Log any errors except the "double destroyed" case (triggered when oldRPC.destroy() is called twice)
        if (error?.message !== 'provider destroyed; cancelled request') {
          // eslint-disable-next-line no-console
          this.emitError({ error, message: error.message, level: 'silent', sendCrashReport: true })
        }
      }

      const batchMaxCount = this.isBatchingEnabled
        ? getProviderBatchMaxCount(network, network.selectedRpcUrl)
        : 1

      this.providers[network.chainId.toString()] = getRpcProvider(
        network.rpcUrls,
        network.chainId,
        network.selectedRpcUrl,
        {
          batchMaxCount,
          // 24KB is deployless' max data size for calls without state override
          batchMaxSize: network.rpcNoStateOverride ? 24576 : undefined
        }
      )
      this.providers[network.chainId.toString()]!.batchMaxCount = batchMaxCount
    }
  }

  updateProviderIsWorking(chainId: bigint, isWorking: boolean) {
    const provider = this.providers[chainId.toString()]
    if (!provider) return
    if (provider.isWorking === isWorking) return

    provider.isWorking = isWorking
    this.emitUpdate()
  }

  removeProvider(chainId: bigint) {
    if (!this.providers[chainId.toString()]) return

    this.providers[chainId.toString()]?.destroy()
    delete this.providers[chainId.toString()]
    this.emitUpdate()
  }

  toggleBatching() {
    return this.withStatus('toggleBatching', async () => {
      this.isBatchingEnabled = !this.isBatchingEnabled
      await this.#storage.set('isBatchingEnabled', this.isBatchingEnabled)

      this.#networks.allNetworks.forEach((n) => this.setProvider(n, { forceUpdate: true }))
      this.emitUpdate()
    })
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      isInitialized: this.isInitialized
    }
  }
}
