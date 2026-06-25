import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter'
import { IStorageController } from '../../interfaces/storage'
import { debugLoggerRegistry } from '../../libs/debugLogger/debugLogger'
import EventEmitter from '../eventEmitter/eventEmitter'

/**
 * Enables/disables per-controller debug logging at runtime. Logging settings
 * are persisted in storage and reloaded at startup.
 */
export class DebugController extends EventEmitter {
  #storage: IStorageController

  #unsubscribeFromRegistry: () => void

  initialLoadPromise?: Promise<void>

  constructor(storage: IStorageController, eventEmitterRegistry?: IEventEmitterRegistryController) {
    super(eventEmitterRegistry)

    this.#storage = storage

    // Re-emit when a new namespace registers, so dynamically-constructed controllers
    // (e.g. SignAccountOpController) appear in the UI the moment they're created
    this.#unsubscribeFromRegistry = debugLoggerRegistry.subscribe(() => this.emitUpdate())

    this.initialLoadPromise = this.#load().finally(() => {
      this.initialLoadPromise = undefined
    })
  }

  async #load(): Promise<void> {
    const stored = await this.#storage.get('debugLogNamespaces', {})
    debugLoggerRegistry.hydrate(stored)
    this.emitUpdate()
  }

  /**
   * Full catalog of toggleable controllers with their on/off state (for the UI)
   */
  get namespaces(): { name: string; enabled: boolean }[] {
    return debugLoggerRegistry
      .catalog()
      .map((name) => ({ name, enabled: debugLoggerRegistry.isEnabled(name) }))
  }

  async setNamespaceEnabled(namespace: string, value: boolean): Promise<void> {
    debugLoggerRegistry.setEnabled(namespace, value)
    this.emitUpdate()
    await this.#storage.set('debugLogNamespaces', debugLoggerRegistry.snapshot())
  }

  destroy() {
    this.#unsubscribeFromRegistry()
    super.destroy()
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      namespaces: this.namespaces
    }
  }
}
