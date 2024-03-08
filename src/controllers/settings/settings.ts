import { Contract, JsonRpcProvider, ZeroAddress } from 'ethers'

import AmbireAccountFactory from '../../../contracts/compiled/AmbireAccountFactory.json'
import EntryPointAbi from '../../../contracts/compiled/EntryPoint.json'
import {
  AMBIRE_ACCOUNT_FACTORY,
  AMBIRE_PAYMASTER,
  DEPLOYLESS_SIMULATION_FROM,
  ERC_4337_ENTRYPOINT,
  OPTIMISTIC_ORACLE,
  SINGLETON
} from '../../consts/deploy'
import { networks } from '../../consts/networks'
import { Key } from '../../interfaces/keystore'
import { NetworkDescriptor, NetworkId } from '../../interfaces/networkDescriptor'
import {
  AccountPreferences,
  CustomNetwork,
  KeyPreferences,
  NetworkPreference,
  NetworkPreferences,
  RPCProviders
} from '../../interfaces/settings'
import { Storage } from '../../interfaces/storage'
import { getSmartAccount, getSpoof } from '../../libs/account/account'
import { callToTuple } from '../../libs/accountOp/accountOp'
import { DeploylessMode, fromDescriptor } from '../../libs/deployless/deployless'
import { getActivatorCall } from '../../libs/userOperation/userOperation'
import { isValidAddress } from '../../services/address'
import { Bundler } from '../../services/bundlers/bundler'
import EventEmitter from '../eventEmitter/eventEmitter'

export class SettingsController extends EventEmitter {
  accountPreferences: AccountPreferences = {}

  keyPreferences: KeyPreferences = []

  providers: RPCProviders = {}

  #networkPreferences: NetworkPreferences = {}

  #storage: Storage

  constructor(storage: Storage) {
    super()
    this.#storage = storage

    this.#load()
  }

  get networks(): NetworkDescriptor[] {
    const setProvider = (networkId: NetworkId, newRpcUrl: string) => {
      const provider = this.providers[networkId]

      // Only update the RPC if the new RPC is different from the current one
      // or if there is no RPC for this network yet.
      // eslint-disable-next-line no-underscore-dangle
      if (!provider || provider?._getConnection().url !== newRpcUrl) {
        const oldRPC = this.providers[networkId]

        if (oldRPC) {
          // If an RPC fails once it will try to reconnect every second. If we don't destroy the old RPC
          // it will keep trying to reconnect forever.
          oldRPC.destroy()
        }

        this.providers[networkId] = new JsonRpcProvider(newRpcUrl)
      }
    }

    // set the custom networks that do not exist in ambire-common networks
    const customPrefIds = Object.keys(this.#networkPreferences)
    const predefinedNetworkIds = networks.map((net) => net.id)
    const customNetworkIds = customPrefIds.filter((x) => !predefinedNetworkIds.includes(x))
    const customNetworks = customNetworkIds.map((id: NetworkId) => {
      const customNetwork: NetworkDescriptor = {
        name: this.#networkPreferences[id].name ?? '',
        nativeAssetSymbol: this.#networkPreferences[id].nativeAssetSymbol ?? '',
        rpcUrl: this.#networkPreferences[id].rpcUrl ?? '',
        chainId: this.#networkPreferences[id].chainId ?? 0n,
        explorerUrl: this.#networkPreferences[id].explorerUrl ?? '',
        erc4337: this.#networkPreferences[id].erc4337 ?? null,
        isSAEnabled: this.#networkPreferences[id].isSAEnabled ?? false,
        isOptimistic: this.#networkPreferences[id].isOptimistic ?? false,
        id,
        rpcNoStateOverride: false,
        unstoppableDomainsChain: 'ERC20',
        feeOptions: this.#networkPreferences[id].feeOptions ?? {
          is1559: false
        }
      }
      setProvider(id, customNetwork.rpcUrl)
      return customNetwork
    })

    // configure the main networks
    const mainNetworks = networks.map((network) => {
      const networkPreferences = this.#networkPreferences[network.id]
      setProvider(network.id, networkPreferences?.rpcUrl || network.rpcUrl)

      if (networkPreferences) {
        return {
          ...network,
          ...networkPreferences
        }
      }
      return network
    })

    return [...mainNetworks, ...customNetworks]
  }

  updateProviderIsWorking(networkId: NetworkDescriptor['id'], isWorking: boolean) {
    this.providers[networkId].isWorking = isWorking

    this.emitUpdate()
  }

