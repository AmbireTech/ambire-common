import { networks as predefinedNetworks } from '../../consts/networks'
import {
  AddNetworkRequestParams,
  Network,
  NetworkId,
  NetworkInfo,
  NetworkInfoLoading
} from '../../interfaces/network'
import { Storage } from '../../interfaces/storage'
import { getFeaturesByNetworkProperties } from '../../libs/networks/networks'
import EventEmitter, { Statuses } from '../eventEmitter/eventEmitter'

const STATUS_WRAPPED_METHODS = {
  addNetwork: 'INITIAL',
  updateNetwork: 'INITIAL'
} as const

export class NetworksController extends EventEmitter {
  #storage: Storage

  #networks: { [key: NetworkId]: Network }

  statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS> = STATUS_WRAPPED_METHODS

  networkToAddOrUpdate: {
    chainId: Network['chainId']
    rpcUrl: string
    info?: NetworkInfoLoading<NetworkInfo>
  } | null = null

  constructor(storage: Storage) {
    super()
    this.#storage = storage
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.#load()
  }

  get isInitialized(): boolean {
    return !!this.#networks
  }

  get networks(): Network[] {
    if (!this.#networks) return predefinedNetworks

    const uniqueNetworksByChainId = Object.values(this.#networks).filter(
      (item, index, self) => self.findIndex((i) => i.chainId === item.chainId) === index
    )
    return uniqueNetworksByChainId.map((network) => {
      // eslint-disable-next-line no-param-reassign
      network.features = getFeaturesByNetworkProperties({
        isSAEnabled: network.isSAEnabled,
        isOptimistic: network.isOptimistic ?? false,
        rpcNoStateOverride: network.rpcNoStateOverride,
        erc4337: network.erc4337,
        areContractsDeployed: network.areContractsDeployed,
        feeOptions: network.feeOptions,
        hasDebugTraceCall: network.hasDebugTraceCall,
        platformId: network.platformId,
        nativeAssetId: network.nativeAssetId,
        flagged: network.flagged ?? false,
        chainId: network.chainId,
        hasSingleton: network.hasSingleton
      })
      return network
    })
  }

  async #load() {
    let storedNetworks: Network[]
    storedNetworks = await this.#storage.get('networkPreferences', undefined)
    if (!storedNetworks) {
      storedNetworks = predefinedNetworks.reduce((acc, n) => {
        acc[n.id] = n
        return acc
      }, {})
      await this.#storage.set('networkPreferences', storedNetworks)
    }
    this.#networks = storedNetworks

    this.emitUpdate()
  }

  setNetworkToAddOrUpdate(
    networkToAddOrUpdate: {
      chainId: Network['chainId']
      rpcUrl: string
    } | null = null
  ) {
    if (networkToAddOrUpdate) {
      this.networkToAddOrUpdate = networkToAddOrUpdate
      this.emitUpdate()

      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      getNetworkInfo(networkToAddOrUpdate.rpcUrl, networkToAddOrUpdate.chainId, (info) => {
        if (this.networkToAddOrUpdate) {
          this.networkToAddOrUpdate = { ...this.networkToAddOrUpdate, info }
          this.emitUpdate()
        }
      })
    } else {
      this.networkToAddOrUpdate = null
      this.emitUpdate()
    }
  }

  async #addNetwork(network: AddNetworkRequestParams) {
    if (
      !this.networkToAddOrUpdate?.info ||
      Object.values(this.networkToAddOrUpdate.info).some((prop) => prop === 'LOADING')
    ) {
      return
    }
    const chainIds = this.networks.map((net) => net.chainId)
    const networkId = network.name.toLowerCase()
    const ids = this.networks.map((n) => n.id)

    // make sure the id and chainId of the network are unique
    if (ids.indexOf(networkId) !== -1 || chainIds.indexOf(BigInt(network.chainId)) !== -1) {
      throw new EmittableError({
        message: 'The network you are trying to add has already been added.',
        level: 'major',
        error: new Error('settings: addNetwork chain already added (duplicate id/chainId)')
      })
    }

