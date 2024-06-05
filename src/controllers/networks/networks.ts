import { networks as predefinedNetworks } from '../../consts/networks'
import { Network, NetworkId, NetworkInfo, NetworkInfoLoading } from '../../interfaces/network'
import { Storage } from '../../interfaces/storage'
import { getFeaturesByNetworkProperties } from '../../libs/settings/settings'
import EventEmitter, { Statuses } from '../eventEmitter/eventEmitter'

const STATUS_WRAPPED_METHODS = {
  addCustomNetwork: 'INITIAL',
  updateNetwork: 'INITIAL'
} as const

export class NetworksController extends EventEmitter {
  #storage: Storage

  #networks: Network[]

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

  get networks(): Network[] {
    // set the custom networks that do not exist in ambire-common networks
    const customPrefIds = Object.keys(this.#networks)
    const predefinedNetworkIds = predefinedNetworks.map((net) => net.id)
    const customNetworkIds = customPrefIds.filter((x) => !predefinedNetworkIds.includes(x))
    const customNetworks = customNetworkIds.map((id: NetworkId) => {
      // @ts-ignore
      // checked with the logic for customNetworkIds
      const customNetwork = this.#networks[id]
      const features: NetworkFeature[] = []

      return {
        id,
        unstoppableDomainsChain: 'ERC20',
        name: customNetwork.name,
        nativeAssetSymbol: customNetwork.nativeAssetSymbol,
        rpcUrls: customNetwork.rpcUrls,
        chainId: customNetwork.chainId,
        explorerUrl: customNetwork.explorerUrl,
        erc4337: customNetwork.erc4337 ?? { enabled: false, hasPaymaster: false },
        isSAEnabled: customNetwork.isSAEnabled ?? false,
        areContractsDeployed: customNetwork.areContractsDeployed ?? false,
        isOptimistic: customNetwork.isOptimistic ?? false,
        rpcNoStateOverride: customNetwork.rpcNoStateOverride ?? true,
        hasDebugTraceCall: customNetwork.hasDebugTraceCall ?? false,
        platformId: customNetwork.platformId ?? '',
        nativeAssetId: customNetwork.nativeAssetId ?? '',
        flagged: customNetwork.flagged ?? false,
        feeOptions: customNetwork.feeOptions ?? {
          is1559: false
        },
        features,
        hasRelayer: false,
        hasSingleton: customNetwork.hasSingleton ?? false
      }
    })

    const allNetworks = [...predefinedNetworks, ...customNetworks]

    // configure the main networks
    return allNetworks.map((network) => {
      const networkPreferences = this.#networks[network.id]

      // erc4337 settings should not be inherited from networkPreferences
      // for predefined networks
      if (
        predefinedNetworkIds.includes(network.id) &&
        networkPreferences &&
        'erc4337' in networkPreferences
      )
        delete networkPreferences.erc4337

      const selectedRpcUrl =
        networkPreferences?.selectedRpcUrl || networkPreferences?.rpcUrls?.[0] || network.rpcUrls[0]

      const finalNetwork = networkPreferences
        ? {
            ...network,
            ...networkPreferences,
            selectedRpcUrl
          }
        : {
            ...network,
            selectedRpcUrl
          }

      const info: NetworkInfo = {
        isSAEnabled: finalNetwork.isSAEnabled,
        isOptimistic: finalNetwork.isOptimistic ?? false,
        rpcNoStateOverride: finalNetwork.rpcNoStateOverride,
        erc4337: finalNetwork.erc4337,
        areContractsDeployed: finalNetwork.areContractsDeployed,
        feeOptions: finalNetwork.feeOptions,
        hasDebugTraceCall: finalNetwork.hasDebugTraceCall,
        platformId: finalNetwork.platformId,
        nativeAssetId: finalNetwork.nativeAssetId,
        flagged: finalNetwork.flagged ?? false,
        chainId: finalNetwork.chainId,
        hasSingleton: finalNetwork.hasSingleton
      }

      finalNetwork.features = getFeaturesByNetworkProperties(info)
      return finalNetwork
    })
  }

  async #load() {
    const networkPreferences = await this.#storage.get('networkPreferences', {})
    this.#networks = this.#migrateNetworkPreferences(networkPreferences)
    this.emitUpdate()
  }

