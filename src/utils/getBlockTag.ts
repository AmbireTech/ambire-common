import { Network } from 'interfaces/network'

/**
 * Basically, blockTag: pending is not supported on a lot
 * of RPCs on all kinds of networks and it's not reliable to use.
 * We had these problems:
 * - doing eth_estimateGas resolving in an error
 * - doing Estimation.sol eth_call resolving in an error
 * - simulation not working
 * We decided to use the pending block only on Ethereum
 * and the latest for all other networks. Block time on all other
 * networks is faster than Ethereum so it shouldn't impact the features
 */
export function getPendingBlockTagIfSupported(network: Network) {
  return network.chainId === 1n ? 'pending' : 'latest'
}
