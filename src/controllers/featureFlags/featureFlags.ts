import { FeatureFlags, featureFlags } from '../../consts/featureFlags'
import EventEmitter from '../eventEmitter/eventEmitter'

/**
 * Responsible for managing (enable/disable) feature flags within the app. The
 * long-term vision for this is to support dynamic management, currently it
 * enables or disables features only at runtime. Can be useful for feature
 * toggling, A/B testing, and gradual feature roll-outs.
 */
export class FeatureFlagsController extends EventEmitter {
  #flags = { ...featureFlags }

  // TODO: Pull the feature flags from external source to be able to change them on the fly
  // constructor() { }

  /** Syntactic sugar for checking if a feature flag is enabled */
  isFeatureEnabled(flag: keyof FeatureFlags) {
    return this.#flags[flag]
  }

  setFeatureFlag(flag: keyof typeof featureFlags, value: boolean): void {
    this.#flags[flag] = value
    this.emitUpdate()
  }

  get flags(): FeatureFlags {
    return this.#flags
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      flags: this.flags
    }
  }
}
