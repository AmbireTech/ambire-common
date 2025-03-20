import EmittableError from '../../classes/EmittableError'
import { networks as predefinedNetworks, ODYSSEY_CHAIN_ID } from '../../consts/networks'
import { Fetch } from '../../interfaces/fetch'
import {
  AddNetworkRequestParams,
  ChainId,
  Network,
  NetworkInfo,
  NetworkInfoLoading,
  RelayerNetworkConfigResponse
} from '../../interfaces/network'
import { getFeaturesByNetworkProperties, getNetworkInfo } from '../../libs/networks/networks'
import { relayerCall } from '../../libs/relayerCall/relayerCall'
import { mapRelayerNetworkConfigToAmbireNetwork } from '../../utils/networks'
import EventEmitter, { Statuses } from '../eventEmitter/eventEmitter'
import { StorageController } from '../storage/storage'

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
  #storage: StorageController

  #fetch: Fetch

  #callRelayer: Function

  #networks: { [key: string]: Network } = {}

  statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS> = STATUS_WRAPPED_METHODS

  networkToAddOrUpdate: {
    chainId: Network['chainId']
    rpcUrl: string
    info?: NetworkInfoLoading<NetworkInfo>
  } | null = null

  #onRemoveNetwork: (chainId: bigint) => void

  /** Callback that gets called when adding or updating network */
  #onAddOrUpdateNetwork: (network: Network) => void

  // Holds the initial load promise, so that one can wait until it completes
  initialLoadPromise: Promise<void>

  constructor(
    storage: StorageController,
    fetch: Fetch,
    relayerUrl: string,
    onAddOrUpdateNetwork: (network: Network) => void,
    onRemoveNetwork: (chainId: bigint) => void
  ) {
    super()
    this.#storage = storage
    this.#fetch = fetch
    this.#callRelayer = relayerCall.bind({ url: relayerUrl, fetch })
    this.#onAddOrUpdateNetwork = onAddOrUpdateNetwork
    this.#onRemoveNetwork = onRemoveNetwork
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.initialLoadPromise = this.#load()
  }

  get isInitialized(): boolean {
    return !!Object.keys(this.#networks).length
  }

  get networks(): Network[] {
    if (!Object.keys(this.#networks).length) return predefinedNetworks

    const uniqueNetworksByChainId = Object.values(this.#networks)
      .sort((a, b) => +b.predefined - +a.predefined) // first predefined
      .filter((item, index, self) => self.findIndex((i) => i.chainId === item.chainId) === index) // unique by chainId (predefined with priority)
    return uniqueNetworksByChainId.map((network) => {
      // eslint-disable-next-line no-param-reassign
      network.features = getFeaturesByNetworkProperties(
        {
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
        },
        network
      )
      return network
    })
  }

  /**
   * Loads and synchronizes network configurations from storage and the relayer.
   *
   * This method performs the following steps:
   * 1. Retrieves the latest network configurations from storage.
   * 2. If no networks are found in storage, sets predefined networks and emits an update.
   * 3. Merges the networks from the Relayer with the stored networks.
   * 4. Ensures predefined networks are marked correctly and handles special cases (e.g., Odyssey network).
   * 5. Sorts networks with predefined ones first, followed by custom networks, ordered by chainId.
   * 6. Updates the networks in storage.
   * 7. Asynchronously updates network features if needed.
   *
   * This method ensures that the application has the most up-to-date network configurations,
   * handles migration of legacy data, and maintains consistency between stored and relayer-provided networks.
   */
  async #load() {
    // Step 1. Get latest storage (networksInStorage)
    const networksInStorage: { [key: string]: Network } = await this.#storage.get('networks', {})

    let finalNetworks: { [key: string]: Network } = {}

    // If networksInStorage is empty, set predefinedNetworks and emit update
    if (!Object.keys(networksInStorage).length) {
      finalNetworks = predefinedNetworks.reduce((acc, network) => {
        acc[network.chainId.toString()] = network
        return acc
      }, {} as { [key: string]: Network })
      this.#networks = finalNetworks
      this.emitUpdate()
    }

    finalNetworks = Object.fromEntries(
      Object.values(networksInStorage).map((network) => [network.chainId.toString(), network])
    )

    // Step 4: Merge the networks from the Relayer
    finalNetworks = await this.#mergeRelayerNetworks(finalNetworks, networksInStorage)

    this.#networks = finalNetworks
    this.emitUpdate()

    await this.#storage.set('networks', this.#networks)

    // Step 8: Update networks features asynchronously
    this.#updateNetworkFeatures(finalNetworks)
  }

  /**
   * Processes network updates, finalizes changes, and updates network features asynchronously.
   * Used for periodically network synchronization.
   */
  async synchronizeNetworks() {
    const networksInStorage: { [key: string]: Network } = await this.#storage.get('networks', {})
    const finalNetworks = { ...this.#networks }

    // Process updates (merge Relayer data and apply rules)
    const updatedNetworks = await this.#mergeRelayerNetworks(finalNetworks, networksInStorage)

    // Finalize updates
    this.#networks = updatedNetworks
    this.emitUpdate()
    await this.#storage.set('networks', this.#networks)

    // Asynchronously update network features
    this.#updateNetworkFeatures(updatedNetworks)
  }

  /**
   * Merges locally stored networks with those fetched from the Relayer.
   *
   * This function ensures that networks retrieved from the Relayer are properly merged
   * with existing stored networks, keeping track of configuration versions and handling
   * predefined networks appropriately. It also ensures that the latest RPC URLs are
   * maintained and applies special-case handling where needed.
   *
   * ### Functionality:
   * 1. Fetches the latest network configurations from the Relayer.
   * 2. Maps and merges the fetched networks with those stored locally.
   * 3. If a network does not exist in storage, it is added from the Relayer.
   * 4. If a network is predefined but has an outdated configuration, it is updated.
   * 5. Ensures RPC URLs are combined uniquely across sources.
   * 6. Removes predefined flags if a predefined network is removed by the Relayer.
   * 7. Applies special handling for networks like Odyssey.
   *
   */
  async #mergeRelayerNetworks(
    finalNetworks: { [key: string]: Network },
    networksInStorage: { [key: string]: Network }
  ): Promise<{ [key: string]: Network }> {
    let relayerNetworks: RelayerNetworkConfigResponse = {}
    const updatedNetworks = { ...finalNetworks }
    try {
      const res = await this.#callRelayer('/v2/config/networks')
      relayerNetworks = res.data.extensionConfigNetworks

      Object.entries(relayerNetworks).forEach(([_chainId, network]) => {
        const chainId = BigInt(_chainId)
        const relayerNetwork = mapRelayerNetworkConfigToAmbireNetwork(chainId, network)
        const storedNetwork = Object.values(networksInStorage).find((n) => n.chainId === chainId)

        if (!storedNetwork) {
          updatedNetworks[chainId.toString()] = {
            ...(predefinedNetworks.find((n) => n.chainId === relayerNetwork.chainId) || {}),
            ...relayerNetwork
          }
          return
        }

        // If the network is custom we assume predefinedConfigVersion = 0
        if (storedNetwork.predefinedConfigVersion === undefined) {
          storedNetwork.predefinedConfigVersion = 0
        }

        // Mechanism to force an update network preferences if needed
        const shouldOverrideStoredNetwork =
          relayerNetwork.predefinedConfigVersion > 0 &&
          relayerNetwork.predefinedConfigVersion > storedNetwork.predefinedConfigVersion

        if (shouldOverrideStoredNetwork) {
          updatedNetworks[chainId.toString()] = {
            ...(predefinedNetworks.find((n) => n.chainId === relayerNetwork.chainId) || {}),
            ...relayerNetwork,
            rpcUrls: [...new Set([...relayerNetwork.rpcUrls, ...storedNetwork.rpcUrls])]
          }
        } else {
          updatedNetworks[chainId.toString()] = {
            ...storedNetwork,
            rpcUrls: [...new Set([...relayerNetwork.rpcUrls, ...storedNetwork.rpcUrls])]
          }
        }
      })

      // Step 3: Ensure predefined networks are marked correctly and handle special cases
      let predefinedNetworkIds = Object.keys(updatedNetworks)

      if (!predefinedNetworkIds.length) {
        predefinedNetworkIds = predefinedNetworks.map((network) => network.chainId.toString())
      }

      Object.keys(updatedNetworks).forEach((chainId: string) => {
        const network = updatedNetworks[chainId]

        // If a predefined network is removed by the relayer, mark it as custom
        // and remove the predefined flag
        // Update the hasRelayer flag to false just in case
        if (!predefinedNetworkIds.includes(network.chainId.toString()) && network.predefined) {
          updatedNetworks[chainId] = { ...network, predefined: false, hasRelayer: false }
        }

        // Special case: Set the platformId for Odyssey chain
        if (network.chainId === ODYSSEY_CHAIN_ID) {
          updatedNetworks[chainId] = { ...network, platformId: 'ethereum' }
        }
      })
    } catch (e: any) {
      console.error('Failed to fetch networks from the Relayer', e)
    }

    return updatedNetworks
  }

  /**
   * Updates network features asynchronously if needed.
   */
  #updateNetworkFeatures(finalNetworks: { [key: string]: Network }) {
    Object.values(finalNetworks).forEach((network) => {
      if (network.isSAEnabled) return

      if (
        network.lastUpdatedNetworkInfo &&
        Date.now() - network.lastUpdatedNetworkInfo <= 24 * 60 * 60 * 1000
      )
        return

      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      getNetworkInfo(
        this.#fetch,
        network.selectedRpcUrl,
        network.chainId,
        async (info) => {
          if (Object.values(info).some((prop) => prop === 'LOADING')) {
            return
          }

          // If RPC is flagged there might be an issue with the RPC
          // this information will fail to return
          // and we dont want to update lastUpdatedNetworkInfo
          if (info.flagged) return
          const chainId = network.chainId.toString()
          this.#networks[chainId] = {
            ...this.#networks[chainId],
            ...(info as NetworkInfo),
            lastUpdatedNetworkInfo: Date.now()
          }

          await this.#storage.set('networks', this.#networks)

          this.emitUpdate()
        },
        network
      )
    })
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
        },
        this.#networks[networkToAddOrUpdate.chainId.toString()]
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
    // make sure the id and chainId of the network are unique
    if (chainIds.indexOf(BigInt(network.chainId)) !== -1) {
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
    this.#networks[network.chainId.toString()] = {
      ...network,
      ...info,
      feeOptions,
      features: getFeaturesByNetworkProperties(info, undefined),
      hasRelayer: false,
      predefined: false,
      has7702: false
    }

    this.#onAddOrUpdateNetwork(this.#networks[network.chainId.toString()])

    await this.#storage.set('networks', this.#networks)
    this.networkToAddOrUpdate = null
    this.emitUpdate()
  }

  async addNetwork(network: AddNetworkRequestParams) {
    await this.withStatus('addNetwork', () => this.#addNetwork(network))
  }

  async #updateNetwork(network: Partial<Network>, chainId: ChainId) {
    await this.initialLoadPromise

    if (!Object.keys(network).length) return

    const networkData = this.networks.find((n) => n.chainId === chainId)
    const changedNetwork: Network = Object.keys(network).reduce((acc, key) => {
      if (!networkData) return acc

      // No need to save unchanged networks. Here we filter the networks that are the same as the ones in the storage.
      if (network[key as keyof Network] === networkData[key as keyof Network]) return acc

      return { ...acc, [key]: network[key as keyof Network] }
    }, {} as Network)

    // Update the networks with the incoming new values
    this.#networks[chainId.toString()] = {
      ...networkData,
      ...changedNetwork
    }

    this.#onAddOrUpdateNetwork(this.#networks[chainId.toString()])
    await this.#storage.set('networks', this.#networks)

    const checkRPC = async (
      networkToAddOrUpdate: {
        chainId: bigint
        rpcUrl: string
        info?: NetworkInfoLoading<NetworkInfo> | undefined
      } | null
    ) => {
      if (changedNetwork.selectedRpcUrl) {
        if (
          networkToAddOrUpdate?.info &&
          Object.values(networkToAddOrUpdate.info).every((prop) => prop !== 'LOADING')
        ) {
          const info = { ...(networkToAddOrUpdate.info as NetworkInfo) }
          const { feeOptions } = info

          // eslint-disable-next-line no-param-reassign
          delete (info as any).feeOptions
          this.#networks[chainId.toString()] = {
            ...this.#networks[chainId.toString()],
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
          this.#networks[chainId.toString()].chainId!,
          async (info) => {
            if (Object.values(info).some((prop) => prop === 'LOADING')) {
              return
            }

            const { feeOptions } = info as NetworkInfo

            // eslint-disable-next-line no-param-reassign
            delete (info as any).feeOptions
            this.#networks[chainId.toString()] = {
              ...this.#networks[chainId.toString()],
              ...(info as NetworkInfo),
              ...feeOptions
            }

            await this.#storage.set('networks', this.#networks)

            this.emitUpdate()
          },
          this.#networks[chainId.toString()]
        )
      }
    }

    // Do not wait the rpc validation in order to complete the execution of updateNetwork
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    checkRPC(this.networkToAddOrUpdate)
    this.networkToAddOrUpdate = null

    this.emitUpdate()
  }

  async updateNetwork(network: Partial<Network>, chainId: ChainId) {
    await this.withStatus('updateNetwork', () => this.#updateNetwork(network, chainId))
  }

  async removeNetwork(chainId: ChainId) {
    await this.initialLoadPromise

    if (!this.#networks[chainId.toString()]) return
    delete this.#networks[chainId.toString()]
    this.#onRemoveNetwork(chainId)
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
