import { ETHEREUM_CHAIN_ID, FLASHBLOCKS_CHAIN_IDS } from '../consts/networks'
import { Network } from '../interfaces/network'

/**
 * Basically, blockTag: pending is not supported on a lot
 * of RPCs on all kinds of networks and it's not reliable to use.
 * We had these problems:
 * - doing eth_estimateGas resolving in an error
 * - doing Estimation.sol eth_call resolving in an error
 * - simulation not working
 * We decided to use the pending block only on Ethereum
 * and the latest for all other networks. Block time on all other
 * networks is faster than Ethereum so it shouldn't impact the features.
 * The exception is the networks in `FLASHBLOCKS_CHAIN_IDS`, where a receipt
 * arrives before its block is sealed, so only the pending state already
 * includes the transaction.
 */
export function getPendingBlockTagIfSupported(network: Network) {
  if (network.isColibriEnabled) return 'latest'
  if (network.chainId === ETHEREUM_CHAIN_ID) return 'pending'
  if (FLASHBLOCKS_CHAIN_IDS.includes(network.chainId)) return 'pending'

  return 'latest'
}
