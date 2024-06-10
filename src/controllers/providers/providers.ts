/* eslint-disable no-underscore-dangle */
import { Network, NetworkId } from '../../interfaces/network'
import { RPCProviders } from '../../interfaces/provider'
import { getRpcProvider } from '../../services/provider'
import EventEmitter from '../eventEmitter/eventEmitter'
import { NetworksController } from '../networks/networks'

export class ProvidersController extends EventEmitter {
  #networks: NetworksController

  providers: RPCProviders = {}

  constructor(networks: NetworksController) {
    super()

    this.#networks = networks
    this.#networks.onUpdate(() => {
      if (!this.#networks.isInitialized) return
      this.#networks.networks.forEach((n) => this.#setProvider(n))
    })
  }

  #setProvider(network: Network) {
    const provider = this.providers[network.id]

    // Only update the RPC if the new RPC is different from the current one or if there is no RPC for this network yet.
    if (!provider || provider?._getConnection().url !== network.selectedRpcUrl) {
      const oldRPC = this.providers[network.id]

      // If an RPC fails once it will try to reconnect every second. If we don't destroy the old RPC it will keep trying to reconnect forever.
      if (oldRPC) oldRPC.destroy()

      this.providers[network.id] = getRpcProvider(
        network.rpcUrls,
        network.chainId,
        network.selectedRpcUrl
      )
      this.emitUpdate()
    }
  }

  updateProviderIsWorking(networkId: NetworkId, isWorking: boolean) {
    if (!this.providers[networkId]) return

    this.providers[networkId].isWorking = isWorking
    this.emitUpdate()
  }

  removeProvider(networkId: NetworkId) {
    if (!this.providers[networkId]) return

    this.providers[networkId]?.destroy()
    delete this.providers[networkId]
    this.emitUpdate()
  }
}
