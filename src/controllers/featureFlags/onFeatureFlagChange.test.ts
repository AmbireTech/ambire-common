import { describe, expect, jest, test } from '@jest/globals'

import { produceMemoryStore } from '../../../test/helpers'
import { StorageController } from '../storage/storage'
import { FeatureFlagsController } from './featureFlags'
import { onFeatureFlagChange } from './onFeatureFlagChange'

const createFeatureFlags = async (storedFlags?: { tokenPrices: boolean }) => {
  const storage = new StorageController(produceMemoryStore())
  if (storedFlags) await storage.set('flags', storedFlags)

  return new FeatureFlagsController({}, storage)
}

describe('onFeatureFlagChange', () => {
  test('calls back when the flag is turned off and on again', async () => {
    const featureFlags = await createFeatureFlags()
    await featureFlags.initialLoadPromise
    const onChange = jest.fn()
    onFeatureFlagChange(featureFlags, 'tokenPrices', onChange)

    await featureFlags.setFeatureFlag('tokenPrices', false)
    await featureFlags.setFeatureFlag('tokenPrices', true)

    expect(onChange.mock.calls).toEqual([[false], [true]])
  })

  test('does not call back when another flag changes, or the flag is set to what it was', async () => {
    const featureFlags = await createFeatureFlags()
    await featureFlags.initialLoadPromise
    const onChange = jest.fn()
    onFeatureFlagChange(featureFlags, 'tokenPrices', onChange)

    await featureFlags.setFeatureFlag('gasTank', false)
    await featureFlags.setFeatureFlag('tokenPrices', true)

    expect(onChange).not.toHaveBeenCalled()
  })

  test('does not call back when the flag is loaded from storage at startup', async () => {
    // Listening before the stored flags are loaded, as MainController does
    const featureFlags = await createFeatureFlags({ tokenPrices: false })
    const onChange = jest.fn()
    onFeatureFlagChange(featureFlags, 'tokenPrices', onChange)

    await featureFlags.initialLoadPromise
    expect(featureFlags.isFeatureEnabled('tokenPrices')).toBe(false)
    expect(onChange).not.toHaveBeenCalled()

    // A change after the load is still reported
    await featureFlags.setFeatureFlag('tokenPrices', true)
    expect(onChange).toHaveBeenCalledWith(true)
  })

  test('stops calling back once unsubscribed', async () => {
    const featureFlags = await createFeatureFlags()
    await featureFlags.initialLoadPromise
    const onChange = jest.fn()
    const unsubscribe = onFeatureFlagChange(featureFlags, 'tokenPrices', onChange)

    unsubscribe()
    await featureFlags.setFeatureFlag('tokenPrices', false)

    expect(onChange).not.toHaveBeenCalled()
  })
})
