import { allBundlers, BICONOMY, BUNDLER, ETHERSPOT, PIMLICO } from '../../consts/bundlers'
import { Network } from '../../interfaces/network'
import { Biconomy } from './biconomy'
import { Bundler } from './bundler'
import { Etherspot } from './etherspot'
import { Pimlico } from './pimlico'

export function getBundlerByName(bundlerName: BUNDLER): Bundler {
  switch (bundlerName) {
    case PIMLICO:
      return new Pimlico()

    case BICONOMY:
      return new Biconomy()

    case ETHERSPOT:
      return new Etherspot()

    default:
      throw new Error('Bundler settings error')
  }
}

export function getDefaultBundlerName(
  network: Network,
  opts: { canDelegate: boolean } = { canDelegate: false }
): BUNDLER {
  // hardcode biconomy for Sonic as it's not supported by pimlico
  if (network.chainId === 146n) BICONOMY

  // use pimlico on all 7702 accounts that don't have a set delegation
  if (opts.canDelegate) PIMLICO

  return network.erc4337.defaultBundler && allBundlers.includes(network.erc4337.defaultBundler)
    ? network.erc4337.defaultBundler
    : PIMLICO
}

/**
 * Get the default bundler for the network without any extra logic.
 * If it's set, get it. If not, use pimlico
 */
export function getDefaultBundler(
  network: Network,
  opts: { canDelegate: boolean } = { canDelegate: false }
): Bundler {
  return getBundlerByName(getDefaultBundlerName(network, opts))
}

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
