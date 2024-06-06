import { Key } from '../../interfaces/keystore'
import { AccountPreferences, KeyPreferences } from '../../interfaces/settings'
import { Storage } from '../../interfaces/storage'
import { isValidAddress } from '../../services/address'
import EventEmitter, { Statuses } from '../eventEmitter/eventEmitter'

const STATUS_WRAPPED_METHODS = {} as const

export class SettingsController extends EventEmitter {
  accountPreferences: AccountPreferences = {}

  keyPreferences: KeyPreferences = []

  #storage: Storage

  statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS> = STATUS_WRAPPED_METHODS

  constructor(storage: Storage) {
    super()
    this.#storage = storage

    this.#load()
  }

  async #load() {
    try {
      ;[this.accountPreferences, this.keyPreferences] = await Promise.all([
        // Should get the storage data from all keys here
        this.#storage.get('accountPreferences', {}),
        this.#storage.get('keyPreferences', [])
      ])

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
        this.#storage.set('keyPreferences', this.keyPreferences)
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

    // We use `await` here to ensure that an outer function can await the emit to be dispatched to the application.
    // Consider the following example:
    // 1. In MainController's onAccountAdderSuccess, we process the newly added accounts from AccountAdder.
    // 2. Within this function, we await the completion of both Settings methods:
    // await Promise.all([
    //   this.settings.addKeyPreferences(this.accountAdder.readyToAddKeyPreferences),
    //   this.settings.addAccountPreferences(this.accountAdder.readyToAddAccountPreferences),
    // ])
    // 3. Once both Promises are resolved, the MainController status is set to 'SUCCESS', indicating successful account importation.
    // However, there's a catch. If we don't `await` here, both Promises will resolve,
    // and MainController's onAccountAdderSuccess will change its status to 'SUCCESS'.
    // Consequently, at the application level, components will be able to access the newly imported accounts,
    // but the Settings' accountsPreferences may not have been updated yet.
    //
    // We've previously encountered this issue in AccountsPersonalizeScreen,
    // and it happens from time to time, which is why we implemented this fix.
    await this.forceEmitUpdate()
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

    // We use `await` here to ensure that an outer function can await the emit to be dispatched to the application.
    // Consider the following example:
    // 1. In MainController's onAccountAdderSuccess, we process the newly added accounts from AccountAdder.
    // 2. Within this function, we await the completion of both Settings methods:
    // await Promise.all([
    //   this.settings.addKeyPreferences(this.accountAdder.readyToAddKeyPreferences),
    //   this.settings.addAccountPreferences(this.accountAdder.readyToAddAccountPreferences),
    // ])
    // 3. Once both Promises are resolved, the MainController status is set to 'SUCCESS', indicating successful account importation.
    // However, there's a catch. If we don't `await` here, both Promises will resolve,
    // and MainController's onAccountAdderSuccess will change its status to 'SUCCESS'.
    // Consequently, at the application level, components will be able to access the newly imported accounts,
    // but the Settings' keyPreferences may not have been updated yet.
    //
    // We've previously encountered this issue in AccountsPersonalizeScreen,
    // and it happens from time to time, which is why we implemented this fix.
    await this.forceEmitUpdate()
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
      ...super.toJSON()
    }
  }
}
