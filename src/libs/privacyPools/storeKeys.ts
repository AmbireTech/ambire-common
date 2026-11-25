import { getPPv1ChainStateKey } from '@kohaku-eth/privacy-pools'

import {
  getPrivacyPoolsChainConfig,
  PRIVACY_POOLS_SUPPORTED_CHAIN_IDS
} from '../../consts/privacyPools'
import { PrivacyPoolsChainConfig } from '../../interfaces/privacyPools'

/**
 * The SDK's storage key for a chain's state. Read before a plugin exists: to tell whether the chain
 * has state yet, and to read the pools' numbers.
 */
export const getPrivacyPoolsChainStateKey = ({
  chainId,
  entrypointAddress
}: PrivacyPoolsChainConfig): string => getPPv1ChainStateKey(chainId, BigInt(entrypointAddress))

/**
 * Whether a key in the plugin's storage holds data the SDK no longer reads: the times of an
 * account's history, stored before 0.1.0-alpha.39, or any chain state but the current one of a
 * supported chain. The SDK versions the chain state key and bumps it to drop older states, so
 * that covers the unversioned key of SDKs before 0.1.0-alpha.39 and every later bump, and the
 * state of chains no longer supported (Sepolia).
 */
export const isPrivacyPoolsObsoleteStoreKey = (key: string): boolean => {
  if (key.startsWith('privacy-pool-history-')) return true
  if (!key.startsWith('privacy-pool-state-')) return false

  return !PRIVACY_POOLS_SUPPORTED_CHAIN_IDS.some((chainId) => {
    const config = getPrivacyPoolsChainConfig(chainId)

    return !!config && getPrivacyPoolsChainStateKey(config) === key
  })
}
