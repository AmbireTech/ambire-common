import { describe, expect, test } from '@jest/globals'

import { produceMemoryStore } from '../../../test/helpers'
import { StorageController } from '../storage/storage'
import { FeatureFlagsController } from './featureFlags'

const prepareController = async (savedFlags?: Record<string, boolean>) => {
  const storage = produceMemoryStore()
  if (savedFlags) await storage.set('flags', savedFlags)

  const controller = new FeatureFlagsController({}, new StorageController(storage))
  await controller.initialLoadPromise

  return controller
}

describe('FeatureFlagsController', () => {
  test('keeps NFT images enabled for a user with nothing saved', async () => {
    const controller = await prepareController()

    expect(controller.isFeatureEnabled('nftImages')).toBe(true)
  })

  test('the saved opt-out of NFT images overrides the default', async () => {
    const controller = await prepareController({ nftImages: false })

    expect(controller.isFeatureEnabled('nftImages')).toBe(false)
  })
})