    const info = { ...(this.networkToAddOrUpdate.info as NetworkInfo) }
    const { feeOptions } = info

    // eslint-disable-next-line no-param-reassign
    delete info.feeOptions
    this.#networks[networkId] = { ...network, ...info, ...feeOptions, predefined: false } as Network

    await this.#storage.set('networkPreferences', this.#networks)
    this.networkToAddOrUpdate = null
    this.emitUpdate()
  }

  async addNetwork(network: AddNetworkRequestParams) {
    await this.withStatus(this.addNetwork.name, () => this.#addNetwork(network))
  }

  async removeNetwork(id: NetworkId) {
    if (networks.find((n) => n.id === id)) return

    delete this.#networks[id]
    this.providers?.[id]?.destroy()
    delete this.providers?.[id]
    await this.#storage.set('networkPreferences', this.#networks)
    this.emitUpdate()
  }

  async #updateNetwork(network: Partial<Network>, networkId: NetworkId) {
    if (!Object.keys(network).length) return

    const networkData = this.networks.find((n) => n.id === networkId)
    const changedNetwork: Network = Object.keys(network).reduce((acc, key) => {
      if (!networkData) return acc

      // No need to save unchanged networks. Here we filter the networks that are the same as the ones in the storage.
      if (network[key as keyof Network] === networkData[key as keyof Network]) return acc

      return { ...acc, [key]: network[key as keyof Network] }
    }, {} as Network)

    // Update the networks with the incoming new values
    this.#networks[networkId] = { ...this.#networks[networkId], ...changedNetwork }
    await this.#storage.set('networkPreferences', this.#networks)

    this.emitUpdate()

    // Do not wait the rpc validation in order to complete the execution of updateNetwork
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    ;(async () => {
      // if the rpcUrls have changed, call the RPC and check whether it supports state overrided. If it doesn't, add a warning
      if (changedNetwork.selectedRpcUrl) {
        if (
          this.networkToAddOrUpdate?.info &&
          Object.values(this.networkToAddOrUpdate.info).every((prop) => prop !== 'LOADING')
        ) {
          const info = { ...(this.networkToAddOrUpdate.info as NetworkInfo) }
          const { feeOptions } = info

          // eslint-disable-next-line no-param-reassign
          delete (info as any).feeOptions
          this.#networks[networkId] = {
            ...this.#networks[networkId],
            ...info,
            ...feeOptions
          }

          await this.#storage.set('networkPreferences', this.#networks)

          this.emitUpdate()
          return
        }

        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        getNetworkInfo(
          changedNetwork.selectedRpcUrl,
          this.#networks[networkId].chainId!,
          async (info) => {
            if (Object.values(info).some((prop) => prop === 'LOADING')) {
              return
            }

            const { feeOptions } = info as NetworkInfo

            // eslint-disable-next-line no-param-reassign
            delete (info as any).feeOptions
            this.#networks[networkId] = {
              ...this.#networks[networkId],
              ...(info as NetworkInfo),
              ...feeOptions
            }

            await this.#storage.set('networkPreferences', this.#networks)

            this.emitUpdate()
          }
        )
      }
    })()
  }

  async updateNetwork(network: Partial<Network>, networkId: NetworkId) {
    await this.withStatus(this.updateNetwork.name, () => this.#updateNetwork(network, networkId))
  }

  // NOTE: use this method only for predefined networks
  async resetNetwork(key: keyof Network, networkId: NetworkId) {
    if (!networkId || !(networkId in this.#networks) || !(key in this.#networks[networkId])) return
    delete this.#networks[networkId][key]
    await this.#storage.set('networkPreferences', this.#networks)

    this.emitUpdate()
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      networks: this.networks
    }
  }
}
