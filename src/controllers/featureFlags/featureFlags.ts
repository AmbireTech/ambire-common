import { defaultFeatureFlags, FeatureFlags } from '../../consts/featureFlags'
import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter'
import { IFeatureFlagsController } from '../../interfaces/featureFlags'
import { IStorageController } from '../../interfaces/storage'
import EventEmitter from '../eventEmitter/eventEmitter'

/**
 * Responsible for managing (enable/disable) feature flags within the app. The
 * long-term vision for this is to support dynamic management, currently it
 * enables or disables features only at runtime. Can be useful for feature
 * toggling, A/B testing, and gradual feature roll-outs.
 */
export class FeatureFlagsController extends EventEmitter implements IFeatureFlagsController {
  #flags: FeatureFlags

  #storage: IStorageController

  constructor(
    featureFlags: Partial<FeatureFlags>,
    storage: IStorageController,
    eventEmitterRegistry?: IEventEmitterRegistryController
  ) {
    super(eventEmitterRegistry)

    this.#flags = { ...defaultFeatureFlags, ...(featureFlags || {}) }
    this.#storage = storage
    this.#load()
  }

  async #load(): Promise<void> {
    const features = await this.#storage.get('flags', {})
    this.#flags = { ...this.#flags, ...(features || {}) }
    this.emitUpdate()
  }

  /** Syntactic sugar for checking if a feature flag is enabled */
  isFeatureEnabled(flag: keyof FeatureFlags) {
    return this.#flags[flag]
  }

  async setFeatureFlag(flag: keyof typeof defaultFeatureFlags, value: boolean): Promise<void> {
    this.#flags[flag] = value
    await this.#storage.set('flags', this.#flags)
    this.emitUpdate()
  }

  get flags() {
    return this.#flags
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      flags: this.#flags
    }
  }
}
