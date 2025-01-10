import { PIMLICO } from '../../consts/bundlers'
import { Network } from '../../interfaces/network'
import { BrokenPimlicoBroadcast } from './brokenPimlicoBroadcast'
import { BundlerSwitcher } from './bundlerSwitcher'

/**
 * DANGER
 * This class is made only for testing purposes where we forcefully
 * set a broken bundler as the main one to test if fallback is working
 */
export class DevBundlerSwitcher extends BundlerSwitcher {
  constructor(network: Network) {
    super(network)
    this.bundler = new BrokenPimlicoBroadcast()
    this.usedBundlers.push(PIMLICO)
  }
}