  async #load() {
    try {
      // @ts-ignore
      ;[this.accountPreferences, this.keyPreferences, this.#networkPreferences] = await Promise.all(
        [
          // Should get the storage data from all keys here
          this.#storage.get('accountPreferences', {}),
          this.#storage.get('keyPreferences', []),
          this.#storage.get('networkPreferences', {})
        ]
      )
    } catch (e) {
      this.emitError({
        message:
          'Something went wrong when loading Ambire settings. Please try again or contact support if the problem persists.',
        level: 'major',
        error: new Error('settings: failed to pull settings from storage')
      })
    }

    this.emitUpdate()
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
        ({ addr, label }) => addr === newKey.addr && label === newKey.label
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

  // NOTE: used only for adding a new network. We add it to the user's
  // this.#networkPreferences as one day the custom network can be a part of
  // Ambire's main networks => the options in it will become a preference
  async addCustomNetwork(customNetwork: CustomNetwork) {
    // make sure the network has not been added already
    const chainIds = this.networks.map((net) => net.chainId)
    if (chainIds.indexOf(BigInt(customNetwork.chainId)) !== -1) {
      this.emitError({
        message: `A chain with a chain id of ${customNetwork.chainId} has already been added`,
        level: 'major',
        error: new Error('settings: addCustomNetwork chain already added')
      })
      this.emitUpdate()
      return
    }

    try {
      const provider = new JsonRpcProvider(customNetwork.rpcUrl)
      const deploylessOptions = {
        blockTag: 'latest',
        from: DEPLOYLESS_SIMULATION_FROM,
        // very important to send to the AMBIRE_ACCOUNT_FACTORY
        // or else the SA address won't match
        to: AMBIRE_ACCOUNT_FACTORY,
        mode: DeploylessMode.StateOverride
      }
      const deployless = fromDescriptor(provider, AmbireAccountFactory, true)
      const smartAccount = await getSmartAccount([
        {
          addr: DEPLOYLESS_SIMULATION_FROM,
          hash: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
        }
      ])
      const [entryPointCode, singletonCode, oracleCode, hasBundler, block, deploylessRes] =
        await Promise.all([
          provider.getCode(ERC_4337_ENTRYPOINT),
          provider.getCode(SINGLETON),
          provider.getCode(OPTIMISTIC_ORACLE),
          Bundler.isNetworkSupported(customNetwork.chainId),
          provider.getBlock('latest'),
          deployless
            .call(
              'deployAndExecute',
              [
                smartAccount.creation!.bytecode,
                smartAccount.creation!.salt,
                [callToTuple(getActivatorCall(smartAccount.addr))],
                getSpoof(smartAccount)
              ],
              deploylessOptions
            )
            .catch(() => {
              // if there's an error, return the zero address indicating that
              // our smart accounts will most likely not work on this chain
              return [ZeroAddress]
            })
        ])
      const deploylessSuccess = deploylessRes[0] === smartAccount.addr
      const has4337 = entryPointCode !== '0x' && hasBundler
      let hasPaymaster = false
      if (has4337) {
        const entryPoint = new Contract(ERC_4337_ENTRYPOINT, EntryPointAbi, provider)
        const paymasterBalance = await entryPoint.balanceOf(AMBIRE_PAYMASTER)
        hasPaymaster = paymasterBalance.toString() > 0
      }
      const erc4337 = { erc4337: { enabled: has4337, hasPaymaster } }
      const feeOptions = { feeOptions: { is1559: block?.baseFeePerGas !== null } }
      const addCustomNetwork = {
        ...customNetwork,
        ...erc4337,
        ...feeOptions,
        isSAEnabled: deploylessSuccess && singletonCode !== '0x',
        isOptimistic: oracleCode !== '0x'
      }

      this.#networkPreferences[customNetwork.name.toLowerCase()] = addCustomNetwork
    } catch (e: any) {
      this.emitError({
        message:
          'Failed to detect network, perhaps an RPC issue. Please change the RPC and try again',
        level: 'major',
        error: new Error('settings: addCustomNetwork chain already added')
      })
      this.emitUpdate()
      return
    }

    await this.#storePreferences()
    this.emitUpdate()
  }

  async updateNetworkPreferences(
    networkPreferences: NetworkPreference | CustomNetwork,
    networkId: NetworkDescriptor['id']
  ) {
    if (!Object.keys(networkPreferences).length) return

    const networkData = this.networks.find((network) => network.id === networkId)

    const changedNetworkPreferences = Object.keys(networkPreferences).reduce((acc, key) => {
      if (!networkData) return acc

      // No need to save unchanged network preferences.
      // Here we filter the network preferences that are the same as the ones in the storage.
      if (
        networkPreferences[key as keyof NetworkPreference] ===
        networkData[key as keyof NetworkPreference]
      )
        return acc

      return { ...acc, [key]: networkPreferences[key as keyof NetworkPreference] }
    }, {})

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
