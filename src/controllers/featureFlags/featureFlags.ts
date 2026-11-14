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

  // Holds the initial load promise, so that one can wait until it completes
  initialLoadPromise?: Promise<void>

  /**
   * Whether the saved flags have been read. The UI gates its own readiness on this flag, because
   * a state sent before the load carries the default flags, and a screen that paints with them
   * decides what to show and request from the wrong values.
   */
  isReady: boolean = false

  constructor(
    featureFlags: Partial<FeatureFlags>,
    storage: IStorageController,
    eventEmitterRegistry?: IEventEmitterRegistryController
  ) {
    super(eventEmitterRegistry)

    this.#flags = { ...defaultFeatureFlags, ...(featureFlags || {}) }
    this.#storage = storage

    this.initialLoadPromise = this.#load().finally(() => {
      this.initialLoadPromise = undefined
    })
  }

  async #load(): Promise<void> {
    // A failed read is not caught on purpose: the controller stays not ready, so the UI shows its
    // loading-failed screen instead of running with the default flags, which are not the
    // privacy choices of the user. Missing saved flags are not a failure: the read returns the
    // fallback and the defaults apply.
    const features = await this.#storage.get('flags', {})
    this.#flags = { ...this.#flags, ...(features || {}) }
    this.isReady = true
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

  async setFeatureFlags(flags: Partial<FeatureFlags>): Promise<void> {
    this.#flags = { ...this.#flags, ...flags }
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
