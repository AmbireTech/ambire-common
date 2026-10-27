import { describe, expect, test } from '@jest/globals'

import { produceMemoryStore } from '../../../test/helpers'
import { defaultFeatureFlags } from '../../consts/featureFlags'
import { StorageController } from '../storage/storage'
import { FeatureFlagsController } from './featureFlags'

const prepareController = async (savedFlags?: Record<string, boolean>) => {
  const storage = produceMemoryStore()
  if (savedFlags) await storage.set('flags', savedFlags)

  return new FeatureFlagsController({}, new StorageController(storage))
}

describe('FeatureFlagsController', () => {
  test('is not ready before the saved flags are loaded, and the defaults apply meanwhile', async () => {
    const controller = await prepareController({ nftImages: false })

    expect(controller.isReady).toBe(false)
    expect(controller.flags.nftImages).toBe(defaultFeatureFlags.nftImages)
    expect(controller.toJSON().isReady).toBe(false)
  })

  test('becomes ready with the saved flags overriding the defaults', async () => {
    const controller = await prepareController({ nftImages: false })
    await controller.initialLoadPromise

    expect(controller.isReady).toBe(true)
    expect(controller.flags.nftImages).toBe(false)
    expect(controller.toJSON().isReady).toBe(true)
  })

  test('is ready already when it emits the update that follows the load', async () => {
    const controller = await prepareController()
    let isReadyOnUpdate: boolean | undefined
    controller.onUpdate(() => {
      isReadyOnUpdate ??= controller.toJSON().isReady
    })
    await controller.initialLoadPromise

    expect(isReadyOnUpdate).toBe(true)
  })

  test('keeps NFT images enabled for a user with nothing saved', async () => {
    const controller = await prepareController()
    await controller.initialLoadPromise

    expect(controller.isFeatureEnabled('nftImages')).toBe(true)
  })
})
