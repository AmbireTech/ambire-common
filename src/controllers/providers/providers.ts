/* eslint-disable no-underscore-dangle */
import { Network } from '../../interfaces/network'
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
      this.#networks.networks.forEach((n) => this.#setProvider(n, n.rpcUrls, n.selectedRpcUrl))
    })
  }

  #setProvider(network: Network, newRpcUrls: string[], selectedRpcUrl?: string) {
    const provider = this.providers[network.id]

    // Only update the RPC if the new RPC is different from the current one or if there is no RPC for this network yet.
    if (!provider || provider?._getConnection().url !== selectedRpcUrl) {
      const oldRPC = this.providers[network.id]

      // If an RPC fails once it will try to reconnect every second. If we don't destroy the old RPC it will keep trying to reconnect forever.
      if (oldRPC) oldRPC.destroy()

      this.providers[network.id] = getRpcProvider(newRpcUrls, network.chainId, selectedRpcUrl)
      this.emitUpdate()
    }
  }
}
