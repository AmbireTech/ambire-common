import EmittableError from '../../classes/EmittableError'
import {
  IRecurringTimeout,
  RecurringTimeout
} from '../../classes/recurringTimeout/recurringTimeout'
import { NETWORKS_UPDATE_INTERVAL } from '../../consts/intervals'
import { networks as predefinedNetworks } from '../../consts/networks'
import { testnetNetworks as predefinedTestnetNetworks } from '../../consts/testnetNetworks'
import { IEventEmitterRegistryController, Statuses } from '../../interfaces/eventEmitter'
import { Fetch } from '../../interfaces/fetch'
import {
  AddNetworkRequestParams,
  ChainId,
  INetworksController,
  Network,
  NetworkInfo,
  NetworkInfoLoading,
  RelayerNetworkConfigResponse
} from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import { IStorageController } from '../../interfaces/storage'
import {
  getFeaturesByNetworkProperties,
  getNetworkInfo,
  getNetworksUpdatedWithRelayerNetworks,
  getValidNetworks
} from '../../libs/networks/networks'
import { relayerCall } from '../../libs/relayerCall/relayerCall'
import EventEmitter from '../eventEmitter/eventEmitter'

export const STATUS_WRAPPED_METHODS = {
  addNetwork: 'INITIAL',
  updateNetwork: 'INITIAL'
} as const

/**
 * The NetworksController is responsible for managing networks. It handles both predefined networks and those
 * that users can add either through a dApp request or manually via the UI. This controller provides functions
 * for adding, updating, and removing networks.
 */
export class NetworksController extends EventEmitter implements INetworksController {
  // To enable testnet-only mode, pass defaultNetworksMode = 'testnet' when constructing the NetworksController in the MainController.
  // On a fresh installation of the extension, the testnetNetworks constants will be used to initialize the NetworksController.
  // Adding custom networks remains possible in testnet mode, as no network filtering is applied.
  defaultNetworksMode: 'mainnet' | 'testnet' = 'mainnet'

  #storage: IStorageController

  #fetch: Fetch

  #callRelayer: Function

  #networks: { [key: string]: Network } = {}

  statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS> = STATUS_WRAPPED_METHODS

  networkToAddOrUpdate: {
    chainId: Network['chainId']
    rpcUrl: string
    info?: NetworkInfoLoading<NetworkInfo>
  } | null = null

  areNetworksFetchingFromRelayer: boolean = false

