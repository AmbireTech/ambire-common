import EmittableError from '../../classes/EmittableError'
import { networks as predefinedNetworks } from '../../consts/networks'
import { Fetch } from '../../interfaces/fetch'
import {
  AddNetworkRequestParams,
  Network,
  NetworkId,
  NetworkInfo,
  NetworkInfoLoading,
  RelayerNetwork,
  RelayerNetworkConfigResponse,
  UserNetworkPreferences
} from '../../interfaces/network'
import { Storage } from '../../interfaces/storage'
import {
  getFeaturesByNetworkProperties,
  getNetworkInfo,
  getShouldMigrateNetworkPreferencesToNetworks,
  getShouldMigrateNetworksInStorageToNetworksV2,
  is4337Enabled,
  LegacyNetworkPreferences,
  migrateNetworkPreferencesToNetworks
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

  #networks: { [key: NetworkId]: Network } = {}

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
    // TODO: This should probably be removed
    // if (!this.#networks) return predefinedNetworks

    // TODO: Do this once, in the #load method?
    return Object.values(this.#networks).map(
      (network) => {
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
      }
    )
  }


  /**
   * Network details which are editable for the given network id
   * @param networkId 
   * @returns 
   */
  getNetworkDetails(networkId: NetworkId) {
    const network = this.#networks[networkId]
    if (!network) {
      throw new Error(`Network with id ${networkId} not found`);
    }

    // Those are editable fields, which could be updated by the user on custom network
    const { selectedRpcUrl, rpcUrls, explorerUrl, chainId, name, allowForce4337 } = network;
    return { selectedRpcUrl, rpcUrls, explorerUrl, chainId, name, allowForce4337 };
  }

  /**
   * Checks if the network details have been updated and returns the updated details.
   * @param networkId - The ID of the network to check.
   * @param relayerNetwork - The updated network details to compare.
   * @returns The updated network details if they have been updated, null otherwise.
   */
  getUpdatedNetworkDetails(networkId: NetworkId, relayerNetwork: RelayerNetwork): Partial<NetworkInfo> | null {
    const currentDetails = this.getNetworkDetails(networkId);
    const changes: Partial<NetworkInfo> = {};

    for (const key in relayerNetwork) {
      if (currentDetails[key as keyof NetworkInfo] !== relayerNetwork[key as keyof RelayerNetwork]) {
      changes[key as keyof NetworkInfo] = relayerNetwork[key as keyof RelayerNetwork];
      }
    }

    return Object.keys(changes).length ? changes : null;
  }

  async #load() {
    const legacyNetworkPrefInStorage: LegacyNetworkPreferences = await this.#storage.get(
      'networkPreferences',
      {}
    )
    // 1. Get latest storage (networksInStorage)
    let networksInStorage: { [key: NetworkId]: Network } = await this.#storage.get('networks', {})
    if (
      getShouldMigrateNetworkPreferencesToNetworks(networksInStorage, legacyNetworkPrefInStorage)
    ) {
      networksInStorage = await migrateNetworkPreferencesToNetworks(legacyNetworkPrefInStorage)
      await this.#storage.remove('networkPreferences')
    }

    // Step 2: Merge the networks coming from the Relayer
    // TODO: When do we call this? On each load or periodically as well
    // TODO: Should this be awaited or not?
    try {
      this.#relayerNetworks = await this.#callRelayer('/v2/networks-config')

      Object.entries(this.#relayerNetworks).forEach(([chainId, relayerNetwork]) => {
        const n = mapRelayerNetworkConfigToAmbireNetwork(chainId, relayerNetwork)
       
        // TODO: Handle the scenario when a predefined network is removed and becomes a custom network for the user
        const userUpdatedFields: Partial<NetworkInfo> | null = this.getUpdatedNetworkDetails(n.id, relayerNetwork)
        const hasNoUpdatedFields = userUpdatedFields === null
        // TODO: If the network is custom we assume predefinedConfigVersion = 0
        // NOTE: When it is the first time we update this, the network will be with predefinedNetworkVersion = 0
        // NOTE: When the network is updated, the predefinedNetworkVersion will be updated to the latest version

        const shouldOverrideNetworkPreferences =
          !hasNoUpdatedFields &&
          // Mechanism to force an update network preferences if needed
          relayerNetwork.predefinedConfigVersion >
          (networksInStorage[n.id].predefinedConfigVersion || 0)


        // TODO: Handle the scenario when a custom network for the user became predefined network
        // IN this scenario the network will come from relayerNetwork with predefinedConfigVersion > 0
        // We need to check its id and name and update the network in the storage
        // Be aware of changing the key of the network, since it is used as an id in portfolio controller
        // but we want to slightly migrate to chainId as the key
        const isCustomNetworkBecomingPredefined = networksInStorage[n.id]?.hasRelayer === false && relayerNetwork.predefinedConfigVersion > 0;
        const isNameOrIdDifferent = networksInStorage[n.id]?.name !== n.name || networksInStorage[n.id]?.id !== n.id;

        // // Set the network by chain Id if it comes from the relayer and remove the old one as custom in
        // if (isCustomNetworkBecomingPredefined && isNameOrIdDifferent) {
        //   delete networksInStorage[networksInStorage[n.id].id];
        //   networksInStorage[chainId] = n;
        // }
        
        if (hasNoUpdatedFields || shouldOverrideNetworkPreferences) {
          // TODO: Should we set the new network with chainId here?

          networksInStorage[n.id] = { ...networksInStorage[n.id], ...n }
        } else {
          // Override the predefined network config, but keep user preferences,
          // one might not exist in the case of a new network coming from the relayer
          const predefinedNetwork: Network | {} =
            predefinedNetworks.find((pN) => pN.id === n.id) || {}

          // TODO: Should we set the new network with chainId here?
          networksInStorage[n.id] = {
            ...predefinedNetwork,
            ...n,
            // In the case they updated the selectedRpcUrl we leave his selection
            ...(userUpdatedFields && userUpdatedFields?.selectedRpcUrl ? { selectedRpcUrl: userUpdatedFields?.selectedRpcUrl } : {}),
            // If user has updated their URLs we should merge them
           ...(userUpdatedFields && userUpdatedFields?.rpcUrls ? { rpcUrls: Array.from(new Set([...relayerNetwork.rpcUrls, ...userUpdatedFields.rpcUrls])) } : {}),
            // Keep blockExplorerUrl if user has updated it
            ...(userUpdatedFields && userUpdatedFields.explorerUrl ? { explorerUrl: userUpdatedFields.explorerUrl } : {}),
            // TODO: Check if we need to keep the allowForce4337 flag
          }
        }
      })
    } catch (e: any) {
      // Fail silently
    }

    // Step 3
    // TODO: Check if the NetworkInfo for the custom networks have changed, if it's too old (24h), fetch it again
    // Using the getNetworkInfo() update custom networks with the latest info
    this.#networks = networksInStorage
    this.emitUpdate()
  }

  // TODO: Method to fetch network config from the Relayer and update networks if needed

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
    // TODO: Set new network by chainId
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

    // TODO: Type mismatch, this should be NetworkInfo
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
