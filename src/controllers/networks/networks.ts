import EmittableError from '../../classes/EmittableError'
import { networks as predefinedNetworks } from '../../consts/networks'
import { Fetch } from '../../interfaces/fetch'
import {
  AddNetworkRequestParams,
  Network,
  NetworkId,
  NetworkInfo,
  NetworkInfoLoading,
  RelayerNetworkConfigResponse,
  UserNetworkPreferences
} from '../../interfaces/network'
import { Storage } from '../../interfaces/storage'
import {
  getFeaturesByNetworkProperties,
  getNetworkInfo,
  is4337Enabled,
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

  #userNetworkPreferences: { [key: NetworkId]: UserNetworkPreferences } = {}

  #relayerNetworks: RelayerNetworkConfigResponse = {}

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

    const uniqueNetworksByChainId = Object.values(this.#networks).sort(
      (a, b) => +b.predefined - +a.predefined // predefined first
    )

    // TODO: Do this once, in the #load method?
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
    // TODO: Migrate the currently stored "networks" to the "network-preferences-v2 structure"

    // TODO: Pull the user network preferences.
    this.#userNetworkPreferences = await this.#storage.get(
      'network-preferences-v2', // TODO: Confirm the storage key name.
      {}
    )

    // Step 1: Merge the predefined networks with the user network preferences.
    const nextNetworks: { [key: NetworkId]: Network } = {}
    predefinedNetworks.forEach((n) => {
      const hasUserPreferences = !!this.#userNetworkPreferences[n.id]

      nextNetworks[n.id] = {
        ...n,
        // Override with user preferences
        ...(hasUserPreferences ? this.#userNetworkPreferences[n.id] : {})
      }
    })

    // Step 2: Merge the networks coming from the Relayer
    // TODO: Should this be awaited or not?
    try {
      this.#relayerNetworks = await this.#callRelayer('/v2/networks-config')

      Object.entries(this.#relayerNetworks).forEach(([chainId, relayerNetwork]) => {
        const n = mapRelayerNetworkConfigToAmbireNetwork(chainId, relayerNetwork)
        const hasNoUserPreferences = !this.#userNetworkPreferences[n.id]
        const shouldOverrideNetworkPreferences =
          !hasNoUserPreferences &&
          // Mechanism to force an update network preferences if needed
          relayerNetwork.predefinedConfigVersion >
            this.#userNetworkPreferences[n.id].predefinedConfigVersion

        if (hasNoUserPreferences || shouldOverrideNetworkPreferences) {
          nextNetworks[n.id] = { ...nextNetworks[n.id], ...n }
        } else {
          // Override the predefined network config, but keep user preferences,
          // one might not exist in the case of a new network coming from the relayer
          const predefinedNetwork: Network | {} =
            predefinedNetworks.find((pN) => pN.id === n.id) || {}

          nextNetworks[n.id] = {
            ...predefinedNetwork,
            ...n,
            ...this.#userNetworkPreferences[n.id]
          }
        }
      })
    } catch (e: any) {
      // Fail silently
    }

    this.#networks = nextNetworks
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

  async #updateNetwork(_userNetworkPrefToUpdate: UserNetworkPreferences, networkId: NetworkId) {
    await this.initialLoadPromise
    if (!Object.keys(_userNetworkPrefToUpdate).length) return // nothing to update

    const network = this.#networks[networkId]
    const networkPrefToUpdate: UserNetworkPreferences = {
      ..._userNetworkPrefToUpdate,
      // When adding user preferences, store the predefined config version on
      // which the update was set. This ensures that we can track which version
      // of the predefined network configuration the user preferences are based on.
      // TODO: What would happen if this.#relayerNetworks req initially failed?
      predefinedConfigVersion: this.#relayerNetworks[`${network.chainId}`]
        ? this.#relayerNetworks[`${network.chainId}`].predefinedConfigVersion
        : // default to 0, indicating there is no predefined configuration v associated with this update
          0,
      // In case of an update, merge newly added RPC urls with the existing ones, not to lose any
      ...(_userNetworkPrefToUpdate.rpcUrls && {
        rpcUrls: [...new Set([...network.rpcUrls, ..._userNetworkPrefToUpdate.rpcUrls])]
      })
    }

    this.#userNetworkPreferences[networkId] = {
      ...this.#userNetworkPreferences[networkId],
      ...networkPrefToUpdate
    }
    await this.#storage.set('network-preferences-v2', this.#userNetworkPreferences)

    const nextNetwork: Network = { ...network, ...networkPrefToUpdate }
    // TODO: Maybe run getFeaturesByNetworkProperties instead?
    // if force4337 is updated, we have to update the enabled flag as well
    if ('force4337' in networkPrefToUpdate) {
      nextNetwork.erc4337.enabled = is4337Enabled(
        true,
        this.#networks[networkId],
        nextNetwork.force4337
      )
    }

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
      if (nextNetwork.selectedRpcUrl) {
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
          nextNetwork.selectedRpcUrl,
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
