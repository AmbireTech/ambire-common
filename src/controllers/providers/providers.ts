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
    const provider = this.providers[network.chainId.toString()]

    // Only update the RPC if the new RPC is different from the current one or if there is no RPC for this network yet.
    if (!provider || provider?._getConnection().url !== network.selectedRpcUrl) {
      const oldRPC = this.providers[network.chainId.toString()]

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

      this.providers[network.chainId.toString()] = getRpcProvider(
        network.rpcUrls,
        network.chainId,
        network.selectedRpcUrl
      )
    }
  }

  updateProviderIsWorking(chainId: bigint, isWorking: boolean) {
    if (!this.providers[chainId.toString()]) return
    if (this.providers[chainId.toString()].isWorking === isWorking) return

    this.providers[chainId.toString()].isWorking = isWorking
    this.emitUpdate()
  }

  removeProvider(chainId: bigint) {
    if (!this.providers[chainId.toString()]) return

    this.providers[chainId.toString()]?.destroy()
    delete this.providers[chainId.toString()]
    this.emitUpdate()
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      isInitialized: this.isInitialized
    }
  }
}
