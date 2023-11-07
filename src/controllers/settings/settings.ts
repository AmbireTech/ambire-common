import { Storage } from '../../interfaces/storage'
import EventEmitter from '../eventEmitter'

export class SettingsController extends EventEmitter {
  currentSettings: any // TODO

  #storage: Storage

  constructor({ storage }: { storage: Storage }) {
    super()
    this.#storage = storage

    this.#load()
  }

  async #load() {
    try {
      this.currentSettings = await this.#storage.get('settings', {})
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
