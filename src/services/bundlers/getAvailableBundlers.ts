import { allBundlers, BUNDLER } from '../../consts/bundlers'
import { Network } from '../../interfaces/network'
import { Bundler } from './bundler'
import { getBundlerByName, getDefaultBundlerName } from './getBundler'

export function getAvailableBundlerNames(network: Network): BUNDLER[] {
  if (!network.erc4337.bundlers) return [getDefaultBundlerName(network)]

  // the bundler may not be implemented in the codebase
  return network.erc4337.bundlers.filter((name) => allBundlers.includes(name))
}

/**
 * This method should be used in caution when you want to utilize all
 * available bundlers on a network as the same time to find and fix a problem
 */
export function getAvailableBunlders(network: Network): Bundler[] {
  return getAvailableBundlerNames(network).map((bundler) => {
    return getBundlerByName(bundler)
  })
}
