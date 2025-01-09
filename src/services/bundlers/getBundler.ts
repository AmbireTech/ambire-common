import { BICONOMY, BUNDLER, PIMLICO } from '../../consts/bundlers'
import { Network } from '../../interfaces/network'
import { EstimateResult } from '../../libs/estimate/interfaces'
import { Biconomy } from './biconomy'
import { Bundler } from './bundler'
import { Pimlico } from './pimlico'

export function getBundlerByName(bundlerName: BUNDLER): Bundler {
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

/**
 * The goal of this method is to prioritize the bundler used for the estimation
 * before fallbacking to the default one
 */
export function getSameBundlerAsEstimation(
  network: Network,
  estimation?: EstimateResult | null
): Bundler {
  if (estimation?.erc4337GasLimits?.bundler) {
    return getBundlerByName(estimation.erc4337GasLimits.bundler)
  }

  return getDefaultBundler(network)
}
