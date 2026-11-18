import { jest } from '@jest/globals'

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
