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

    // TODO: Resolve TS warn
    for (const key of accountPreferenceKeys) {
      delete this.currentSettings.accountPreferences[key]
    }

    await this.#storeCurrentSettings()

    // Emit an update event
    this.emitUpdate()
  }
}
