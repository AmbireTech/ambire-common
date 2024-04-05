/* eslint-disable no-underscore-dangle */
import { AMBIRE_ACCOUNT_FACTORY } from '../../consts/deploy'
import { networks } from '../../consts/networks'
import { Key } from '../../interfaces/keystore'
import {
  NetworkDescriptor,
  NetworkFeature,
  NetworkId,
  NetworkInfo,
  NetworkInfoLoading
} from '../../interfaces/networkDescriptor'
import {
  AccountPreferences,
  CustomNetwork,
  KeyPreferences,
  NetworkPreference,
  NetworkPreferences,
  RPCProviders
} from '../../interfaces/settings'
import { Storage } from '../../interfaces/storage'
import { getSASupport, simulateDebugTraceCall } from '../../libs/deployless/simulateDeployCall'
import { getFeaturesByNetworkProperties, getNetworkInfo } from '../../libs/settings/settings'
import { isValidAddress } from '../../services/address'
import { getRpcProvider } from '../../services/provider'
import wait from '../../utils/wait'
import EventEmitter from '../eventEmitter/eventEmitter'

export class SettingsController extends EventEmitter {
  accountPreferences: AccountPreferences = {}

  keyPreferences: KeyPreferences = []

  providers: RPCProviders = {}

  #networkPreferences: NetworkPreferences = {}

  #storage: Storage

  status: 'INITIAL' | 'LOADING' | 'SUCCESS' | 'DONE' = 'INITIAL'

  latestMethodCall: string | null = null

  networkToAddOrUpdate: {
    chainId: NetworkDescriptor['chainId']
    rpcUrls: NetworkDescriptor['rpcUrls']
    info?: NetworkInfoLoading<NetworkInfo>
  } | null = null

  constructor(storage: Storage) {
    super()
    this.#storage = storage

    this.#load()
  }

  #setProvider(network: NetworkDescriptor, newRpcUrls: string[]) {
    const provider = this.providers[network.id]

