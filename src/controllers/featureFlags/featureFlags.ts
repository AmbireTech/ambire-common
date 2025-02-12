import { featureFlags } from '../../consts/featureFlags'

export class FeatureFlagController {
  #flags = { ...featureFlags }

  isFeatureEnabled(flag: keyof typeof featureFlags): boolean {
    return !!this.#flags[flag]
  }

  setFeatureFlag(flag: keyof typeof featureFlags, value: boolean): void {
    this.#flags[flag] = value
  }

  getFeatures() {
    return this.#flags
  }
}
