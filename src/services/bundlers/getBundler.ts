import { BICONOMY, BUNDLER, CANDIDE, ETHERSPOT, GELATO, PIMLICO } from '../../consts/bundlers'

import { Network } from '../../interfaces/network'
import { Biconomy } from './biconomy'
import { Bundler } from './bundler'
import { Candide } from './candide'
import { Etherspot } from './etherspot'
import { Gelato } from './gelato'
import { Pimlico } from './pimlico'

export function getBundlerByName(bundlerName: BUNDLER): Bundler {
  switch (bundlerName) {
    case PIMLICO:
      return new Pimlico()

    case BICONOMY:
      return new Biconomy()

    case ETHERSPOT:
      return new Etherspot()

    case GELATO:
      return new Gelato()

    case CANDIDE:
      return new Candide()

    default:
      throw new Error('Bundler settings error')
  }
}

/**
 * Get the default bundler for the network without any extra logic.
 * If it's set, get it. If not, use pimlico
 */
export function getDefaultBundler(
  network: Network,
  opts: { canDelegate: boolean } = { canDelegate: false }
): Bundler {
  // hardcode biconomy for Sonic as it's not supported by pimlico
  if (network.chainId === 146n) return getBundlerByName(BICONOMY)

  // use pimlico on all 7702 accounts that don't have a set delegation
  if (opts.canDelegate) return getBundlerByName(PIMLICO)

  const bundlerName = network.erc4337.defaultBundler ? network.erc4337.defaultBundler : PIMLICO
  return getBundlerByName(bundlerName)
}

/**
 * This method should be used in caution when you want to utilize all
 * available bundlers on a network as the same time to find and fix a problem
 */
export function getAvailableBunlders(network: Network): Bundler[] {
  if (!network.erc4337.bundlers) return [getDefaultBundler(network)]

  return network.erc4337.bundlers?.map((bundler) => {
    return getBundlerByName(bundler)
  })
}
