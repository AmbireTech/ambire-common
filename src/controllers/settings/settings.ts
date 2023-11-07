import { Settings } from '../../interfaces/settings'
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
}
