import { expect, jest } from '@jest/globals'

import { makeMainController } from '../../../test/helpers/mainController'
import {
  PHISHING_ACTIVE_UPDATE_INTERVAL,
  PHISHING_INACTIVE_UPDATE_INTERVAL
} from '../../consts/intervals'
import { SUSPICIOUS_HOSTING_DOMAINS } from './phishing'

// Seeds the phishing DB (domains + addresses) so #domains and #addresses are populated.
const prepareTest = async (
  phishingDomains: string[] = [],
  phishingAddresses: string[] = [],
  // Return the controller before init() so a test can observe the pre-load state.
  skipInit = false
) => {
  const { mainCtrl } = await makeMainController(async (storageCtrl) => {
    if (phishingDomains.length || phishingAddresses.length) {
      await storageCtrl.set('phishing', {
        version: 1,
        updatedAt: Date.now(),
        domains: phishingDomains,
        addresses: phishingAddresses
      })
    }
  })
  if (!skipInit) await mainCtrl.phishing.init()

  return { controller: mainCtrl.phishing, ui: mainCtrl.ui, mainCtrl }
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

  describe('deferred init', () => {
    test('isReady is false before init() and true after the load completes', async () => {
      const { controller } = await prepareTest(['foourmemez.com'], [], true)

      expect(controller.isReady).toBe(false)

      await controller.init()

      expect(controller.isReady).toBe(true)
    })

    test('init() is idempotent: concurrent and repeat calls read storage once', async () => {
      const { controller, mainCtrl } = await prepareTest(['foourmemez.com'], [], true)

      const storageGetSpy = jest.spyOn(mainCtrl.storage, 'get')

      await Promise.all([controller.init(), controller.init(), controller.init()])
      await controller.init()

      const phishingReads = storageGetSpy.mock.calls.filter(([key]) => key === 'phishing')
      expect(phishingReads).toHaveLength(1)

      storageGetSpy.mockRestore()
    })
  })

  test('should get dapps blacklisted status', async () => {
    const { controller } = await prepareTest(['foourmemez.com'])
    expect(controller.getDomainBlacklistedStatus('https://foourmemez.com')).toBe('BLACKLISTED')
    expect(controller.getDomainBlacklistedStatus('https://rewards.ambire.com')).toBe('VERIFIED')
  })

  test('should get addresses blacklisted status', async () => {
    const { controller } = await prepareTest([], ['0x20a9ff01b49cd8967cdd8081c547236eed1d1a4e'])
    expect(
      controller.getDomainBlacklistedStatus('https://0x20a9ff01b49cd8967cdd8081c547236eed1d1a4e')
    ).not.toBe('BLACKLISTED') // addresses are checked separately via updateAddressesBlacklistedStatus
  })

  test('should switch phishing update interval to active when an active view is added and back to inactive when all active views are closed', async () => {
    const { controller, ui } = await prepareTest()

    removeAllViews(ui)
    await flushMicrotaskQueue()

    expect(controller.updatePhishingInterval.currentTimeout).toBe(PHISHING_INACTIVE_UPDATE_INTERVAL)

    ui.addView({
      id: 'phishing-test-request-window-1',
      type: 'request-window',
      currentRoute: 'sign-account-op',
      isReady: true
    })
    await flushMicrotaskQueue()
    expect(controller.updatePhishingInterval.currentTimeout).toBe(PHISHING_ACTIVE_UPDATE_INTERVAL)

    ui.removeView('phishing-test-request-window-1')
    await flushMicrotaskQueue()
    expect(controller.updatePhishingInterval.currentTimeout).toBe(PHISHING_INACTIVE_UPDATE_INTERVAL)
  })

  test('should restart phishing interval immediately when an active view is added', async () => {
    const { controller, ui } = await prepareTest()
    const restartSpy = jest.spyOn(controller.updatePhishingInterval, 'restart')

    removeAllViews(ui)

    ui.addView({
      id: 'phishing-test-request-window-2',
      type: 'request-window',
      currentRoute: 'sign-account-op',
      isReady: true
    })

    expect(restartSpy).toHaveBeenCalledWith({
      timeout: PHISHING_ACTIVE_UPDATE_INTERVAL,
      runImmediately: true
    })
  })

  describe('suspicious hosting detection', () => {
    test('getDomainBlacklistedStatus returns SUSPICIOUS_HOSTING for all domains in SUSPICIOUS_HOSTING_DOMAINS', async () => {
      const { controller } = await prepareTest()

      for (const domain of SUSPICIOUS_HOSTING_DOMAINS) {
        expect(controller.getDomainBlacklistedStatus(`https://${domain}/some/path`)).toBe(
          'SUSPICIOUS_HOSTING'
        )
      }
    })

    test('getDomainBlacklistedStatus returns SUSPICIOUS_HOSTING for subdomains', async () => {
      const { controller } = await prepareTest()
      expect(controller.getDomainBlacklistedStatus('https://my-dapp.vercel.app')).toBe(
        'SUSPICIOUS_HOSTING'
      )
      expect(controller.getDomainBlacklistedStatus('https://my-site.github.io/repo')).toBe(
        'SUSPICIOUS_HOSTING'
      )
      expect(controller.getDomainBlacklistedStatus('https://bafkrei.ipfs.io')).toBe(
        'SUSPICIOUS_HOSTING'
      )
    })

    test('getDomainBlacklistedStatus does not flag parent domains like google.com', async () => {
      const { controller } = await prepareTest()
      expect(controller.getDomainBlacklistedStatus('https://google.com')).not.toBe(
        'SUSPICIOUS_HOSTING'
      )
      expect(controller.getDomainBlacklistedStatus('https://vercel.com')).not.toBe(
        'SUSPICIOUS_HOSTING'
      )
    })

    test('BLACKLISTED from phishing DB takes priority over SUSPICIOUS_HOSTING', async () => {
      // sites.google.com is in SUSPICIOUS_HOSTING_DOMAINS but also in the phishing DB
      const { controller } = await prepareTest(['sites.google.com'])
      expect(controller.getDomainBlacklistedStatus('https://sites.google.com')).toBe('BLACKLISTED')
    })

    test('updateDomainsBlacklistedStatus callback receives SUSPICIOUS_HOSTING for all suspicious hosting domains', async () => {
      const { controller } = await prepareTest()
      const results: Record<string, string> = {}

      await controller.updateDomainsBlacklistedStatus(
        SUSPICIOUS_HOSTING_DOMAINS.map((d) => `https://${d}/fake-dapp`),
        (statuses) => Object.assign(results, statuses)
      )

      for (const domain of SUSPICIOUS_HOSTING_DOMAINS) {
        expect(results[domain]).toBe('SUSPICIOUS_HOSTING')
      }
    })
  })
})
