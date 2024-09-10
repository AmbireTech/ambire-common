import EmittableError from '../../classes/EmittableError'
import { networks as predefinedNetworks } from '../../consts/networks'
import { Fetch } from '../../interfaces/fetch'
import {
  AddNetworkRequestParams,
  Network,
  NetworkId,
  NetworkInfo,
  NetworkInfoLoading
} from '../../interfaces/network'
import { Storage } from '../../interfaces/storage'
import {
  getFeaturesByNetworkProperties,
  getNetworkInfo,
  migrateNetworkPreferencesToNetworks
} from '../../libs/networks/networks'
import EventEmitter, { Statuses } from '../eventEmitter/eventEmitter'

const STATUS_WRAPPED_METHODS = {
  addNetwork: 'INITIAL',
  updateNetwork: 'INITIAL'
} as const

/**
 * The NetworksController is responsible for managing networks. It handles both predefined networks and those
 * that users can add either through a dApp request or manually via the UI. This controller provides functions
 * for adding, updating, and removing networks.
 */
export class NetworksController extends EventEmitter {
  #storage: Storage

  #fetch: Fetch

  #networks: { [key: NetworkId]: Network } = {}

  statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS> = STATUS_WRAPPED_METHODS

  networkToAddOrUpdate: {
    chainId: Network['chainId']
    rpcUrl: string
    info?: NetworkInfoLoading<NetworkInfo>
  } | null = null

  #onRemoveNetwork: (id: NetworkId) => void

  #onAddOrUpdateNetwork: (network: Network) => void

  // Holds the initial load promise, so that one can wait until it completes
  initialLoadPromise: Promise<void>

  constructor(
    storage: Storage,
    fetch: Fetch,
    onAddOrUpdateNetwork: (network: Network) => void,
    onRemoveNetwork: (id: NetworkId) => void
  ) {
    super()
    this.#storage = storage
    this.#fetch = fetch
    this.#onAddOrUpdateNetwork = onAddOrUpdateNetwork
    this.#onRemoveNetwork = onRemoveNetwork
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.initialLoadPromise = this.#load()
  }

  get isInitialized(): boolean {
    return !!Object.keys(this.#networks).length
  }

  get networks(): Network[] {
    if (!this.#networks) return predefinedNetworks

    const uniqueNetworksByChainId = Object.values(this.#networks)
      .sort((a, b) => +b.predefined - +a.predefined) // first predefined
      .filter((item, index, self) => self.findIndex((i) => i.chainId === item.chainId) === index) // unique by chainId (predefined with priority)
    return uniqueNetworksByChainId.map((network) => {
      // eslint-disable-next-line no-param-reassign
      network.features = getFeaturesByNetworkProperties({
        isSAEnabled: network.isSAEnabled,
        isOptimistic: network.isOptimistic ?? false,
        rpcNoStateOverride: network.rpcNoStateOverride,
        erc4337: network.erc4337,
        areContractsDeployed: network.areContractsDeployed,
        feeOptions: network.feeOptions,
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
    const storedNetworkPreferences: { [key: NetworkId]: Partial<Network> } | undefined =
      await this.#storage.get('networkPreferences', undefined)
    let storedNetworks: { [key: NetworkId]: Network }
    storedNetworks = await this.#storage.get('networks', {})
    if (!Object.keys(storedNetworks).length && storedNetworkPreferences) {
      storedNetworks = await migrateNetworkPreferencesToNetworks(storedNetworkPreferences)
      await this.#storage.set('networks', storedNetworks)
      await this.#storage.remove('networkPreferences')
    }
    this.#networks = storedNetworks
    predefinedNetworks.forEach((n) => {
      this.#networks[n.id] = {
        ...n, // add the latest structure of the predefined network to include the new props that are not in storage yet
        ...(this.#networks[n.id] || {}), // override with stored props
        feeOptions: n.feeOptions, // feeOptions should take predefined priority
        nativeAssetId: n.nativeAssetId, // nativeAssetId should take predefined priority
        nativeAssetSymbol: n.nativeAssetSymbol // nativeAssetSymbol should take predefined priority
      }
    })
    // without await to avoid performance impact on load
    // needed to keep the networks storage up to date with the latest from predefinedNetworks
    this.#storage.set('networks', this.#networks)

    this.emitUpdate()
  }

  async setNetworkToAddOrUpdate(
    networkToAddOrUpdate: {
      chainId: Network['chainId']
      rpcUrl: string
    } | null = null
  ) {
    await this.initialLoadPromise
    if (networkToAddOrUpdate) {
      this.networkToAddOrUpdate = networkToAddOrUpdate
      this.emitUpdate()

      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      getNetworkInfo(
        this.#fetch,
        networkToAddOrUpdate.rpcUrl,
        networkToAddOrUpdate.chainId,
        (info) => {
          if (this.networkToAddOrUpdate) {
            this.networkToAddOrUpdate = { ...this.networkToAddOrUpdate, info }
            this.emitUpdate()
          }
        }
      )
    } else {
      this.networkToAddOrUpdate = null
      this.emitUpdate()
    }
  }

  async #addNetwork(network: AddNetworkRequestParams) {
    await this.initialLoadPromise
    if (
      !this.networkToAddOrUpdate?.info ||
      Object.values(this.networkToAddOrUpdate.info).some((prop) => prop === 'LOADING')
    ) {
      return
    }
    const chainIds = this.networks.map((net) => net.chainId)
    const ids = this.networks.map((n) => n.id)
    const networkId = network.name.toLowerCase()

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

    // @ts-ignore
    delete info.feeOptions
    this.#networks[networkId] = {
      id: networkId,
      ...network,
      ...info,
      feeOptions,
      features: getFeaturesByNetworkProperties(info),
      hasRelayer: false,
      predefined: false
    }
    this.#onAddOrUpdateNetwork(this.#networks[networkId])
    await this.#storage.set('networks', this.#networks)
    this.networkToAddOrUpdate = null
    this.emitUpdate()
  }

  async addNetwork(network: AddNetworkRequestParams) {
    await this.withStatus('addNetwork', () => this.#addNetwork(network))
  }

  async #updateNetwork(network: Partial<Network>, networkId: NetworkId) {
    await this.initialLoadPromise
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
    this.#onAddOrUpdateNetwork(this.#networks[networkId])
    await this.#storage.set('networks', this.#networks)
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

          await this.#storage.set('networks', this.#networks)

          this.emitUpdate()
          return
        }

        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        getNetworkInfo(
          this.#fetch,
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

            await this.#storage.set('networks', this.#networks)

            this.emitUpdate()
          }
        )
      }
    })()
  }

  async updateNetwork(network: Partial<Network>, networkId: NetworkId) {
    await this.withStatus('updateNetwork', () => this.#updateNetwork(network, networkId))
  }

  async removeNetwork(id: NetworkId) {
    await this.initialLoadPromise
    if (!this.#networks[id]) return

    delete this.#networks[id]
    this.#onRemoveNetwork(id)
    await this.#storage.set('networks', this.#networks)
    this.emitUpdate()
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      isInitialized: this.isInitialized,
      networks: this.networks
    }
  }
}
