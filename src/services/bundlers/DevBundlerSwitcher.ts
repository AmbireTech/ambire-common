import { BUNDLER } from '../../consts/bundlers'
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
    getSignAccountOpStatus: Function,
    noStateUpdateStatuses: any[],
    usedBundlers?: BUNDLER[]
  ) {
    super(network, getSignAccountOpStatus, noStateUpdateStatuses)
    this.bundler = new BrokenBiconomyBroadcast()
    if (usedBundlers) this.usedBundlers.push(...usedBundlers)
  }
}
