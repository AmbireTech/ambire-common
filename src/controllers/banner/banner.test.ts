import { ZeroAddress } from 'ethers'

import { mockUiManager } from '@test/helpers/ui'

import { produceMemoryStore } from '../../../test/helpers'
import { Banner } from '../../interfaces/banner'
import { StorageController } from '../storage/storage'
import { ANSWERED_SURVEYS_STORAGE_KEY, SurveyController } from '../survey/survey'
import { UiController } from '../ui/ui'
import { AccountData, BannerController } from './banner'

const prepareTest = async () => {
  const storage = new StorageController(produceMemoryStore())
  const { uiManager } = mockUiManager()

  await storage.set(ANSWERED_SURVEYS_STORAGE_KEY, ['test-banner4'])
  let surveyCtrl = new SurveyController({
    fetch: fetch as any,
    relayerUrl: '',
    storage,
    ui: new UiController({ uiManager }),
    dismissBanner: () => {}
  })
  const bannersCtrl = new BannerController(
    storage,
    () => ({
      status: 'has-selected-account',
      address: ZeroAddress,
      hasKeys: true,
      numberOfTransactions: 10,
      totalUsdBalance: 10,
      isBalanceReady: true
    }),
    surveyCtrl,
    '1.0.0'
  )
  await bannersCtrl.initialLoadPromise

  return { bannersCtrl, surveyCtrl, storage }
}

describe('BannerController', () => {
  it('should add a banner', async () => {
    const { bannersCtrl: controller } = await prepareTest()

    const banner: Banner = {
      id: 'test-banner',
      title: 'Test Banner',
      type: 'info',
      actions: []
    }

    controller.addBanner(banner)

    expect(controller.bannersData.banners).toHaveLength(1)
    expect(controller.bannersData.banners[0]!.id).toBe('test-banner')
  })
  it('should enforce requirements', async () => {
    const { bannersCtrl: controller } = await prepareTest()
    ;[
      {
        id: 'test-banner1',
        title: 'Test Banner',
        type: 'info',
        actions: [{ actionName: 'survey', meta: { surveyId: '' } }],
        meta: { requirements: { maxBalanceTotal: 9 } }
      } as Banner,
      {
        id: 'test-banner2',
        title: 'Test Banner',
        type: 'info',
        actions: [{ actionName: 'survey', meta: { surveyId: '' } }],
        meta: { requirements: { minBalanceTotal: 11 } }
      } as Banner,
      {
        id: 'test-banner3',
        title: 'Test Banner',
        type: 'info',
        actions: [{ actionName: 'survey', meta: { surveyId: '' } }],
        meta: { requirements: { minTxnsTotal: 11 } }
      } as Banner,
      {
        id: 'test-banner4',
        title: 'Test Banner',
        type: 'info',
        actions: [{ actionName: 'survey', meta: { surveyId: '' } }],
        meta: { requirements: { minTxnsTotal: 11 } }
      } as Banner
    ].forEach((banner: Banner) => {
      controller.addBanner(banner)
    })

    expect(controller.bannersData.banners).toHaveLength(0)
    controller.addBanner({
      id: 'test-banner5',
      title: 'Test Banner',
      type: 'info',
      actions: [
        {
          actionName: 'survey',
          meta: {
            surveyId: ''
          }
        }
      ],
      meta: {
        requirements: {
          minTxnsTotal: 9,
          maxTxnsTotal: 10,
          minBalanceTotal: 9,
          maxBalanceTotal: 11
        }
      }
    })
    expect(controller.bannersData.banners).toHaveLength(1)
  })
  it('should not add a banner with the same id', async () => {
    const { bannersCtrl: controller } = await prepareTest()

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

    expect(controller.bannersData.banners).toHaveLength(2)
  })
  it('should dismiss a banner', async () => {
    const { bannersCtrl: controller } = await prepareTest()

    const banner: Banner = {
      id: 'test-banner',
      title: 'Test Banner',
      type: 'info',
      actions: []
    }

    controller.addBanner(banner)
    expect(controller.bannersData.banners).toHaveLength(1)

    await controller.dismissBanner('test-banner')

    expect(controller.bannersData.banners).toHaveLength(0)
  })
  it('should return only one banner at a time', async () => {
    const { bannersCtrl: controller } = await prepareTest()

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

    expect(controller.bannersData.banners).toHaveLength(1)
  })
  it('should remove expired banners', async () => {
    const { bannersCtrl: controller } = await prepareTest()

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

    expect(controller.bannersData.banners).toHaveLength(0) // Should be removed due to expiration
  })
  it('should display a banner regardless of keys when shouldHaveKeys requirement is not given', async () => {
    const accData: AccountData = {
      status: 'has-selected-account',
      address: ZeroAddress,
      hasKeys: false,
      numberOfTransactions: 10,
      totalUsdBalance: 10,
      isBalanceReady: true
    }
    const storage = new StorageController(produceMemoryStore())
    const { uiManager } = mockUiManager()
    const surveyCtrl = new SurveyController({
      fetch: fetch as any,
      relayerUrl: '',
      storage,
      ui: new UiController({ uiManager }),
      dismissBanner: () => {}
    })
    const bannersCtrl = new BannerController(
      storage,
      () => {
        return accData
      },
      surveyCtrl,
      '1.0.0'
    )
    await bannersCtrl.initialLoadPromise

    const banners: Banner[] = [
      {
        id: 'no-keys-requirement-banner',
        title: 'No Keys Requirement Banner',
        type: 'info',
        actions: []
      },
      {
        id: 'has-keys-requirement-banner',
        title: 'No Keys Requirement Banner',
        type: 'info',
        actions: [],
        meta: { requirements: { shouldHaveKeys: true } }
      }
    ]
    bannersCtrl.addBanner(banners[0]!)
    expect(bannersCtrl.bannersData.banners).toHaveLength(1)
    await bannersCtrl.dismissBanner(banners[0]!.id)

    bannersCtrl.addBanner(banners[1]!)
    expect(bannersCtrl.bannersData.banners).toHaveLength(0)
    accData.hasKeys = true
    expect(bannersCtrl.bannersData.banners).toHaveLength(1)

    await bannersCtrl.dismissBanner(banners[1]!.id)
  })
  it('should not add a dismissed banner', async () => {
    const { bannersCtrl: controller } = await prepareTest()

    const banner: Banner = {
      id: 'dismissed-banner',
      title: 'Dismissed Banner',
      type: 'info',
      actions: []
    }

    controller.addBanner(banner)
    expect(controller.bannersData.banners).toHaveLength(1)

    await controller.dismissBanner('dismissed-banner')

    controller.addBanner(banner) // Try to add the dismissed banner again

    expect(controller.bannersData.banners).toHaveLength(0) // Should not be added again
  })
})