  // eslint-disable-next-line class-methods-use-this
  #migrateNetworkPreferences(networkPreferencesOldFormat: {
    [key in NetworkId]: Network & { rpcUrl?: string }
  }) {
    const modifiedNetworks: Network[] = {}
    // eslint-disable-next-line no-restricted-syntax
    for (const [networkId, network] of Object.entries(networkPreferencesOldFormat)) {
      if (network.rpcUrl && !network.rpcUrls) {
        modifiedNetworks[networkId] = { ...network, rpcUrls: [network.rpcUrl] }
      } else {
        modifiedNetworks[networkId] = network
      }
    }

    return modifiedNetworks
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

  async #addCustomNetwork(customNetwork: Network) {
    if (
      !this.networkToAddOrUpdate?.info ||
      Object.values(this.networkToAddOrUpdate.info).some((prop) => prop === 'LOADING')
    ) {
      return
    }
    const chainIds = this.networks.map((net) => net.chainId)
    const customNetworkId = customNetwork.name.toLowerCase()
    const ids = this.networks.map((net) => net.id)

    // make sure the id and chainId of the network are unique
    if (
      ids.indexOf(customNetworkId) !== -1 ||
      chainIds.indexOf(BigInt(customNetwork.chainId)) !== -1
    ) {
      throw new EmittableError({
        message: 'The network you are trying to add has already been added.',
        level: 'major',
        error: new Error('settings: addCustomNetwork chain already added (duplicate id/chainId)')
      })
    }

    const info = { ...(this.networkToAddOrUpdate.info as NetworkInfo) }
    const { feeOptions } = info

    // eslint-disable-next-line no-param-reassign
    delete (info as any).feeOptions

    this.#networks[customNetworkId] = {
      ...customNetwork,
      ...info,
      ...feeOptions
    }

    await this.#storage.set('networkPreferences', this.#networks)
    this.networkToAddOrUpdate = null
    this.emitUpdate()
  }

  async addCustomNetwork(customNetwork: CustomNetwork) {
    await this.withStatus(this.addCustomNetwork.name, () => this.#addCustomNetwork(customNetwork))
  }

  async removeCustomNetwork(id: NetworkId) {
    if (networks.find((n) => n.id === id)) return

    delete this.#networks[id]
    this.providers?.[id]?.destroy()
    delete this.providers?.[id]
    await this.#storage.set('networkPreferences', this.#networks)
    this.emitUpdate()
  }

  async #updateNetworkPreferences(
    networkPreferences: Partial<NetworkPreference>,
    networkId: NetworkId
  ) {
    if (!Object.keys(networkPreferences).length) return

    const networkData = this.networks.find((network) => network.id === networkId)

    const changedNetworkPreferences: NetworkPreference = Object.keys(networkPreferences).reduce(
      (acc, key) => {
        if (!networkData) return acc

        // No need to save unchanged network preferences.
        // Here we filter the network preferences that are the same as the ones in the storage.
        if (
          networkPreferences[key as keyof NetworkPreference] ===
          networkData[key as keyof NetworkPreference]
        )
          return acc

        return { ...acc, [key]: networkPreferences[key as keyof NetworkPreference] }
      },
      {} as NetworkPreference
    )

    // Update the network preferences with the incoming new values
    this.#networks[networkId] = { ...this.#networks[networkId], ...changedNetworkPreferences }

    await this.#storage.set('networkPreferences', this.#networks)

    this.emitUpdate()

    // Do not wait the rpc validation in order to complete the execution of updateNetworkPreferences
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    ;(async () => {
      // if the rpcUrls have changed, call the RPC and check whether it supports
      // state overrided. If it doesn't, add a warning
      if (changedNetworkPreferences.selectedRpcUrl) {
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
          changedNetworkPreferences.selectedRpcUrl,
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

  async updateNetworkPreferences(networkPreferences: Partial<Network>, networkId: NetworkId) {
    await this.withStatus(this.updateNetworkPreferences.name, () =>
      this.#updateNetworkPreferences(networkPreferences, networkId)
    )
  }

  // NOTE: use this method only for predefined networks
  async resetNetworkPreference(key: keyof Network, networkId: NetworkId) {
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
