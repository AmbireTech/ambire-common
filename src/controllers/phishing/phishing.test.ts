import { expect, jest } from '@jest/globals'

import { makeMainController } from '../../../test/helpers/mainController'
import {
  PHISHING_ACTIVE_UPDATE_INTERVAL,
  PHISHING_INACTIVE_UPDATE_INTERVAL
} from '../../consts/intervals'

const prepareTest = async () => {
  const { mainCtrl } = await makeMainController(async (storageCtrl) => {
    await storageCtrl.set('domainsBlacklistedStatus', {
      'foourmemez.com': { status: 'BLACKLISTED', updatedAt: Date.now() },
      'rewards.ambire.com': { status: 'VERIFIED', updatedAt: Date.now() }
    })
    await storageCtrl.set('addressesBlacklistedStatus', {
      '0x20a9ff01b49cd8967cdd8081c547236eed1d1a4e': {
        status: 'BLACKLISTED',
        updatedAt: Date.now()
      },
      '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45': {
        status: 'VERIFIED',
        updatedAt: Date.now()
      }
    })
  })
  return { controller: mainCtrl.phishing, ui: mainCtrl.ui }
}

const flushMicrotaskQueue = async () => Promise.resolve()

const removeAllViews = (ui: Awaited<ReturnType<typeof prepareTest>>['ui']) => {
  ui.views.map((view) => view.id).forEach((viewId) => ui.removeView(viewId))
}

describe('PhishingController', () => {
  test('should initialize', async () => {
    const { controller } = await prepareTest()
    expect(controller).toBeDefined()
  })
  test('should get dapps blacklisted status', async () => {
    const { controller } = await prepareTest()
    await controller.updateDomainsBlacklistedStatus(
      ['foourmemez.com', 'rewards.ambire.com'],
      (blacklistedStatus) => {
        expect(blacklistedStatus['foourmemez.com'] === 'BLACKLISTED')
        expect(blacklistedStatus['rewards.ambire.com'] === 'VERIFIED')
      }
    )
  })
  test('should get addresses blacklisted status', async () => {
    const { controller } = await prepareTest()

    await controller.updateAddressesBlacklistedStatus(
      ['0x20a9ff01b49cd8967cdd8081c547236eed1d1a4e', '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45'],
      (blacklistedStatus) => {
        expect(blacklistedStatus['0x20a9ff01b49cd8967cdd8081c547236eed1d1a4e'] === 'BLACKLISTED')
        expect(blacklistedStatus['0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45'] === 'VERIFIED')
      }
    )
  })

  test('should switch phishing update interval to active on first view and back to inactive when all views are closed', async () => {
    const { controller, ui } = await prepareTest()

    // Ensure we test the exact 0 -> 1 -> 0 views transition.
    removeAllViews(ui)
    await flushMicrotaskQueue()

    expect(controller.updatePhishingInterval.currentTimeout).toBe(PHISHING_INACTIVE_UPDATE_INTERVAL)

    ui.addView({ id: 'phishing-test-tab-1', type: 'tab', currentRoute: 'dashboard', isReady: true })
    await flushMicrotaskQueue()
    expect(controller.updatePhishingInterval.currentTimeout).toBe(PHISHING_ACTIVE_UPDATE_INTERVAL)

    ui.removeView('phishing-test-tab-1')
    await flushMicrotaskQueue()
    expect(controller.updatePhishingInterval.currentTimeout).toBe(PHISHING_INACTIVE_UPDATE_INTERVAL)
  })

  test('should restart phishing interval immediately when extension becomes active', async () => {
    const { controller, ui } = await prepareTest()
    const restartSpy = jest.spyOn(controller.updatePhishingInterval, 'restart')

    // Ensure the added view is the first active one.
    removeAllViews(ui)

    ui.addView({ id: 'phishing-test-tab-2', type: 'tab', currentRoute: 'dashboard', isReady: true })

    expect(restartSpy).toHaveBeenCalledWith({
      timeout: PHISHING_ACTIVE_UPDATE_INTERVAL,
      runImmediately: true
    })
  })
})
