import EmittableError from '../../classes/EmittableError'
import { networks as predefinedNetworks, ODYSSEY_CHAIN_ID } from '../../consts/networks'
import { Fetch } from '../../interfaces/fetch'
import {
  AddNetworkRequestParams,
  ChainId,
  Network,
  NetworkId,
  NetworkInfo,
  NetworkInfoLoading,
  RelayerNetworkConfigResponse
} from '../../interfaces/network'
import { Storage } from '../../interfaces/storage'
import {
  getFeaturesByNetworkProperties,
  getNetworkInfo,
  is4337Enabled
} from '../../libs/networks/networks'
import { relayerCall } from '../../libs/relayerCall/relayerCall'
import { mapRelayerNetworkConfigToAmbireNetwork } from '../../utils/networks'
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

  #callRelayer: Function

  #networks: { [key: string]: Network } = {}

  #relayerNetworks: RelayerNetworkConfigResponse = {}

  statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS> = STATUS_WRAPPED_METHODS

  networkToAddOrUpdate: {
    chainId: Network['chainId']
    rpcUrl: string
    info?: NetworkInfoLoading<NetworkInfo>
  } | null = null

  #onRemoveNetwork: (id: NetworkId) => void

  /** Callback that gets called when adding or updating network */
  #onAddOrUpdateNetwork: (network: Network) => void

  // Holds the initial load promise, so that one can wait until it completes
  initialLoadPromise: Promise<void>

  constructor(
    storage: Storage,
    fetch: Fetch,
    relayerUrl: string,
    onAddOrUpdateNetwork: (network: Network) => void,
    onRemoveNetwork: (id: NetworkId) => void
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
        hasSingleton: network.hasSingleton,
        force4337: network.force4337
      })
      return network
    })
  }

  /**
   * Loads and synchronizes network configurations from storage and the relayer.
   *
   * This method performs the following steps:
   * 1. Retrieves legacy network preferences and current network configurations from storage.
   * 2. Migrates legacy network preferences to the new format if necessary.
   * 3. Initializes predefined networks if no networks are found in storage.
   * 4. Fetches the latest network configurations from the relayer and merges them with the stored networks.
   * 5. Detects and handles changes in network configurations, including custom networks becoming predefined.
   * 6. Updates network information for custom networks if it is outdated.
   * 7. Handles scenarios where predefined networks are removed and become custom networks.
   * 8. Sorts and stores the final network configurations back to storage.
   * 9. Emits an update event to notify other parts of the application about the changes.
   *
   * This method ensures that the application has the most up-to-date network configurations,
   * handles migration of legacy data, and maintains consistency between stored and relayer-provided networks.
   */
  async #load() {
    // 1. Get latest storage (networksInStorage)
    const networksInStorage: { [key: NetworkId]: Network } = await this.#storage.get('networks', {})

    // migrate [key: NetworkId] to [key: chainId]
    let finalNetworks: { [key: string]: Network } = Object.fromEntries(
      Object.values(networksInStorage).map((network) => [network.chainId.toString(), network])
    )

    // If networksInStorage is empty, set predefinedNetworks and emit update
    if (!Object.keys(networksInStorage).length) {
      finalNetworks = predefinedNetworks.reduce((acc, network) => {
        acc[network.chainId.toString()] = network
        return acc
      }, {} as { [key: string]: Network })
      this.#networks = finalNetworks
      this.emitUpdate()
    }

    // Step 2: Merge the networks coming from the Relayer
    // For now we call this on load, but will decide later if we need to call it periodically
    try {
      const res = await this.#callRelayer('/v2/config/networks')
      this.#relayerNetworks = res.data.extensionConfigNetworks

      Object.entries(this.#relayerNetworks).forEach(([_chainId, network]) => {
        const chainId = BigInt(_chainId)
        const relayerNetwork = mapRelayerNetworkConfigToAmbireNetwork(chainId, network)
        const storedNetwork = Object.values(networksInStorage).find(
          (net) => net.chainId === chainId
        )

        if (!storedNetwork) {
          finalNetworks[chainId.toString()] = relayerNetwork
          return
        }

        if (storedNetwork.predefinedConfigVersion === undefined) {
          storedNetwork.predefinedConfigVersion = 0
        }

        // NETWORK TYPE TRANSITION DETECTION
        // Detect if a custom network is becoming an officially supported one
        const isCustomNetworkBecomingPredefined =
          storedNetwork &&
          !storedNetwork.predefined &&
          !storedNetwork.predefinedConfigVersion &&
          relayerNetwork.predefinedConfigVersion > 0

        // If the network is custom we assume predefinedConfigVersion = 0
        // NOTE: When it is the first time we update this, the network will be with predefinedNetworkVersion = 0
        // NOTE: When the network is updated, the predefinedNetworkVersion will be updated to the latest version
        // Mechanism to force an update network preferences if needed
        const hasPredefinedConfigVersionChanged =
          relayerNetwork.predefinedConfigVersion > storedNetwork.predefinedConfigVersion

        if (!hasPredefinedConfigVersionChanged) {
          // Simple update - preserve existing configuration
          finalNetworks[chainId.toString()] = {
            ...storedNetwork,
            rpcUrls: [...new Set([...relayerNetwork.rpcUrls, ...storedNetwork.rpcUrls])]
          }
        } else {
          // Override the predefined network config, but keep user preferences,
          // one might not exist in the case of a new network coming from the relayer
          const predefinedNetwork = predefinedNetworks.find(
            (pN) => pN.chainId === relayerNetwork.chainId
          )

          // Important: Preserve the original ID if this is a user-added network
          // Preserve in customNetworkId as well
          // Will need this for migrating storages later one
          const originalId = storedNetwork?.id || relayerNetwork.id
          // Set the new network with chainId here and remove the old one
          finalNetworks[chainId.toString()] = {
            ...(predefinedNetwork || {}),
            ...relayerNetwork,
            ...(isCustomNetworkBecomingPredefined
              ? { id: originalId, customNetworkId: originalId }
              : {}),
            rpcUrls: [...new Set([...relayerNetwork.rpcUrls, ...storedNetwork.rpcUrls])]
          }
        }
      })
    } catch (e: any) {
      // Fail silently, we already have the networks from the storage
      // and assured we used predefined networks
      console.log('Failed to fetch networks from the Relayer', e)
    }

    Object.values(finalNetworks).forEach((network) => {
      // Determine if smart accounts are disabled and in case they are
      // get the latest NetworkInfo from RPC
      if (!network.isSAEnabled) {
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        getNetworkInfo(this.#fetch, network.selectedRpcUrl, network.chainId, async (info) => {
          if (Object.values(info).some((prop) => prop === 'LOADING')) {
            return
          }

          finalNetworks[network.chainId.toString()] = {
            ...finalNetworks[network.chainId.toString()],
            ...(info as NetworkInfo),
            lastUpdated: Date.now()
          }
        })
      }
    })

    // Step 3
    // Check if the NetworkInfo for the custom networks have changed, if it's too old (24h), fetch it again
    // Using the getNetworkInfo() update custom networks with the latest info
    const customNetworks = Object.values(finalNetworks).filter((n) => !n.predefined)
    customNetworks.forEach((network) => {
      if (
        !network.lastUpdated ||
        (network.lastUpdated && Date.now() - network.lastUpdated > 24 * 60 * 60 * 1000)
      ) {
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        getNetworkInfo(this.#fetch, network.selectedRpcUrl, network.chainId, async (info) => {
          if (Object.values(info).some((prop) => prop === 'LOADING')) {
            return
          }

          finalNetworks[network.chainId.toString()] = {
            ...finalNetworks[network.chainId.toString()],
            ...(info as NetworkInfo),
            lastUpdated: Date.now()
          }
        })
      }
    })

    // Ensure predefined networks stay marked correctly and handle special cases (e.g., Odyssey network)
    const predefinedNetworkIds = Object.keys(this.#relayerNetworks)
    Object.keys(finalNetworks).forEach((chainId: string) => {
      const network = finalNetworks[chainId]

      // If a predefined network is removed by the relayer, mark it as custom
      if (!predefinedNetworkIds.includes(network.chainId.toString()) && network.predefined) {
        finalNetworks[chainId] = { ...network, predefined: false }
      }

      // Special case: Set the platformId for Odyssey chain
      if (network.chainId === ODYSSEY_CHAIN_ID) {
        finalNetworks[chainId] = { ...network, platformId: 'ethereum' }
      }
    })

    // Sort networks: predefined first, then custom, ordered by chainId
    this.#networks = Object.fromEntries(
      Object.values(finalNetworks)
        .sort((a, b) => {
          if (a.predefined !== b.predefined) {
            return a.predefined ? -1 : 1 // Predefined networks come first
          }
          return a.chainId.toString().localeCompare(b.chainId.toString()) // Sort by chainId
        })
        .map((network) => [network.chainId.toString(), network])
    )
    await this.#storage.set('networks', this.#networks)

    this.emitUpdate()
  }

  async setNetworkToAddOrUpdate(
    networkToAddOrUpdate: {
      chainId: Network['chainId']
      rpcUrl: string
      force4337?: boolean
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
        networkToAddOrUpdate.force4337 ? { force4337: networkToAddOrUpdate.force4337 } : undefined
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
    this.#networks[network.chainId.toString()] = {
      id: networkId,
      ...network,
      ...info,
      feeOptions,
      features: getFeaturesByNetworkProperties(info),
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

    const nextNetwork: Network = { ...network, ...changedNetwork }
    // TODO: Maybe run getFeaturesByNetworkProperties instead?
    // if force4337 is updated, we have to update the enabled flag as well
    if ('force4337' in changedNetwork) {
      nextNetwork.erc4337.enabled = is4337Enabled(
        true,
        this.#networks[networkId],
        nextNetwork.force4337
      )
    }

    // Update the networks with the incoming new values
    this.#networks[networkId] = { ...this.#networks[networkId], ...changedNetwork }

    this.#networks[networkId] = nextNetwork
    this.#onAddOrUpdateNetwork(this.#networks[networkId])

    // TODO: Figure out if this needs adjustments, it probably does
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
    }

    // Do not wait the rpc validation in order to complete the execution of updateNetwork
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    checkRPC(this.networkToAddOrUpdate)
    this.networkToAddOrUpdate = null

    this.emitUpdate()
  }

  async updateNetwork(network: Partial<Network>, networkId: NetworkId) {
    await this.withStatus('updateNetwork', () => this.#updateNetwork(network, networkId))
  }

  async removeNetwork({ chainId, networkId }: { chainId: ChainId; networkId: NetworkId }) {
    await this.initialLoadPromise

    if (!this.#networks[chainId.toString()]) return
    delete this.#networks[chainId.toString()]
    this.#onRemoveNetwork(chainId.toString())
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