    // Only update the RPC if the new RPC is different from the current one
    // or if there is no RPC for this network yet.
    // eslint-disable-next-line no-underscore-dangle
    if (!provider || provider?._getConnection().url !== newRpcUrls[0]) {
      const oldRPC = this.providers[network.id]

      if (oldRPC) {
        // If an RPC fails once it will try to reconnect every second. If we don't destroy the old RPC
        // it will keep trying to reconnect forever.
        oldRPC.destroy()
      }

      this.providers[network.id] = getRpcProvider(newRpcUrls, network.chainId)
    }
  }

  get networks(): (NetworkDescriptor & (NetworkPreference | CustomNetwork))[] {
    // set the custom networks that do not exist in ambire-common networks
    const customPrefIds = Object.keys(this.#networkPreferences)
    const predefinedNetworkIds = networks.map((net) => net.id)
    const customNetworkIds = customPrefIds.filter((x) => !predefinedNetworkIds.includes(x))
    const customNetworks = customNetworkIds.map((id: NetworkId) => {
      // @ts-ignore
      // checked with the logic for customNetworkIds
      const customNetwork: CustomNetwork = this.#networkPreferences[id]
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

    const allNetworks = [...networks, ...customNetworks]

    // configure the main networks
    return allNetworks.map((network) => {
      const networkPreferences = this.#networkPreferences[network.id]
      this.#setProvider(network, networkPreferences?.rpcUrls || network.rpcUrls)
      const finalNetwork = networkPreferences
        ? {
            ...network,
            ...networkPreferences
          }
        : network

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

  updateProviderIsWorking(networkId: NetworkDescriptor['id'], isWorking: boolean) {
    this.providers[networkId].isWorking = isWorking

    this.emitUpdate()
  }

  async #load() {
    try {
      ;[this.accountPreferences, this.keyPreferences, this.#networkPreferences] = await Promise.all(
        [
          // Should get the storage data from all keys here
          this.#storage.get('accountPreferences', {}),
          this.#storage.get('keyPreferences', []),
          this.#storage.get('networkPreferences', {})
        ]
      )

      this.emitUpdate()
    } catch (e) {
      this.emitError({
        message:
          'Something went wrong when loading Ambire settings. Please try again or contact support if the problem persists.',
        level: 'major',
        error: new Error('settings: failed to pull settings from storage')
      })
    }
  }

  async #storePreferences() {
    try {
      await Promise.all([
        this.#storage.set('accountPreferences', this.accountPreferences),
        this.#storage.set('keyPreferences', this.keyPreferences),
        this.#storage.set('networkPreferences', this.#networkPreferences)
      ])
    } catch (e) {
      this.emitError({
        message:
          'Failed to store updated settings. Please try again or contact support if the problem persists.',
        level: 'major',
        error: new Error('settings: failed to store updated settings')
      })
    }
  }

  async addAccountPreferences(newAccountPreferences: AccountPreferences) {
    if (!Object.keys(newAccountPreferences).length) return

    if (Object.keys(newAccountPreferences).some((key) => !isValidAddress(key))) {
      return this.#throwInvalidAddress(Object.keys(newAccountPreferences))
    }

    // TODO: Check if this addresses exist in the imported addressed? Might be an overkill.
    // Update the account preferences with the new values incoming
    Object.keys(newAccountPreferences).forEach((key) => {
      this.accountPreferences[key] = {
        ...this.accountPreferences[key],
        ...newAccountPreferences[key]
      }
    })

    await this.#storePreferences()

    this.emitUpdate()
  }

  async addKeyPreferences(newKeyPreferences: KeyPreferences) {
    if (!newKeyPreferences.length) return

    if (newKeyPreferences.some(({ addr }) => !isValidAddress(addr))) {
      return this.#throwInvalidAddress(newKeyPreferences.map(({ addr }) => addr))
    }

    const nextKeyPreferences = [...this.keyPreferences]
    newKeyPreferences.forEach((newKey) => {
      const existingKeyPref = nextKeyPreferences.find(
        ({ addr, type }) => addr === newKey.addr && type === newKey.type
      )

      if (existingKeyPref) {
        existingKeyPref.label = newKey.label
      } else {
        nextKeyPreferences.push(newKey)
      }
    })
    this.keyPreferences = nextKeyPreferences

    await this.#storePreferences()
    this.emitUpdate()
  }

  async removeAccountPreferences(accountPreferenceKeys: Array<keyof AccountPreferences> = []) {
    if (!accountPreferenceKeys.length) return

    // There's nothing to delete
    if (!Object.keys(this.accountPreferences).length) return

    if (accountPreferenceKeys.some((key) => !isValidAddress(key))) {
      return this.#throwInvalidAddress(accountPreferenceKeys)
    }

    accountPreferenceKeys.forEach((key) => {
      // Cast to AccountPreferences, since above the case when the
      // accountPreferences is empty (and there is nothing to delete) is handled
      delete (this.accountPreferences as AccountPreferences)[key]
    })

    await this.#storePreferences()

    this.emitUpdate()
  }

  async removeKeyPreferences(keyPreferencesToRemove: { addr: Key['addr']; type: Key['type'] }[]) {
    if (!keyPreferencesToRemove.length) return

    // There's nothing to delete
    if (!this.keyPreferences.length) return

    if (keyPreferencesToRemove.some((key) => !isValidAddress(key.addr))) {
      return this.#throwInvalidAddress(keyPreferencesToRemove.map(({ addr }) => addr))
    }

    this.keyPreferences = this.keyPreferences.filter(
      (key) =>
        !keyPreferencesToRemove.some(({ addr, type }) => key.addr === addr && key.type === type)
    )

    await this.#storePreferences()
    this.emitUpdate()
  }

  setNetworkToAddOrUpdate(
    networkToAddOrUpdate: {
      chainId: NetworkDescriptor['chainId']
      rpcUrls: NetworkDescriptor['rpcUrls']
    } | null = null
  ) {
    if (networkToAddOrUpdate) {
      this.networkToAddOrUpdate = networkToAddOrUpdate
      this.emitUpdate()

      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      getNetworkInfo(networkToAddOrUpdate.rpcUrls, networkToAddOrUpdate.chainId, (info) => {
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

  // NOTE: used only for adding a new network. We add it to the user's
  // this.#networkPreferences as one day the custom network can be a part of
  // Ambire's main networks => the options in it will become a preference
  async #addCustomNetwork(customNetwork: CustomNetwork) {
    // mainCtrl.settings.setNetworkToAddOrUpdate
    if (
      !this.networkToAddOrUpdate?.info ||
      Object.values(this.networkToAddOrUpdate.info).some((prop) => prop === 'LOADING')
    ) {
      return
    }

    // make sure the network has not been added already
    const chainIds = this.networks.map((net) => net.chainId)
    if (chainIds.indexOf(BigInt(customNetwork.chainId)) !== -1) {
      throw new Error('settings: addCustomNetwork chain already added')
    }

    // make sure the id of the network is unique
    const customNetworkId = customNetwork.name.toLowerCase()
    const ids = this.networks.map((net) => net.id)
    if (ids.indexOf(customNetworkId) !== -1) {
      throw new Error('settings: addCustomNetwork chain already added')
    }

    const {
      isSAEnabled,
      isOptimistic,
      rpcNoStateOverride,
      hasDebugTraceCall,
      erc4337,
      areContractsDeployed,
      feeOptions,
      platformId,
      nativeAssetId,
      flagged,
      hasSingleton
    } = this.networkToAddOrUpdate.info as NetworkInfo

    this.#networkPreferences[customNetworkId] = {
      ...customNetwork,
      ...feeOptions,
      erc4337,
      isSAEnabled,
      areContractsDeployed,
      isOptimistic,
      rpcNoStateOverride,
      hasDebugTraceCall,
      platformId,
      nativeAssetId,
      flagged,
      hasSingleton
    }

    await this.#storePreferences()
    this.networkToAddOrUpdate = null
    this.emitUpdate()
  }

  async addCustomNetwork(customNetwork: CustomNetwork) {
    await this.#wrapSettingsAction('addCustomNetwork', () => this.#addCustomNetwork(customNetwork))
  }

  async removeCustomNetwork(id: NetworkDescriptor['id']) {
    if (networks.find((n) => n.id === id)) return

    delete this.#networkPreferences[id]
    this.providers?.[id]?.destroy()
    delete this.providers?.[id]
    await this.#storePreferences()
    this.emitUpdate()
  }

  async updateNetworkPreferences(
    networkPreferences: NetworkPreference,
    networkId: NetworkDescriptor['id']
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
      {}
    )

    // if the rpcUrls have changed, call the RPC and check whether it supports
    // state overrided. If it doesn't, add a warning
    if (changedNetworkPreferences.rpcUrls) {
      const network = this.networks.find((n) => n.id === networkId)
      const provider = getRpcProvider(changedNetworkPreferences.rpcUrls, network?.chainId)
      const [saSupport, hasDebugTraceCall] = await Promise.all([
        getSASupport(provider).catch(() => ({ supportsStateOverride: false })),
        simulateDebugTraceCall(provider)
      ])
      provider.destroy()
      changedNetworkPreferences.rpcNoStateOverride = !saSupport.supportsStateOverride
      changedNetworkPreferences.hasDebugTraceCall = hasDebugTraceCall
    }

    // Update the network preferences with the incoming new values
    this.#networkPreferences[networkId] = {
      ...this.#networkPreferences[networkId],
      ...changedNetworkPreferences
    }

    await this.#storePreferences()
    this.emitUpdate()
  }

  // NOTE: use this method only for predefined networks
  async resetNetworkPreference(key: keyof NetworkPreference, networkId: NetworkDescriptor['id']) {
    if (
      !networkId ||
      !(networkId in this.#networkPreferences) ||
      !(key in this.#networkPreferences[networkId])
    )
      return

    delete this.#networkPreferences[networkId][key]

    await this.#storePreferences()
    this.emitUpdate()
  }

  // call this function after a call to the singleton has been made
  // it will check if the factory has been deployed and update the
  // network settings if it has been
  async setContractsDeployedToTrueIfDeployed(network: NetworkDescriptor) {
    if (network.areContractsDeployed) return

    const provider = this.providers[network.id]
    const factoryCode = await provider.getCode(AMBIRE_ACCOUNT_FACTORY)
    if (factoryCode === '0x') return

    this.updateNetworkPreferences({ areContractsDeployed: true }, network.id).catch(() => {
      this.emitError({
        level: 'silent',
        message: 'Failed to update the network feature for supporting smart accounts',
        error: new Error(`settings: failed to set areContractsDeployed to true for ${network.id}`)
      })
    })
  }

  async #wrapSettingsAction(callName: string, fn: Function) {
    if (this.status === 'LOADING') return
    this.latestMethodCall = callName
    this.status = 'LOADING'
    this.emitUpdate()
    try {
      await fn()
      this.status = 'SUCCESS'
      this.emitUpdate()
    } catch (error: any) {
      if (error?.message === 'settings: addCustomNetwork chain already added') {
        this.emitError({
          message:
            'Failed to detect network, perhaps an RPC issue. Please change the RPC and try again.',
          level: 'major',
          error
        })
      } else if (error?.message === 'settings: failed to detect network') {
        this.emitError({
          message:
            'Failed to detect network, perhaps an RPC issue. Please change the RPC and try again.',
          level: 'major',
          error
        })
      } else if (
        error?.message === 'settings: initialized network before calling addCustomNetwork'
      ) {
        this.emitError({
          message:
            'Adding custom network failed because the network was not initialized properly. Please try again.',
          level: 'major',
          error
        })
      }
    }

    // set status in the next tick to ensure the FE receives the 'SUCCESS' status
    await wait(1)
    this.status = 'DONE'
    this.emitUpdate()

    // reset the status in the next tick to ensure the FE receives the 'DONE' status
    await wait(1)
    if (this.latestMethodCall === callName) {
      this.status = 'INITIAL'
      this.emitUpdate()
    }
  }

  #throwInvalidAddress(addresses: string[]) {
    return this.emitError({
      message:
        'Invalid account address incoming in the account preferences. Please try again or contact support if the problem persists.',
      level: 'major',
      error: new Error(
        `settings: invalid address in the account preferences keys incoming: ${addresses.join(
          ', '
        )}`
      )
    })
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      networks: this.networks,
      providers: this.providers
    }
  }
}
