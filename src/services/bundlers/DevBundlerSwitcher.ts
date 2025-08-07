import { Network } from '../../interfaces/network'
import { BrokenBiconomyBroadcast } from './brokenBiconomyBroadcast'
import { BundlerSwitcher } from './bundlerSwitcher'

/**
 * DANGER
 * This class is made only for testing purposes where we forcefully
 * set a broken bundler as the main one to test if fallback is working
 */
export class DevBundlerSwitcher extends BundlerSwitcher {
  constructor(
    network: Network,
    areUpdatesForbidden: Function,
    removeAvailableBundlers: boolean = false
  ) {
    super(network, areUpdatesForbidden)

    // push all available bundler as used so they are none available
    if (
      removeAvailableBundlers &&
      network.erc4337.bundlers &&
      network.erc4337.bundlers.length > 1
    ) {
      const availableBundlers = network.erc4337.bundlers.filter(
        (bundler) => bundler !== this.bundler.getName()
      )
      this.usedBundlers.push(...availableBundlers)
    }

    this.bundler = new BrokenBiconomyBroadcast()
  }
}
