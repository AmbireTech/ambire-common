import { describe, expect, test } from '@jest/globals'

import { makeStorageWithSlowFlags } from '../../../test/helpers/featureFlags'
import { defaultFeatureFlags } from '../../consts/featureFlags'
import { FeatureFlagsController } from './featureFlags'

describe('FeatureFlagsController', () => {
  test('uses the default flags until the saved flags load', async () => {
    const { storage, releaseRead } = makeStorageWithSlowFlags({ tokenPrices: false })
    const ctrl = new FeatureFlagsController({}, storage)

    // Anything that reads a flag before the load ends sees the default, so it must await the load
    expect(ctrl.initialLoadPromise).toBeDefined()
    expect(ctrl.flags).toEqual(defaultFeatureFlags)
    expect(ctrl.isFeatureEnabled('tokenPrices')).toBe(true)

    releaseRead()
    await ctrl.initialLoadPromise

    expect(ctrl.isFeatureEnabled('tokenPrices')).toBe(false)
  })

  test('does not send an update before the saved flags load', async () => {
    const { storage, releaseRead } = makeStorageWithSlowFlags({ tokenPrices: false })
    const ctrl = new FeatureFlagsController({}, storage)
    const flagsInUpdates: boolean[] = []
    ctrl.onUpdate(() => flagsInUpdates.push(ctrl.flags.tokenPrices))

    expect(flagsInUpdates).toEqual([])

    releaseRead()
    await ctrl.initialLoadPromise

    // Only the saved value is ever sent, never the default one, and it is sent before the
    // load promise resolves
    expect(flagsInUpdates).toEqual([false])
  })

  test('clears the load promise when the load ends', async () => {
    const { storage, releaseRead } = makeStorageWithSlowFlags({})
    const ctrl = new FeatureFlagsController({}, storage)

    releaseRead()
    await ctrl.initialLoadPromise

    expect(ctrl.initialLoadPromise).toBeUndefined()
  })

  test('the flags given to the constructor replace the defaults', async () => {
    const { storage, releaseRead } = makeStorageWithSlowFlags(null)
    const ctrl = new FeatureFlagsController({ testnetMode: true }, storage)

    expect(ctrl.isFeatureEnabled('testnetMode')).toBe(true)

    releaseRead()
    await ctrl.initialLoadPromise

    expect(ctrl.isFeatureEnabled('testnetMode')).toBe(true)
    expect(ctrl.flags).toEqual({ ...defaultFeatureFlags, testnetMode: true })
  })

  test('the saved flags replace the constructor flags and the defaults, the rest stay', async () => {
    const { storage, releaseRead } = makeStorageWithSlowFlags({ testnetMode: false })
    const ctrl = new FeatureFlagsController({ testnetMode: true, gasTank: false }, storage)

    releaseRead()
    await ctrl.initialLoadPromise

    expect(ctrl.isFeatureEnabled('testnetMode')).toBe(false)
    expect(ctrl.isFeatureEnabled('gasTank')).toBe(false)
    expect(ctrl.isFeatureEnabled('tokenPrices')).toBe(defaultFeatureFlags.tokenPrices)
  })
})
