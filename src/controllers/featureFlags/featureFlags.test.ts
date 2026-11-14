import { describe, expect, jest, test } from '@jest/globals'

import { makeStorageWithSlowFlags } from '../../../test/helpers/featureFlags'
import { defaultFeatureFlags } from '../../consts/featureFlags'
import type { IStorageController } from '../../interfaces/storage'
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

  test('is not ready until the saved flags load, and the update that ends the load says it is ready', async () => {
    const { storage, releaseRead } = makeStorageWithSlowFlags({ tokenPrices: false })
    const ctrl = new FeatureFlagsController({}, storage)
    const isReadyInUpdates: boolean[] = []
    ctrl.onUpdate(() => isReadyInUpdates.push(ctrl.isReady))

    expect(ctrl.isReady).toBe(false)

    releaseRead()
    await ctrl.initialLoadPromise

    expect(ctrl.isReady).toBe(true)
    expect(isReadyInUpdates).toEqual([true])
  })

  test('is not ready while a flag is set before the saved flags load', async () => {
    const { storage, releaseRead } = makeStorageWithSlowFlags({})
    const ctrl = new FeatureFlagsController({}, storage)

    // A state sent now must not look ready to the UI
    expect(JSON.parse(JSON.stringify(ctrl)).isReady).toBe(false)

    releaseRead()
    await ctrl.initialLoadPromise

    expect(JSON.parse(JSON.stringify(ctrl)).isReady).toBe(true)
  })

  test('stays not ready and rejects the load when the saved flags cannot be read', async () => {
    const readError = new Error('storage is unavailable')
    const storage = {
      get: jest.fn(async () => {
        throw readError
      }),
      set: jest.fn(async () => {})
    } as unknown as IStorageController
    const ctrl = new FeatureFlagsController({}, storage)
    const load = ctrl.initialLoadPromise
    const updates: boolean[] = []
    ctrl.onUpdate(() => updates.push(ctrl.isReady))

    // The UI must never take the default flags for the saved ones, so the load fails loudly
    await expect(load).rejects.toBe(readError)

    expect(ctrl.isReady).toBe(false)
    expect(updates).toEqual([])
  })

  test('is ready with the default flags when nothing is saved yet', async () => {
    const { storage, releaseRead } = makeStorageWithSlowFlags(null)
    const ctrl = new FeatureFlagsController({}, storage)

    releaseRead()
    await ctrl.initialLoadPromise

    // A first run has no saved flags. This is not a failure, the defaults apply
    expect(ctrl.isReady).toBe(true)
    expect(ctrl.flags).toEqual(defaultFeatureFlags)
  })
})
