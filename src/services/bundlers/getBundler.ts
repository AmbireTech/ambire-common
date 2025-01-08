import { BICONOMY, PIMLICO } from '../../consts/bundlers'
import { Network } from '../../interfaces/network'
import { Biconomy } from './biconomy'
import { Bundler } from './bundler'
import { Pimlico } from './pimlico'

export function getBundlerByName(bundlerName: string): Bundler {
  switch (bundlerName) {
    case PIMLICO:
      return new Pimlico()

    case BICONOMY:
      return new Biconomy()

    default:
      throw new Error('Bundler settings error')
  }
}

/**
 * Get the default bundler for the network without any extra logic.
 * If it's set, get it. If not, use pimlico
 */
export function getDefaultBundler(network: Network): Bundler {
  const bundlerName = network.erc4337.defaultBundler ? network.erc4337.defaultBundler : PIMLICO
  return getBundlerByName(bundlerName)
}
