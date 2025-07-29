import { produceMemoryStore } from '../../../test/helpers'
import { Banner } from '../../interfaces/banner'
import { StorageController } from '../storage/storage'
import { BannerController } from './banner'

const prepareTest = async () => {
  const storage = produceMemoryStore()
  const storageCtrl = new StorageController(storage)

  const ctrl = new BannerController(storageCtrl)
  await ctrl.initialLoadPromise

  return ctrl
}

describe('BannerController', () => {
  it('should add a banner', async () => {
    const controller = await prepareTest()

    const banner: Banner = {
      id: 'test-banner',
      title: 'Test Banner',
      type: 'info',
      actions: []
    }

    controller.addBanner(banner)

    expect(controller.banners).toHaveLength(1)
    expect(controller.banners[0].id).toBe('test-banner')
  })
  it('should not add a banner with the same id', async () => {
    const controller = await prepareTest()

    // Increase maxBannerCount to test multiple banners
    controller.maxBannerCount = 10

    const banner: Banner = {
      id: 'test-banner',
      title: 'Test Banner',
      type: 'info',
      actions: []
    }

    const banner2: Banner = {
      id: 'test-banner-2',
      title: 'Test Banner 2',
      type: 'info',
      actions: []
    }

    // Same banner twice and one different
    controller.addBanner(banner)
    controller.addBanner(banner)

    controller.addBanner(banner2)

    expect(controller.banners).toHaveLength(2)
  })
  it('should dismiss a banner', async () => {
    const controller = await prepareTest()

    const banner: Banner = {
      id: 'test-banner',
      title: 'Test Banner',
      type: 'info',
      actions: []
    }

    controller.addBanner(banner)
    expect(controller.banners).toHaveLength(1)

    await controller.dismissBanner('test-banner')

    expect(controller.banners).toHaveLength(0)
  })
  it('should return only one banner at a time', async () => {
    const controller = await prepareTest()

    const banner1: Banner = {
      id: 'test-banner-1',
      title: 'Test Banner 1',
      type: 'info',
      actions: []
    }

    const banner2: Banner = {
      id: 'test-banner-2',
      title: 'Test Banner 2',
      type: 'info',
      actions: []
    }

    controller.addBanner(banner1)
    controller.addBanner(banner2)

    expect(controller.banners).toHaveLength(1)
  })
  it('should remove expired banners', async () => {
    const controller = await prepareTest()

    const banner: Banner = {
      id: 'expired-banner',
      title: 'Expired Banner',
      type: 'info',
      actions: [],
      meta: {
        endTime: Date.now() - 1000 // Set to past time
      }
    }

    controller.addBanner(banner)

    expect(controller.banners).toHaveLength(0) // Should be removed due to expiration
  })
  it('should not add a dismissed banner', async () => {
    const controller = await prepareTest()

    const banner: Banner = {
      id: 'dismissed-banner',
      title: 'Dismissed Banner',
      type: 'info',
      actions: []
    }

    controller.addBanner(banner)
    expect(controller.banners).toHaveLength(1)

    await controller.dismissBanner('dismissed-banner')

    controller.addBanner(banner) // Try to add the dismissed banner again

    expect(controller.banners).toHaveLength(0) // Should not be added again
  })
})
