import { BUNDLER } from '../../consts/bundlers'
import { Network } from '../../interfaces/network'
import { Bundler } from './bundler'
import { BundlerSwitcher } from './bundlerSwitcher'

/**
 * DANGER
 * This class is made only for testing purposes where we forcefully
 * set a broken bundler as the main one to test if fallback is working
 */
export class DevBundlerSwitcher extends BundlerSwitcher {
  constructor(network: Network, brokenBundler: Bundler, usedBundlers: BUNDLER[] = []) {
    super(network)
    this.bundler = brokenBundler
    this.usedBundlers.push(...usedBundlers)
  }
}
