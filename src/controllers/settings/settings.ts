import { networks } from '../../consts/networks'
import { Key } from '../../interfaces/keystore'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import {
  AccountPreferences,
  KeyPreferences,
  NetworkPreference,
  NetworkPreferences
} from '../../interfaces/settings'
import { Storage } from '../../interfaces/storage'
import { isValidAddress } from '../../services/address'
import EventEmitter from '../eventEmitter'

export class SettingsController extends EventEmitter {
  networks: NetworkDescriptor[] = []

  accountPreferences: AccountPreferences = {}

  keyPreferences: KeyPreferences = []

  #networkPreferences: NetworkPreferences = {}

  #storage: Storage

  constructor(storage: Storage) {
    super()
    this.#storage = storage

    this.#load()
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

      this.#syncNetworkPreferences()
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

  #syncNetworkPreferences() {
    this.networks = networks.map((network) => {
      const networkPreferences = this.#networkPreferences[network.id]
      if (networkPreferences) {
        return {
          ...network,
          ...networkPreferences
        }
      }

      return network
    })
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

  async updateNetworkPreferences(
    networkPreferences: NetworkPreference,
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

    this.#syncNetworkPreferences()
    await this.#storePreferences()
    this.emitUpdate()
  }

  async resetNetworkPreference(key: keyof NetworkPreference, networkId: NetworkDescriptor['id']) {
    if (
      !networkId ||
      !(networkId in this.#networkPreferences) ||
      !(key in this.#networkPreferences[networkId])
    )
      return

    delete this.#networkPreferences[networkId][key]

    this.#syncNetworkPreferences()
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
}
