import EmittableError from '../../classes/EmittableError'
import { networks as predefinedNetworks } from '../../consts/networks'
import { Fetch } from '../../interfaces/fetch'
import {
  AddNetworkRequestParams,
  ChainId,
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
import { networksList } from './networksList'

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
   * Checks if the network details have been updated and returns the updated details.
   * @param network - The current network details.
   * @param networkId - The ID of the network to check.
   * @param relayerNetwork - The updated network details to compare.
   * @returns The updated network details if they have been updated, null otherwise.
   */
  getUpdatedNetworkDetails(network: Network, networkId: NetworkId, relayerNetwork: RelayerNetwork): Partial<NetworkInfo> | null {
    if (!network) return null
    const changes: Partial<NetworkInfo> = {};

    if (network.rpcUrls.join() !== relayerNetwork.rpcUrls.join()) {
      changes.rpcUrls = relayerNetwork.rpcUrls;
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

    // If networksInStorage is empty, set predefinedNetworks and emit update
    if (!Object.keys(networksInStorage).length) {
      this.#networks = predefinedNetworks.reduce((acc, network) => {
        acc[network.id] = network
        return acc
        }, {} as { [key: NetworkId]: Network })
      this.emitUpdate()
      return
    }

    // Step 2: Merge the networks coming from the Relayer
    // TODO: For now we call this on load, but will decide later if we need to call it periodically
    try {
      // this.#relayerNetworks = await this.#callRelayer('/v2/networks-config')

      this.#relayerNetworks = networksList as RelayerNetwork

      Object.entries(this.#relayerNetworks).forEach(([chainId, relayerNetwork]) => {
        const n = mapRelayerNetworkConfigToAmbireNetwork(chainId, relayerNetwork)
        
        // IN this scenario the network will come from relayerNetwork with predefinedConfigVersion > 0
        // We need to check its id and name and update the network in the storage
        const isCustomNetworkBecomingPredefined = networksInStorage[n.id] && !networksInStorage[n.id].predefined && networksInStorage[n.id]?.predefinedConfigVersion === 0 && relayerNetwork.predefinedConfigVersion > 0;
        const isNameOrIdDifferent = networksInStorage[n.id]?.name !== n.name || networksInStorage[n.id]?.id !== n.id;

        const currentNetwork = isNameOrIdDifferent ? Object.values(networksInStorage).find(net => net.chainId === BigInt(chainId)) : networksInStorage[n.id];

        // TODO: Handle the scenario when a predefined network is removed and becomes a custom network for the user
        const userUpdatedFields: Partial<NetworkInfo> | null = this.getUpdatedNetworkDetails(currentNetwork, n.id, relayerNetwork)
        const hasNoUpdatedFields = userUpdatedFields === null

        // If the network is custom we assume predefinedConfigVersion = 0
        // NOTE: When it is the first time we update this, the network will be with predefinedNetworkVersion = 0
        // NOTE: When the network is updated, the predefinedNetworkVersion will be updated to the latest version
        
        
        // Mechanism to force an update network preferences if needed
        const hasPredefinedConfigVersionChanged = relayerNetwork.predefinedConfigVersion >
        ((currentNetwork?.predefinedConfigVersion || 0))
        const shouldOverrideNetworkPreferences =
          !hasNoUpdatedFields &&
          hasPredefinedConfigVersionChanged

        // Set the network by chain Id if it comes from the relayer and remove the old one as custom in
        if (isCustomNetworkBecomingPredefined && isNameOrIdDifferent) {
          currentNetwork && delete networksInStorage[networksInStorage[currentNetwork.id].id];
          networksInStorage[chainId] = n;
        }
        
        if (hasNoUpdatedFields || !shouldOverrideNetworkPreferences) {
          // Set the new network with chainId here and remove the old one
          networksInStorage[chainId] = { ...currentNetwork && networksInStorage[currentNetwork.id], ...n }
          currentNetwork && networksInStorage[currentNetwork.id] && delete networksInStorage[currentNetwork.id]
        } else {
          // Override the predefined network config, but keep user preferences,
          // one might not exist in the case of a new network coming from the relayer
          const predefinedNetwork: Network | {} =
            predefinedNetworks.find((pN) => pN.id === n.id) || {}

          // Set the new network with chainId here and remove the old one
          networksInStorage[chainId] = {
            ...predefinedNetwork,
            ...n,
            // If user has updated their URLs we should merge them
            // this adds another selectedRpcUrl as well.
           ...(userUpdatedFields && 'rpcUrls' in userUpdatedFields && Array.isArray(userUpdatedFields.rpcUrls) ? { rpcUrls: Array.from(new Set([...relayerNetwork.rpcUrls, ...userUpdatedFields.rpcUrls])) } : { rpcUrls: relayerNetwork.rpcUrls}),
          }
          currentNetwork && networksInStorage[currentNetwork.id] && delete networksInStorage[currentNetwork.id]

          // TODO: Determine if smart accounts are disabled and in case they are
          // get the latest NetworkInfo from RPC
          // if (!n.isSAEnabled) {
          // // eslint-disable-next-line @typescript-eslint/no-floating-promises
          // getNetworkInfo(
          //   this.#fetch,
          //   n.selectedRpcUrl,
          //   n.chainId,
          //   async (info) => {
          //   if (Object.values(info).some((prop) => prop === 'LOADING')) {
          //     return
          //   }

          //   networksInStorage[chainId] = {
          //     ...networksInStorage[chainId],
          //     ...(info as NetworkInfo),
          //     lastUpdated: Date.now()
          //   }
          //   this.#networks = networksInStorage
          //   this.emitUpdate()
          //   }
          // )
          // }
        }
      })
    } catch (e: any) {
      // Fail silently
      console.log('Failed to fetch networks from the Relayer', e)
    }

    // TODO: Handle the scenario when a predefined network is removed and becomes a custom network for the user
    const predefinedNetworkIds = Object.keys(this.#relayerNetworks)
    Object.keys(networksInStorage).forEach((networkKey) => {
      if (!predefinedNetworkIds.includes(networkKey) && networksInStorage[networkKey].predefined) {
        networksInStorage[networkKey].predefined = false;
      }
    })

    // Step 3
    // TODO: Check if the NetworkInfo for the custom networks have changed, if it's too old (24h), fetch it again
    // Using the getNetworkInfo() update custom networks with the latest info

    const customNetworks = Object.values(networksInStorage).filter((n) => !n.predefined)

    customNetworks.forEach((network) => {
      if (!network.lastUpdated || network.lastUpdated && Date.now() - network.lastUpdated > 24 * 60 * 60 * 1000) {

      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      getNetworkInfo(
        this.#fetch,
        network.selectedRpcUrl,
        network.chainId,
        async (info) => {

        if (Object.values(info).some((prop) => prop === 'LOADING')) {
          return
        }

        networksInStorage[network.chainId.toString()] = {
          ...networksInStorage[network.chainId.toString()],
          ...networksInStorage[network.id],
          ...(info as NetworkInfo),
          lastUpdated: Date.now()
        }
        networksInStorage[network.id] && delete networksInStorage[network.id]

        }
      )
    }
    })


    // TODO: This mapping was updated  recently in v2 with addition 
    // of two props bundlers and increasePreVerGas.
    // We need to update the mapping here as well and figure out how to handle the migration

    // predefinedNetworks.forEach((n) => {
    //   this.#networks[n.id] = {
    //     ...n, // add the latest structure of the predefined network to include the new props that are not in storage yet
    //     ...(this.#networks[n.id] || {}), // override with stored props
    //     // attributes that should take predefined priority
    //     feeOptions: n.feeOptions,
    //     hasRelayer: n.hasRelayer,
    //     erc4337: {
    //       enabled: is4337Enabled(!!n.erc4337.hasBundlerSupport, n, this.#networks[n.id]?.force4337),
    //       hasPaymaster: n.erc4337.hasPaymaster,
    //       defaultBundler: n.erc4337.defaultBundler,
    //       bundlers: n.erc4337.bundlers,
    //       increasePreVerGas: n.erc4337.increasePreVerGas ?? 0
    //     },
    //     nativeAssetId: n.nativeAssetId,
    //     nativeAssetSymbol: n.nativeAssetSymbol
    //   }
    // });

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
console.log('networkId', networkId, 'network', network)
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
    this.#networks[network.chainId.toString()] = {
      id: networkId,
      ...network,
      ...info,
      feeOptions,
      features: getFeaturesByNetworkProperties(info),
      hasRelayer: false,
      predefined: false
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

  async removeNetwork(chainId: ChainId) {
    await this.initialLoadPromise
    console.log('removeNetwork',this.#networks)
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
