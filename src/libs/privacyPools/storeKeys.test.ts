import { describe, expect, it } from '@jest/globals'

import { PRIVACY_POOLS_CHAINS } from '../../consts/privacyPools'
import { getPrivacyPoolsChainStateKey, isPrivacyPoolsObsoleteStoreKey } from './storeKeys'

const ETHEREUM = PRIVACY_POOLS_CHAINS['1']!
const ENTRYPOINT = BigInt(ETHEREUM.entrypointAddress).toString()

describe('isPrivacyPoolsObsoleteStoreKey', () => {
  it('keeps the current chain state of every supported chain', () => {
    Object.values(PRIVACY_POOLS_CHAINS).forEach((chain) => {
      expect(isPrivacyPoolsObsoleteStoreKey(getPrivacyPoolsChainStateKey(chain))).toBe(false)
    })
  })

  it('drops the chain state and history times SDKs before 0.1.0-alpha.39 stored', () => {
    expect(isPrivacyPoolsObsoleteStoreKey(`privacy-pool-state-1-${ENTRYPOINT}`)).toBe(true)
    expect(isPrivacyPoolsObsoleteStoreKey(`privacy-pool-history-1-${ENTRYPOINT}`)).toBe(true)
  })

  // The SDK bumps the version in the key to drop the states of its earlier versions
  it('drops a chain state of another version than the current one', () => {
    expect(isPrivacyPoolsObsoleteStoreKey(`privacy-pool-state-v1-1-${ENTRYPOINT}`)).toBe(true)
    expect(isPrivacyPoolsObsoleteStoreKey(`privacy-pool-state-v3-1-${ENTRYPOINT}`)).toBe(true)
  })

  it('drops the chain state of a chain that is no longer supported', () => {
    expect(isPrivacyPoolsObsoleteStoreKey(`privacy-pool-state-11155111-${ENTRYPOINT}`)).toBe(true)
    expect(isPrivacyPoolsObsoleteStoreKey(`privacy-pool-state-v2-11155111-${ENTRYPOINT}`)).toBe(
      true
    )
  })

  it('keeps the history times the current SDK stores, and keys it does not know', () => {
    expect(isPrivacyPoolsObsoleteStoreKey(`privacy-pool-timestamps-1-${ENTRYPOINT}`)).toBe(false)
    expect(isPrivacyPoolsObsoleteStoreKey('privacy-pool-state')).toBe(false)
    expect(isPrivacyPoolsObsoleteStoreKey('something-else')).toBe(false)
  })
})
