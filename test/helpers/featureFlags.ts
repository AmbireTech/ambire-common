import { expect, jest } from '@jest/globals'

import { FeatureFlagsController } from '../../src/controllers/featureFlags/featureFlags'
import type { IStorageController } from '../../src/interfaces/storage'

/**
 * A storage whose read of the saved feature flags stays pending until `releaseRead` is called.
 * It lets a test check what happens while the saved flags are still loading.
 */
export const makeStorageWithSlowFlags = (savedFlags: object | null) => {
  let releaseRead: () => void = () => {}
  const readReleased = new Promise<void>((resolve) => {
    releaseRead = resolve
  })

  const storage = {
    get: jest.fn(async () => {
      await readReleased
      return savedFlags
    }),
    set: jest.fn(async () => {})
  } as unknown as IStorageController

  return { storage, releaseRead }
}

/**
 * A real `FeatureFlagsController` whose read of the saved flags failed. It is not ready and its
 * flags hold the defaults, which turn on every feature that sends the user's data to a server.
 * Code that runs in this state must act as for a user who opted out.
 */
export const makeFeatureFlagsWithFailedLoad = async () => {
  const storage = {
    get: jest.fn(async () => {
      throw new Error('storage is unavailable')
    }),
    set: jest.fn(async () => {})
  } as unknown as IStorageController
  const featureFlags = new FeatureFlagsController({}, storage)

  await expect(featureFlags.initialLoadPromise).rejects.toThrow('storage is unavailable')

  return featureFlags
}
