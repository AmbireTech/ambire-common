/* eslint-disable no-underscore-dangle */
import { INetworksController, Network } from '../../interfaces/network'
import { IProvidersController, RPCProviders } from '../../interfaces/provider'
import { getRpcProvider } from '../../services/provider'
import EventEmitter from '../eventEmitter/eventEmitter'

/**
 * The ProvidersController manages RPC providers, enabling the extension to communicate with the blockchain.
 * Each network requires an initialized JsonRpcProvider, and the provider must be reinitialized whenever network.selectedRpcUrl changes.
 */
export class ProvidersController extends EventEmitter implements IProvidersController {
  #networks: INetworksController

  providers: RPCProviders = {}

  // Holds the initial load promise, so that one can wait until it completes
  initialLoadPromise?: Promise<void>

  constructor(networks: INetworksController) {
    super()

    this.#networks = networks
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
    this.#networks.allNetworks.forEach((n) => this.setProvider(n))
    this.emitUpdate()
  }

  setProvider(network: Network) {
    const stringChainId = network.chainId.toString()
    const provider = this.providers[stringChainId]
    const isRpcUrlChanged = provider?._getConnection().url !== network.selectedRpcUrl

    if (!provider || isRpcUrlChanged) {
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

      const batchMaxCount = ProvidersController.getProviderBatchMaxCount(network)

      this.providers[network.chainId.toString()] = getRpcProvider(
        network.rpcUrls,
        network.chainId,
        network.selectedRpcUrl,
        batchMaxCount
          ? {
              batchMaxCount: ProvidersController.getProviderBatchMaxCount(network)
            }
          : undefined
      )
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

  static getProviderBatchMaxCount(network: Network): number | undefined {
    const rpcUrl = network.selectedRpcUrl || network.rpcUrls[0]

    if (!rpcUrl) return undefined

    // No limit for invictus. Maybe we should set some higher limit in the future (like 20)
    if (rpcUrl.includes('invictus.ambire.com')) return undefined

    // 10 for non-invictus RPCs that are coming from the relayer, no batching for the rest
    return network.predefinedConfigVersion ? 10 : 1
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      isInitialized: this.isInitialized
    }
  }
}