  #useTempProvider: (
    props: {
      rpcUrl: string
      chainId: bigint
    },
    callback: (provider: RPCProvider) => Promise<void>
  ) => Promise<void>

  /** Callback that gets called when adding or updating network */
  #onAddOrUpdateNetworks: (networks: Network[]) => void | Promise<void>

  #onReady: () => Promise<void>

  // Holds the initial load promise, so that one can wait until it completes
  initialLoadPromise?: Promise<void>

  #updateWithRelayerNetworksInterval: IRecurringTimeout

  constructor({
    eventEmitterRegistry,
    defaultNetworksMode,
    storage,
    fetch,
    relayerUrl,
    useTempProvider,
    onAddOrUpdateNetworks,
    onReady
  }: {
    eventEmitterRegistry?: IEventEmitterRegistryController
    defaultNetworksMode?: 'mainnet' | 'testnet'
    storage: IStorageController
    fetch: Fetch
    relayerUrl: string
    useTempProvider: (
      props: {
        rpcUrl: string
        chainId: bigint
      },
      callback: (provider: RPCProvider) => Promise<void>
    ) => Promise<void>
    onAddOrUpdateNetworks: (networks: Network[]) => void | Promise<void>
    onReady: () => Promise<void>
  }) {
    super(eventEmitterRegistry)
    if (defaultNetworksMode) this.defaultNetworksMode = defaultNetworksMode
    this.#storage = storage
    this.#fetch = fetch
    this.#callRelayer = relayerCall.bind({ url: relayerUrl, fetch })
    this.#useTempProvider = useTempProvider
    this.#onAddOrUpdateNetworks = onAddOrUpdateNetworks
    this.#onReady = onReady

    this.initialLoadPromise = this.#load().finally(() => {
      this.initialLoadPromise = undefined
    })

    /**
     * Schedules periodic network synchronization.
     *
     * This function ensures that the `synchronizeNetworks` method runs every 8 hours
     * to periodically refetch networks in case there are updates,
     * since the extension relies on the config from relayer.
     */
    this.#updateWithRelayerNetworksInterval = new RecurringTimeout(
      this.synchronizeNetworks.bind(this),
      NETWORKS_UPDATE_INTERVAL,
      this.emitError.bind(this)
    )
    if (this.defaultNetworksMode === 'mainnet') {
      this.#updateWithRelayerNetworksInterval.start()
    }
  }

  get isInitialized(): boolean {
    return !!Object.keys(this.#networks).length
  }

  get allNetworks(): Network[] {
    if (!Object.keys(this.#networks).length) {
      return this.defaultNetworksMode === 'mainnet' ? predefinedNetworks : predefinedTestnetNetworks
    }

    const uniqueNetworksByChainId = Object.values(this.#networks)
      .sort((a, b) => +b.predefined - +a.predefined) // first predefined
      .filter((item, index, self) => self.findIndex((i) => i.chainId === item.chainId) === index) // unique by chainId (predefined with priority)

    return uniqueNetworksByChainId.map((network) => {
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

  get networks(): Network[] {
    return this.allNetworks.filter((network) => !network.disabled)
  }

  get disabledNetworks(): Network[] {
    return this.allNetworks.filter((network) => network.disabled)
  }

  async getNetworksInStorage(): Promise<{ [key: string]: Network }> {
    const rawNetworksInStorage: { [key: string]: Network } = await this.#storage.get('networks', {})

    return getValidNetworks(rawNetworksInStorage)
  }

  /**
   * Loads the network configurations for the initial load.
   *
   * This method performs the following steps:
   * 1. Retrieves the latest network configurations from storage.
   * 2. Seeds the networks from storage, or from the predefined networks on a fresh
   *    install (instantiating the RPC providers via `#onReady` in that case).
   * 3. Persists the seeded networks and updates network features asynchronously.
   * 4. Triggers `synchronizeNetworks` in the BACKGROUND (not awaited) to merge the
   *    latest configuration from the Relayer.
   *
   * The relayer merge is intentionally not awaited so that `initialLoadPromise`
   * resolves with the stored networks immediately — keeping the relayer fetch off
   * the critical path of controllers that gate the mobile splash hide. The merge,
   * provider swap and portfolio reload for any changed networks all happen in
   * `synchronizeNetworks`.
   */
  async #load() {
    // Step 1. Get latest storage (networksInStorage) and validate/normalize
    const networksInStorage = await this.getNetworksInStorage()

    // Step 2. Seed the networks from storage (or predefined on a fresh install).
    // The relayer refresh is intentionally NOT awaited here (see Step 4) so that
    // the initial load resolves immediately with the stored networks. This keeps
    // the relayer fetch (/v2/config/networks, up to a 5s timeout) off the critical
    // path of controllers that await `initialLoadPromise` (accounts →
    // selectedAccount), which on mobile gate the splash hide.
    if (!Object.keys(networksInStorage).length) {
      const defaultNetworks =
        this.defaultNetworksMode === 'mainnet' ? predefinedNetworks : predefinedTestnetNetworks
      this.#networks = defaultNetworks.reduce(
        (acc, network) => {
          acc[network.chainId.toString()] = network
          return acc
        },
        {} as { [key: string]: Network }
      )
      // Instantiate the RPC providers from the seeded networks before resolving.
      await this.#onReady()
    } else {
      this.#networks = Object.fromEntries(
        Object.values(networksInStorage).map((network) => [network.chainId.toString(), network])
      )
    }

    this.emitUpdate()
    await this.#storage.set('networks', this.#networks)

    // Step 3: Update networks features asynchronously
    this.#updateNetworkFeatures(this.#networks)

    // Step 4: Refresh from the Relayer in the background (RPC URLs may have
    // changed). `synchronizeNetworks` merges the relayer config, swaps providers
    // and reloads the portfolio for any changed networks, and toggles
    // `areNetworksFetchingFromRelayer` so the dashboard can hold the balance in a
    // loading state until the fresh data lands. Not awaited so `initialLoadPromise`
    // resolves now. (Skipped in testnet mode by `synchronizeNetworks` itself.)
    this.synchronizeNetworks().catch((error) =>
      this.emitError({
        level: 'silent',
        message: 'Failed to refresh the networks configuration from the Relayer.',
        error
      })
    )
  }

  /**
   * Processes network updates, finalizes changes, and updates network features asynchronously.
   * Used for periodically network synchronization.
   */
  async synchronizeNetworks() {
    if (this.defaultNetworksMode === 'testnet') return

    this.areNetworksFetchingFromRelayer = true
    this.emitUpdate()

    try {
      // Process updates (merge Relayer data and apply rules)
      const { mergedNetworks, updatedNetworkChainIds } = await this.mergeRelayerNetworks(
        this.#networks
      )

      // Finalize updates
      this.#networks = mergedNetworks
      this.emitUpdate()
      await this.#storage.set('networks', this.#networks)

      // We must call this after merging the local networks with the ones from the Relayer
      // to ensure that RPC providers of newly enabled networks are instantiated.
      // Awaited so `areNetworksFetchingFromRelayer` stays true until the portfolio
      // reload triggered by the updated RPCs has finished — otherwise the flag would
      // flip to false before the reload re-enters its loading state, briefly exposing
      // a balance (and warnings) computed from the old RPCs that were potentially being replaced.
      if (updatedNetworkChainIds.length) {
        await this.#onAddOrUpdateNetworks(
          this.allNetworks.filter((n) => updatedNetworkChainIds.includes(n.chainId))
        )
      }
      // Asynchronously update network features
      this.#updateNetworkFeatures(mergedNetworks)
    } finally {
      this.areNetworksFetchingFromRelayer = false
      this.emitUpdate()
    }
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
  async mergeRelayerNetworks(currentNetworks: { [key: string]: Network }): Promise<{
    mergedNetworks: { [key: string]: Network }
    updatedNetworkChainIds: Network['chainId'][]
  }> {
    let relayerNetworks: RelayerNetworkConfigResponse = {}
    try {
      const res = await Promise.race([
        this.#callRelayer('/v2/config/networks'),
        new Promise((_, reject) => {
          setTimeout(
            () => reject(new Error('Relayer call to /v2/config/networks timed out after 5000ms')),
            5000
          )
        })
      ])
      relayerNetworks = res.data.extensionConfigNetworks

      return getNetworksUpdatedWithRelayerNetworks(currentNetworks, relayerNetworks)
    } catch (e: any) {
      console.error('Failed to fetch networks from the Relayer', e)
    }

    return {
      mergedNetworks: currentNetworks,
      updatedNetworkChainIds: []
    }
  }

  /**
   * Updates network features asynchronously if needed.
   */
  async #updateNetworkFeatures(finalNetworks: { [key: string]: Network }) {
    const updatePromises = Object.values(finalNetworks).map(async (network) => {
      if (network.isSAEnabled) return

      if (
        network.lastUpdatedNetworkInfo &&
        Date.now() - network.lastUpdatedNetworkInfo <= 24 * 60 * 60 * 1000
      )
        return

      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.#useTempProvider(
        {
          chainId: network.chainId,
          rpcUrl: network.selectedRpcUrl
        },
        async (provider) => {
          await getNetworkInfo(
            this.#fetch,
            network.chainId,
            provider,
            async (info) => {
              if (Object.values(info).some((prop) => prop === 'LOADING')) {
                return
              }

              // If RPC is flagged there might be an issue with the RPC
              // this information will fail to return
              // and we dont want to update lastUpdatedNetworkInfo
              const chainId = network.chainId.toString()
              if (info.flagged || !this.#networks[chainId]) return
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
        }
      )
    })

    await Promise.all(updatePromises)
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

      await this.#useTempProvider(
        { chainId: networkToAddOrUpdate.chainId, rpcUrl: networkToAddOrUpdate.rpcUrl },
        async (provider) => {
          await getNetworkInfo(
            this.#fetch,
            networkToAddOrUpdate.chainId,
            provider,
            (info) => {
              if (this.networkToAddOrUpdate) {
                this.networkToAddOrUpdate = { ...this.networkToAddOrUpdate, info }
                this.emitUpdate()
              }
            },
            this.#networks[networkToAddOrUpdate.chainId.toString()]
          )
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

    const chainIds = this.allNetworks.map((net) => net.chainId)
    // make sure the id and chainId of the network are unique
    if (chainIds.indexOf(BigInt(network.chainId)) !== -1) {
      throw new EmittableError({
        message: 'The network you are trying to add has already been added.',
        level: 'expected',
        error: new Error('settings: addNetwork chain already added (duplicate id/chainId)')
      })
    }

    const info = { ...(this.networkToAddOrUpdate.info as NetworkInfo) }
    const { feeOptions } = info

    // @ts-expect-error
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

    void this.#onAddOrUpdateNetworks([this.#networks[network.chainId.toString()]!])

    await this.#storage.set('networks', this.#networks)
    this.networkToAddOrUpdate = null
    this.emitUpdate()
  }

  async addNetwork(network: AddNetworkRequestParams) {
    await this.withStatus('addNetwork', () => this.#addNetwork(network))
  }

  async #updateNetwork(network: Partial<Network>, chainId: ChainId, skipUpdate?: boolean) {
    await this.initialLoadPromise

    if (!Object.keys(network).length) return

    const networkData = this.allNetworks.find((n) => n.chainId === chainId)
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

    await this.#storage.set('networks', this.#networks)

    if (!skipUpdate) void this.#onAddOrUpdateNetworks([this.#networks[chainId.toString()]!])

    const checkRPC = async (
      networkToAddOrUpdate: {
        chainId: bigint
        rpcUrl: string
        info?: NetworkInfoLoading<NetworkInfo> | undefined
      } | null
    ) => {
      if (changedNetwork.selectedRpcUrl) {
        const stringChainId = chainId.toString()
        if (!this.#networks[stringChainId]) return

        if (
          networkToAddOrUpdate?.info &&
          Object.values(networkToAddOrUpdate.info).every((prop) => prop !== 'LOADING')
        ) {
          const info = { ...(networkToAddOrUpdate.info as NetworkInfo) }
          const { feeOptions } = info

          delete (info as any).feeOptions
          this.#networks[stringChainId] = {
            ...this.#networks[stringChainId],
            ...info,
            ...feeOptions
          }

          await this.#storage.set('networks', this.#networks)

          this.emitUpdate()
          return
        }

        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.#useTempProvider(
          {
            chainId,
            rpcUrl: changedNetwork.selectedRpcUrl
          },
          async (provider) => {
            await getNetworkInfo(
              this.#fetch,
              chainId,
              provider,
              async (info) => {
                if (Object.values(info).some((prop) => prop === 'LOADING')) {
                  return
                }

                const { feeOptions } = info as NetworkInfo

                delete (info as any).feeOptions
                this.#networks[stringChainId] = {
                  ...(this.#networks[stringChainId] as Network),
                  ...(info as NetworkInfo),
                  ...feeOptions
                }

                await this.#storage.set('networks', this.#networks)

                this.emitUpdate()
              },
              this.#networks[stringChainId]
            )
          }
        )
      }
    }

    // Do not wait the rpc validation in order to complete the execution of updateNetwork
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    checkRPC(this.networkToAddOrUpdate)
    this.networkToAddOrUpdate = null

    if (!skipUpdate) this.emitUpdate()
  }

  async updateNetwork(network: Partial<Network>, chainId: ChainId) {
    await this.withStatus('updateNetwork', () => this.#updateNetwork(network, chainId))
  }

  async disableHeliosProvider(chainId: ChainId) {
    await this.#updateNetwork({ useHeliosProvider: false }, chainId, true)
    this.emitUpdate()
  }

  async #updateNetworks(network: Partial<Network>, chainIds: ChainId[]) {
    await Promise.all(chainIds.map((chainId) => this.#updateNetwork(network, chainId, true)))
    void this.#onAddOrUpdateNetworks(this.allNetworks.filter((n) => chainIds.includes(n.chainId)))
    this.emitUpdate()
  }

  async updateNetworks(network: Partial<Network>, chainIds: ChainId[]) {
    await this.withStatus('updateNetwork', () => this.#updateNetworks(network, chainIds))
  }

  /**
   * @deprecated - users can no longer remove networks from the UI
   */
  async removeNetwork(chainId: ChainId) {
    await this.initialLoadPromise

    if (!this.#networks[chainId.toString()]) return
    delete this.#networks[chainId.toString()]
    await this.#storage.set('networks', this.#networks)
    this.emitUpdate()
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      isInitialized: this.isInitialized,
      networks: this.networks,
      disabledNetworks: this.disabledNetworks,
      allNetworks: this.allNetworks
    }
  }
}
