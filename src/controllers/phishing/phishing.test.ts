import fetch from 'node-fetch'

import { expect, jest } from '@jest/globals'

import { makeMainController } from '../../../test/helpers/mainController'
import {
  PHISHING_ACTIVE_UPDATE_INTERVAL,
  PHISHING_INACTIVE_UPDATE_INTERVAL
} from '../../consts/intervals'
import { canBeTrustedByUser, PhishingController } from './phishing'
import { SUSPICIOUS_HOSTING_DOMAINS } from './suspiciousHostingDomains'

// Seeds the phishing DB (domains + addresses) so #domains and #addresses are populated.
const prepareTest = async (
  phishingDomains: string[] = [],
  phishingAddresses: string[] = [],
  // Return the controller before init() so a test can observe the pre-load state.
  skipInit = false
) => {
  const { mainCtrl } = await makeMainController(
    async (storageCtrl) => {
      if (phishingDomains.length || phishingAddresses.length) {
        await storageCtrl.set('phishing', {
          version: 1,
          updatedAt: Date.now(),
          domains: phishingDomains,
          addresses: phishingAddresses
        })
      }
    },
    { skipDappsAndPhishingInit: skipInit }
  )

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

  test('should enable the scam and phishing checker by default', async () => {
    const { controller, mainCtrl } = await prepareTest()

    expect(mainCtrl.featureFlags.isFeatureEnabled('scamAndPhishingChecker')).toBe(true)
    expect(controller.updatePhishingInterval.running).toBe(true)
  })

  test('should resolve domain checks without fetching and skip address checks when the checker is disabled', async () => {
    const fetchMock = jest.fn()
    const { mainCtrl } = await makeMainController(undefined, {
      skipDappsAndPhishingInit: true,
      overrides: {
        fetch: fetchMock,
        featureFlags: { scamAndPhishingChecker: false }
      }
    })
    const controller = mainCtrl.phishing

    await controller.init()
    expect(controller.updatePhishingInterval.running).toBe(false)

    jest.restoreAllMocks()
    fetchMock.mockClear()
    const domainCallback = jest.fn()
    const addressCallback = jest.fn()

    await controller.continuouslyUpdatePhishing()
    await controller.updateDomainsBlacklistedStatus(['https://example.com'], domainCallback)
    await controller.updateAddressesBlacklistedStatus(
      ['0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'],
      addressCallback
    )

    expect(fetchMock).not.toHaveBeenCalled()
    expect(domainCallback).toHaveBeenCalledWith({ 'example.com': 'FAILED_TO_GET' })
    expect(addressCallback).not.toHaveBeenCalled()
  })

  test('should check addresses when the checker is enabled', async () => {
    const address = '0x20a9ff01b49cd8967cdd8081c547236eed1d1a4e'
    const { controller } = await prepareTest([], [address])
    const callback = jest.fn()

    await controller.updateAddressesBlacklistedStatus([address], callback)

    expect(callback).toHaveBeenCalledWith({ [address]: 'BLACKLISTED' })
  })

  test('should stop updates when disabled and restart immediately when re-enabled', async () => {
    const { controller, mainCtrl } = await prepareTest()
    const stopSpy = jest.spyOn(controller.updatePhishingInterval, 'stop')

    await mainCtrl.featureFlags.setFeatureFlag('scamAndPhishingChecker', false)
    expect(stopSpy).toHaveBeenCalled()

    const restartSpy = jest.spyOn(controller.updatePhishingInterval, 'restart')
    await mainCtrl.featureFlags.setFeatureFlag('scamAndPhishingChecker', true)

    expect(restartSpy).toHaveBeenCalledWith({
      timeout: PHISHING_INACTIVE_UPDATE_INTERVAL,
      runImmediately: true
    })
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

  describe('getAddressBlacklistedStatus', () => {
    const LOWERCASE_SCAM_ADDRESS = '0x20a9ff01b49cd8967cdd8081c547236eed1d1a4e'
    const CHECKSUMMED_SCAM_ADDRESS = '0x20A9Ff01B49cD8967Cdd8081C547236EED1D1a4e'
    const SAFE_ADDRESS = '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'

    test('should return BLACKLISTED for a listed address, whatever the casing of the checked address', async () => {
      const { controller } = await prepareTest([], [LOWERCASE_SCAM_ADDRESS])
      expect(controller.getAddressBlacklistedStatus(LOWERCASE_SCAM_ADDRESS)).toBe('BLACKLISTED')
      expect(controller.getAddressBlacklistedStatus(CHECKSUMMED_SCAM_ADDRESS)).toBe('BLACKLISTED')
    })

    test('should return VERIFIED for an address that is not in the list', async () => {
      const { controller } = await prepareTest([], [LOWERCASE_SCAM_ADDRESS])
      expect(controller.getAddressBlacklistedStatus(SAFE_ADDRESS)).toBe('VERIFIED')
    })

    test('should return VERIFIED and never throw for input that is not an address', async () => {
      const { controller } = await prepareTest([], [LOWERCASE_SCAM_ADDRESS])
      expect(controller.getAddressBlacklistedStatus('not-an-address')).toBe('VERIFIED')
      expect(controller.getAddressBlacklistedStatus('')).toBe('VERIFIED')
    })

    test('should return undefined while the list is empty, so that callers can tell it apart from a checked address', async () => {
      const { controller } = await prepareTest()
      expect(controller.getAddressBlacklistedStatus(LOWERCASE_SCAM_ADDRESS)).toBeUndefined()
    })
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

  describe('update on boot', () => {
    const STORED_SCAM_ADDRESS = '0x20a9ff01b49cd8967cdd8081c547236eed1d1a4e'
    const CHECKSUMMED_DELTA_SCAM_ADDRESS = '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'
    const SNAPSHOT_SCAM_ADDRESS = '0x1a633538b169b41052bfc40b0c973ac1bff31a4e'
    const STORED_SCAM_DOMAIN = 'foourmemez.com'
    const DELTA_SCAM_DOMAIN = 'wallet-premium.org'
    const SNAPSHOT_SCAM_DOMAIN = 'listandvoting.digital'
    const SCAMCHECKER_BASE_URL = 'https://cena.ambire.com/api/v3/scamchecker'
    const STORED_VERSION = 1
    const SERVER_VERSION = 2
    // Any timestamp far enough in the past that the "skip a recent update" guard lets the update run.
    const STALE_UPDATED_AT = 1

    // The full snapshot the relayer serves at /data. Domains and addresses are plain strings here,
    // unlike the {op, domain} / {op, address} entries of a delta - which is exactly what made the
    // boot race throw: a snapshot parsed by the delta branch destructures `address` to undefined.
    const dataResponse = {
      version: SERVER_VERSION,
      domains: [SNAPSHOT_SCAM_DOMAIN],
      addresses: [SNAPSHOT_SCAM_ADDRESS]
    }
    const getUpdateResponse = {
      fromVersion: STORED_VERSION,
      toVersion: SERVER_VERSION,
      domains: [{ op: 'add', domain: DELTA_SCAM_DOMAIN }],
      addresses: [{ op: 'add', address: CHECKSUMMED_DELTA_SCAM_ADDRESS }]
    }

    /**
     * Builds a controller whose phishing storage read is held back until the returned
     * `releaseStorageRead` is called, so a test can act on it while init() is still loading.
     */
    const prepareBootRaceTest = async ({ seedStorage }: { seedStorage: boolean }) => {
      // Only the scamchecker calls are served locally. Everything else the main controller fetches
      // on boot goes to the real fetch, so this test changes nothing for the other controllers.
      const fetchedUrls: string[] = []
      const mockFetch = jest.fn((url: string, options?: any) => {
        if (!url.startsWith(SCAMCHECKER_BASE_URL)) return (fetch as any)(url, options)

        fetchedUrls.push(url)

        return Promise.resolve({
          ok: true,
          status: 200,
          url,
          json: async () => (url.includes('/get_update') ? getUpdateResponse : dataResponse)
        })
      })

      const { mainCtrl } = await makeMainController(
        async (storageCtrl) => {
          if (!seedStorage) return

          await storageCtrl.set('phishing', {
            version: STORED_VERSION,
            updatedAt: STALE_UPDATED_AT,
            domains: [STORED_SCAM_DOMAIN],
            addresses: [STORED_SCAM_ADDRESS]
          })
        },
        { skipDappsAndPhishingInit: true, overrides: { fetch: mockFetch } }
      )

      const controller = mainCtrl.phishing
      // makeMainController stubs the update out for every other test, but this one is about it.
      const updateSpy = PhishingController.prototype
        .continuouslyUpdatePhishing as unknown as jest.SpiedFunction<
        PhishingController['continuouslyUpdatePhishing']
      >
      updateSpy.mockRestore()

      let releaseStorageRead: () => void = () => {}
      const storageReadGate = new Promise<void>((resolve) => {
        releaseStorageRead = resolve
      })
      const originalGet = mainCtrl.storage.get.bind(mainCtrl.storage)
      const storageGetSpy = jest
        .spyOn(mainCtrl.storage, 'get')
        .mockImplementation(async (key: string, defaults?: any) => {
          if (key === 'phishing') await storageReadGate

          return originalGet(key, defaults)
        })

      const cleanup = () => {
        controller.updatePhishingInterval.stop()
        storageGetSpy.mockRestore()
      }

      return { controller, ui: mainCtrl.ui, fetchedUrls, releaseStorageRead, cleanup }
    }

    test('a view added before init() only arms the active interval and fetches nothing', async () => {
      const { controller, ui, fetchedUrls, releaseStorageRead, cleanup } =
        await prepareBootRaceTest({ seedStorage: true })

      removeAllViews(ui)
      ui.addView({
        id: 'phishing-boot-race-request-window',
        type: 'request-window',
        currentRoute: 'sign-account-op',
        isReady: true
      })
      await flushMicrotaskQueue()

      // The view used to restart the interval right here, which ran an update with version 0: it
      // pulled the full list and then parsed it as a delta, once init() had set the version.
      expect(controller.isReady).toBe(false)
      expect(controller.updatePhishingInterval.running).toBe(false)
      expect(controller.updatePhishingInterval.currentTimeout).toBe(PHISHING_ACTIVE_UPDATE_INTERVAL)
      expect(fetchedUrls).toHaveLength(0)

      releaseStorageRead()
      await controller.init()
      await controller.updatePhishingInterval.promise

      // init() starts the interval, so the update finally runs - with the stored version, and on
      // the active timeout the view asked for.
      expect(controller.updatePhishingInterval.currentTimeout).toBe(PHISHING_ACTIVE_UPDATE_INTERVAL)
      expect(fetchedUrls).toEqual([`${SCAMCHECKER_BASE_URL}/get_update?version=${STORED_VERSION}`])
      expect(controller.getDomainBlacklistedStatus(`https://${DELTA_SCAM_DOMAIN}`)).toBe(
        'BLACKLISTED'
      )
      // The stored entries survive a delta, and the added one is matched whatever its casing.
      expect(controller.getDomainBlacklistedStatus(`https://${STORED_SCAM_DOMAIN}`)).toBe(
        'BLACKLISTED'
      )
      expect(controller.getAddressBlacklistedStatus(CHECKSUMMED_DELTA_SCAM_ADDRESS)).toBe(
        'BLACKLISTED'
      )
      expect(controller.getAddressBlacklistedStatus(STORED_SCAM_ADDRESS)).toBe('BLACKLISTED')

      cleanup()
    })

    test('an update called while init() is loading fetches nothing, and init() runs it with the stored version', async () => {
      const { controller, fetchedUrls, releaseStorageRead, cleanup } = await prepareBootRaceTest({
        seedStorage: true
      })

      const initPromise = controller.init()
      await controller.continuouslyUpdatePhishing()

      // The early call returns without fetching, since init() has not read the version yet.
      expect(controller.isReady).toBe(false)
      expect(fetchedUrls).toHaveLength(0)

      releaseStorageRead()
      await initPromise
      await controller.updatePhishingInterval.promise

      // Only the update init() starts runs, and it asks for a delta from the stored version.
      expect(fetchedUrls).toEqual([`${SCAMCHECKER_BASE_URL}/get_update?version=${STORED_VERSION}`])

      cleanup()
    })

    test('an update called before init() was ever called fetches nothing', async () => {
      const { controller, fetchedUrls, releaseStorageRead, cleanup } = await prepareBootRaceTest({
        seedStorage: true
      })

      releaseStorageRead()
      await controller.continuouslyUpdatePhishing()
      await flushMicrotaskQueue()

      // Running here would ask for the full list with version 0 and later parse it as a delta.
      expect(controller.initialLoadPromise).toBeUndefined()
      expect(controller.isReady).toBe(false)
      expect(controller.updatePhishingInterval.running).toBe(false)
      expect(fetchedUrls).toHaveLength(0)

      await controller.init()
      await controller.updatePhishingInterval.promise

      expect(fetchedUrls).toEqual([`${SCAMCHECKER_BASE_URL}/get_update?version=${STORED_VERSION}`])
      expect(controller.getAddressBlacklistedStatus(STORED_SCAM_ADDRESS)).toBe('BLACKLISTED')

      cleanup()
    })
  })

  describe('suspicious hosting detection', () => {
    test('getDomainBlacklistedStatus returns SUSPICIOUS_HOSTING for all domains in SUSPICIOUS_HOSTING_DOMAINS', async () => {
      const { controller } = await prepareTest()

      for (const { hostSuffix: domain } of SUSPICIOUS_HOSTING_DOMAINS) {
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

    test('getDomainBlacklistedStatus returns SUSPICIOUS_HOSTING for a fully-qualified host with a trailing dot', async () => {
      const { controller } = await prepareTest(['some-other-phishing-site.com'])

      // "my-dapp.vercel.app." loads the identical site as "my-dapp.vercel.app" - DNS, TLS and the
      // browser treat the trailing root-label dot as the same host - so it must not slip through.
      expect(controller.getDomainBlacklistedStatus('https://my-dapp.vercel.app./')).toBe(
        'SUSPICIOUS_HOSTING'
      )
      expect(controller.getDomainBlacklistedStatus('https://example.web.app./claim')).toBe(
        'SUSPICIOUS_HOSTING'
      )
      expect(controller.getDomainBlacklistedStatus('https://sites.google.com./view/fake')).toBe(
        'SUSPICIOUS_HOSTING'
      )
    })

    test('getDomainBlacklistedStatus flags a trailing-dot host regardless of casing, www. or repeated dots', async () => {
      const { controller } = await prepareTest(['some-other-phishing-site.com'])

      expect(controller.getDomainBlacklistedStatus('https://My-Dapp.Vercel.App./')).toBe(
        'SUSPICIOUS_HOSTING'
      )
      expect(controller.getDomainBlacklistedStatus('https://www.my-dapp.vercel.app./')).toBe(
        'SUSPICIOUS_HOSTING'
      )
      expect(controller.getDomainBlacklistedStatus('https://my-dapp.vercel.app../')).toBe(
        'SUSPICIOUS_HOSTING'
      )
      // The URL parser maps the ideographic full stop to a regular dot, trailing one included.
      expect(controller.getDomainBlacklistedStatus('https://my-dapp。vercel。app。/')).toBe(
        'SUSPICIOUS_HOSTING'
      )
    })

    test('getDomainBlacklistedStatus keeps not flagging parent domains written with a trailing dot', async () => {
      const { controller } = await prepareTest(['some-other-phishing-site.com'])

      expect(controller.getDomainBlacklistedStatus('https://google.com./')).not.toBe(
        'SUSPICIOUS_HOSTING'
      )
      expect(controller.getDomainBlacklistedStatus('https://vercel.com./')).not.toBe(
        'SUSPICIOUS_HOSTING'
      )
    })

    test('updateDomainsBlacklistedStatus callback receives SUSPICIOUS_HOSTING for all suspicious hosting domains', async () => {
      const { controller } = await prepareTest()
      const results: Record<string, string> = {}

      await controller.updateDomainsBlacklistedStatus(
        SUSPICIOUS_HOSTING_DOMAINS.map(({ hostSuffix }) => `https://${hostSuffix}/fake-dapp`),
        (statuses) => Object.assign(results, statuses)
      )

      for (const { hostSuffix: domain } of SUSPICIOUS_HOSTING_DOMAINS) {
        expect(results[domain]).toBe('SUSPICIOUS_HOSTING')
      }
    })
  })

  describe('canBeTrustedByUser', () => {
    test('allows a dApp on its own subdomain of a platform that hands out one per app', () => {
      expect(canBeTrustedByUser('https://my-dapp.vercel.app')).toBe(true)
      expect(canBeTrustedByUser('https://my-dapp.pages.dev/swap')).toBe(true)
      expect(canBeTrustedByUser('https://bafkrei.ipfs.dweb.link')).toBe(true)
      // GitHub Pages gives the subdomain to the account and the path to the repo. The account owns
      // the whole hostname either way, so the hostname is the smallest honest unit of trust.
      expect(canBeTrustedByUser('https://my-account.github.io/my-dapp')).toBe(true)
    })

    test("refuses the platform's own hostname, which every app there shares", () => {
      expect(canBeTrustedByUser('https://vercel.app')).toBe(false)
      expect(canBeTrustedByUser('https://github.io')).toBe(false)
      // The path form of a gateway - the hostname is the gateway, shared by all content it serves.
      expect(canBeTrustedByUser('https://dweb.link/ipfs/bafkrei')).toBe(false)
      expect(canBeTrustedByUser('https://ipfs.io/ipfs/bafkrei')).toBe(false)
    })

    test('refuses every platform where unrelated apps share one hostname', () => {
      const sharedHostnamePlatforms = SUSPICIOUS_HOSTING_DOMAINS.filter(
        ({ isAppPerSubdomain }) => !isAppPerSubdomain
      )
      expect(sharedHostnamePlatforms.length).toBeGreaterThan(0)

      for (const { hostSuffix } of sharedHostnamePlatforms) {
        expect(canBeTrustedByUser(`https://${hostSuffix}`)).toBe(false)
        expect(canBeTrustedByUser(`https://${hostSuffix}/some-dapp`)).toBe(false)
      }
    })

    test('refuses a dApp that is not on a shared hosting platform at all', () => {
      expect(canBeTrustedByUser('https://app.uniswap.org')).toBe(false)
      expect(canBeTrustedByUser('https://google.com')).toBe(false)
    })

    test('matches the canonical hostname, so a trailing dot cannot dodge the check', () => {
      expect(canBeTrustedByUser('https://my-dapp.vercel.app./swap')).toBe(true)
      expect(canBeTrustedByUser('https://sites.google.com./my-dapp')).toBe(false)
    })

    test('refuses an unparsable url', () => {
      expect(canBeTrustedByUser('not a url')).toBe(false)
      expect(canBeTrustedByUser('')).toBe(false)
    })
  })

  describe('fully-qualified (trailing dot) hostnames', () => {
    test('getDomainBlacklistedStatus returns BLACKLISTED for a host-level phishing DB entry visited with a trailing dot', async () => {
      const { controller } = await prepareTest(['example.web.app'])

      expect(controller.getDomainBlacklistedStatus('https://example.web.app')).toBe('BLACKLISTED')
      expect(controller.getDomainBlacklistedStatus('https://example.web.app./')).toBe('BLACKLISTED')
      expect(controller.getDomainBlacklistedStatus('https://example.web.app./claim?ref=1')).toBe(
        'BLACKLISTED'
      )
    })

    test('getDomainBlacklistedStatus returns BLACKLISTED for an apex phishing DB entry and its subdomains visited with a trailing dot', async () => {
      const { controller } = await prepareTest(['foourmemez.com'])

      expect(controller.getDomainBlacklistedStatus('https://foourmemez.com./')).toBe('BLACKLISTED')
      expect(controller.getDomainBlacklistedStatus('https://claim.foourmemez.com./')).toBe(
        'BLACKLISTED'
      )
    })

    test('getDomainBlacklistedStatus matches an internationalized phishing DB entry written in unicode with a trailing dot', async () => {
      // The DB stores punycode, which is also what the URL parser produces for a unicode host.
      const { controller } = await prepareTest(['xn--e1afmkfd.xn--90ae'])

      expect(controller.getDomainBlacklistedStatus('https://пример.бг./')).toBe('BLACKLISTED')
      expect(controller.getDomainBlacklistedStatus('https://xn--e1afmkfd.xn--90ae./')).toBe(
        'BLACKLISTED'
      )
    })

    test('getDomainBlacklistedStatus returns VERIFIED for an unrelated host with a trailing dot', async () => {
      const { controller } = await prepareTest(['example.web.app'])

      expect(controller.getDomainBlacklistedStatus('https://rewards.ambire.com./')).toBe('VERIFIED')
    })

    test('updateDomainsBlacklistedStatus keys the callback by the canonical dApp id', async () => {
      const { controller } = await prepareTest(['some-other-phishing-site.com'])
      const results: Record<string, string> = {}

      await controller.updateDomainsBlacklistedStatus(
        ['https://example.web.app./claim'],
        (statuses) => Object.assign(results, statuses)
      )

      expect(results['example.web.app']).toBe('SUSPICIOUS_HOSTING')
      expect(results['example.web.app.']).toBeUndefined()
    })
  })
})
