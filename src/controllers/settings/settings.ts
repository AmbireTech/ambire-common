import { AccountPreferences, Settings } from '../../interfaces/settings'
import { Storage } from '../../interfaces/storage'
import EventEmitter from '../eventEmitter'

const defaultSettings: Settings = {
  accountPreferences: {}
}

export class SettingsController extends EventEmitter {
  currentSettings: Settings = defaultSettings

  #storage: Storage

  constructor({ storage }: { storage: Storage }) {
    super()
    this.#storage = storage

    this.#load()
  }

  async #load() {
    try {
      this.currentSettings = await this.#storage.get('settings', defaultSettings)
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

  async #storeCurrentSettings() {
    // Store the updated settings
    try {
      await this.#storage.set('settings', this.currentSettings)
    } catch (e) {
      this.emitError({
        message:
          'Failed to store updated settings. Please try again or contact support if the problem persists.',
        level: 'major',
        error: new Error('settings: failed to store updated settings')
      })
    }
  }

  async addAccountPreferences(newAccountPreferences: AccountPreferences = {}) {
    if (!Object.keys(newAccountPreferences).length) return

    // TODO: Check if this addresses exist?

    this.currentSettings.accountPreferences = {
      ...this.currentSettings.accountPreferences,
      ...newAccountPreferences
    }

    await this.#storeCurrentSettings()

    // Emit an update event
    this.emitUpdate()
  }

  async removeAccountPreferences(accountPreferenceKeys: Array<keyof AccountPreferences> = []) {
    if (!accountPreferenceKeys.length) return

    // There's nothing to delete
    if (!Object.keys(this.currentSettings.accountPreferences).length) return

    accountPreferenceKeys.forEach((key) => {
      // Cast to AccountPreferences, since above the case when the
      // accountPreferences is empty (and there is nothing to delete) is handled
      delete (this.currentSettings.accountPreferences as AccountPreferences)[key]
    })

    await this.#storeCurrentSettings()

    // Emit an update event
    this.emitUpdate()
  }
}
