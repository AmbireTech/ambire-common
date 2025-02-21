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
    const userNetworkPreferences: { [key: NetworkId]: UserNetworkPreferences } =
      await this.#storage.get(
        'network-preferences-v2', // TODO: Confirm the storage key name.
        {}
      )

    // Step 1: Merge the predefined networks with the user network preferences.
    const nextNetworks: { [key: NetworkId]: Network } = {}
    predefinedNetworks.forEach((n) => {
      const hasUserPreferences = !!userNetworkPreferences[n.id]

      nextNetworks[n.id] = {
        ...n,
        // Override with user preferences
        ...(hasUserPreferences ? userNetworkPreferences[n.id] : {})
      }
    })

    // Step 2: Merge the networks coming from the Relayer
    // TODO: Should this be awaited or not?
    try {
      const relayerNetworks: RelayerNetworkConfigResponse = await this.#callRelayer(
        '/v2/networks-config'
      )

      Object.entries(relayerNetworks).forEach(([chainId, relayerNetwork]) => {
        const n = mapRelayerNetworkConfigToAmbireNetwork(chainId, relayerNetwork)
        const hasNoUserPreferences = !userNetworkPreferences[n.id]
        const shouldOverrideNetworkPreferences =
          !hasNoUserPreferences &&
          // Mechanism to force an update network preferences if needed
          relayerNetwork.predefinedConfigVersion >
            userNetworkPreferences[n.id].predefinedConfigVersion

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
            ...userNetworkPreferences[n.id]
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

    // if force4337 is updated, we have to update the enabled flag as well
    if ('force4337' in changedNetwork) {
      this.#networks[networkId].erc4337.enabled = is4337Enabled(
        true,
        this.#networks[networkId],
        changedNetwork.force4337
      )
    }

    this.#onAddOrUpdateNetwork(this.#networks[networkId])
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
