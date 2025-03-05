import { FeatureFlags, featureFlags } from '../../consts/featureFlags'
import { ODYSSEY_CHAIN_ID } from '../../consts/networks'
import EventEmitter from '../eventEmitter/eventEmitter'
import { NetworksController } from '../networks/networks'

/**
 * Responsible for managing (enable/disable) feature flags within the app. The
 * long-term vision for this is to support dynamic management, currently it
 * enables or disables features only at runtime. Can be useful for feature
 * toggling, A/B testing, and gradual feature roll-outs.
 */
export class FeatureFlagsController extends EventEmitter {
  #flags = { ...featureFlags }

  #networks: NetworksController

  constructor(networks: NetworksController) {
    super()
    this.#networks = networks

    // enable the 7702 feature if the oddysey network is in the networks config
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.#networks.initialLoadPromise.then(() => {
      const oddysey = this.#networks.networks.find((net) => net.chainId === ODYSSEY_CHAIN_ID)
      if (oddysey) this.setFeatureFlag('eip7702', true)
    })
  }

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
