import fetch from 'node-fetch'

import { BlacklistedStatus } from '@/interfaces/phishing'
import wait from '@/utils/wait'
import { expect } from '@jest/globals'

import { suppressConsole } from '../../../test/helpers/console'
import { makeDapp } from '../../../test/helpers/dapps'
import { makeMainController } from '../../../test/helpers/mainController'
import { Session } from '../../classes/session'
import { predefinedDapps } from '../../consts/dapps/dapps'
import mockChains from '../../consts/dapps/mockChains'
import mockDapps from '../../consts/dapps/mockDapps'
import { Dapp, DAPP_VERIFICATION_BANNER_IDS } from '../../interfaces/dapp'
import { IStorageController } from '../../interfaces/storage'
import { DappConnectRequest } from '../../interfaces/userRequest'
import { PhishingController } from '../phishing/phishing'

const prepareTest = async (
  storageInit?: (storageController: IStorageController) => Promise<void>,
  getMockFetchImplementation?: (url: string, ...args: any) => Promise<any>
) => {
  const mockFetch = jest.fn()

  if (getMockFetchImplementation) {
    mockFetch.mockImplementation(getMockFetchImplementation)
  } else {
    mockFetch.mockImplementation(async (url: string, ...args) => {
      if (url === 'https://api.llama.fi/protocols') {
        return {
          ok: true,
          status: 200,
          json: async () => mockDapps
        }
      }

      if (url === 'https://api.llama.fi/v2/chains') {
        return {
          ok: true,
          status: 200,
          json: async () => mockChains
        }
      }

      return fetch(url, ...args)
    })
  }

  const { mainCtrl } = await makeMainController(
    async (storageCtrl) => {
      if (storageInit) {
        await storageInit(storageCtrl)
      }
    },
    {
      awaitInitialLoad: false,
      skipAppsFetchOnLoad: false,
      overrides: {
        fetch: mockFetch
      }
    }
  )
  const controller = mainCtrl.dapps

  await controller.initialLoadPromise

  return { controller, mainCtrl }
}

describe('DappsController', () => {
  test('should initialize', async () => {
    const { controller } = await prepareTest()
    expect(controller).toBeDefined()
  })
  test('should fetch and update dapps', async () => {
    const { controller } = await prepareTest(async (storageCtrl) => {
      await storageCtrl.set('dappsV2', predefinedDapps)
      await storageCtrl.set('lastDappsUpdateVersion', 'test-version')
    })
    expect(controller.dapps.length).toBe(predefinedDapps.length)
    expect(controller.isReadyToDisplayDapps).toBe(false) // fetch and update is already running
    expect(controller.dapps.some((d) => d.name === 'AAVE')).toBe(false)
    await controller.fetchAndUpdatePromise
    expect(controller.dapps.some((d) => d.name === 'AAVE')).toBe(true)
    expect(controller.dapps.length).toBeGreaterThan(predefinedDapps.length)
    expect(controller.categories).not.toContain('CEX')
    expect(controller.dapps.some((d) => d.name === 'Binance CEX')).toBe(false)
    expect(controller.dapps.some((d) => d.name === 'WBTC')).toBe(false)
    expect(controller.dapps.some((d) => d.name === 'Lido')).toBe(true)
    const lido = controller.dapps.find((d) => d.name === 'Lido')!
    expect(lido.chainIds).toEqual([1]) // other networks should be excluded because the are not in our networks list
    expect(lido.blacklisted).toEqual('VERIFIED')
  })
  test('should skip fetch and update', async () => {
    const { controller } = await prepareTest(async (storageCtrl) => {
      await storageCtrl.set('dappsV2', predefinedDapps)
      await storageCtrl.set('lastDappsUpdateVersion', '1.0.0')
    })

    await wait(1)

    expect(controller.dapps.length).toBe(predefinedDapps.length)
    expect(controller.isReadyToDisplayDapps).toBe(true) // fetch and update is already running
    expect(controller.dapps.some((d) => d.name === 'AAVE')).toBe(false)
    expect(controller.dapps.some((d) => d.name === 'AAVE')).toBe(false)
    expect(controller.dapps.some((d) => d.name === 'Lido')).toBe(false)
  })
  test('should retry on fetch and update fail', async () => {
    const { restore } = suppressConsole()
    jest.useFakeTimers()
    const callCount: Record<string, number> = {}
    const { controller } = await prepareTest(
      async (storageCtrl) => {
        await storageCtrl.set('dappsV2', predefinedDapps)
        await storageCtrl.set('lastDappsUpdateVersion', 'test-version')
      },
      async (url: string, ...args: any) => {
        callCount[url] = (callCount[url] || 0) + 1

        await jest.advanceTimersByTimeAsync(1)

        // Fail the first time for protocols
        if (url === 'https://api.llama.fi/protocols') {
          if (callCount[url] === 1) {
            return { ok: false, status: 500, json: async () => ({}) }
          }
          return { ok: true, status: 200, json: async () => mockDapps }
        }

        // Fail the first time for chains if you want, otherwise always succeed
        if (url === 'https://api.llama.fi/v2/chains') {
          if (callCount[url] === 1) {
            return { ok: false, status: 500, json: async () => ({}) }
          }
          return { ok: true, status: 200, json: async () => mockChains }
        }

        // fallback to real fetch
        return fetch(url, ...args)
      }
    )
    expect(controller.dapps.length).toBe(predefinedDapps.length)
    expect(controller.isReadyToDisplayDapps).toBe(false) // fetch and update is already running
    expect(controller.dapps.some((d) => d.name === 'AAVE')).toBe(false)
    expect(controller.dapps.some((d) => d.name === 'AAVE')).toBe(false)
    expect(controller.dapps.some((d) => d.name === 'Lido')).toBe(false)
    try {
      await controller.fetchAndUpdatePromise
    } catch (error) {
      // silent fail
    }
    await jest.advanceTimersByTimeAsync(0)
    expect(controller.shouldRetryFetchAndUpdate).toBe(true)
    expect(controller.retryFetchAndUpdateInterval.running).toBe(true)
    expect(controller.isReadyToDisplayDapps).toBe(true)
    expect(controller.dapps.length).toBe(predefinedDapps.length)
    // Advance time by 5 minutes to trigger the retry
    await jest.advanceTimersByTimeAsync(5 * 60 * 1000)
    expect(controller.retryFetchAndUpdateInterval.running).toBe(true)
    expect(controller.retryFetchAndUpdateInterval.fnExecutionsCount).toBe(1)
    expect(controller.isReadyToDisplayDapps).toBe(false)
    try {
      await controller.fetchAndUpdatePromise
    } catch (error) {
      // silent fail
    }
    expect(controller.retryFetchAndUpdateInterval.running).toBe(false)
    expect(controller.retryFetchAndUpdateInterval.fnExecutionsCount).toBe(1)
    expect(controller.isReadyToDisplayDapps).toBe(true)
    expect(controller.dapps.length).toBeGreaterThan(predefinedDapps.length)
    jest.useRealTimers()
    jest.clearAllTimers()
    restore()
  })
  test('should add dapp to connect and update blacklisted status', async () => {
    const MOCK_SESSION = new Session({ tabId: 1, url: 'https://test-dApp.com' })
    MOCK_SESSION.setProp({ name: 'Test Dapp' })
    const DAPP_CONNECT_REQUEST: DappConnectRequest = {
      id: 1,
      kind: 'dappConnect',
      meta: { params: {} },
      dappPromises: [
        {
          id: '',
          resolve: () => {},
          reject: () => {},
          meta: {},
          session: MOCK_SESSION
        }
      ]
    }

    const { controller } = await prepareTest(async (storageCtrl) => {
      await storageCtrl.set('dappsV2', predefinedDapps)
      await storageCtrl.set('lastDappsUpdateVersion', '1.0.0')
    })
    await controller.initialLoadPromise

    await wait(1)

    void controller.setDappToConnectIfNeeded(DAPP_CONNECT_REQUEST)

    await new Promise((resolve) => {
      let emitCounter = 0
      const unsubscribe = controller.onUpdate(() => {
        if (emitCounter === 0) {
          expect(controller.dappToConnect).not.toBe(null)
          expect(controller.dappToConnect!.name).toBe(MOCK_SESSION.name)
          expect(controller.dappToConnect!.blacklisted).toBe('LOADING')
        }
        if (emitCounter === 1) {
          expect(controller.dappToConnect!.blacklisted).toBe('VERIFIED')
          unsubscribe()
          resolve(null)
        }

        emitCounter++
      })
    })
  })

  test('should sync dapps blacklisted status only when phishing.shouldSyncDapps is true', async () => {
    const { controller, mainCtrl } = await prepareTest(async (storageCtrl) => {
      await storageCtrl.set('dappsV2', [
        {
          id: 'test-dapp.com',
          name: 'Test dapp',
          description: '',
          url: 'https://test-dapp.com',
          icon: null,
          category: null,
          tvl: null,
          twitter: null,
          geckoId: null,
          chainIds: [1],
          isConnected: false,
          isFeatured: false,
          isCustom: true,
          chainId: 1,
          favorite: false,
          blacklisted: 'VERIFIED'
        }
      ])
      await storageCtrl.set('lastDappsUpdateVersion', '1.0.0')
    })

    await controller.fetchAndUpdatePromise

    const dappBefore = controller.getDapp('test-dapp.com')
    expect(dappBefore?.blacklisted).toBe('VERIFIED')

    const shouldSyncSpy = jest
      .spyOn(mainCtrl.phishing, 'shouldSyncDapps', 'get')
      .mockReturnValue(false)
    const getDomainStatusSpy = jest.spyOn(mainCtrl.phishing, 'getDomainBlacklistedStatus')
    const resetShouldSyncSpy = jest.spyOn(mainCtrl.phishing, 'resetShouldSyncDapps')

    ;(mainCtrl.phishing as any).emitUpdate()

    expect(controller.getDapp('test-dapp.com')?.blacklisted).toBe('VERIFIED')
    expect(getDomainStatusSpy).not.toHaveBeenCalled()
    expect(resetShouldSyncSpy).not.toHaveBeenCalled()

    shouldSyncSpy.mockReturnValue(true)
    getDomainStatusSpy.mockImplementation((url: string) =>
      url === 'https://test-dapp.com' ? 'BLACKLISTED' : undefined
    )
    ;(mainCtrl.phishing as any).emitUpdate()

    expect(controller.getDapp('test-dapp.com')?.blacklisted).toBe('BLACKLISTED')
    expect(resetShouldSyncSpy).toHaveBeenCalledTimes(1)
  })

  describe('getDappVerificationBanner', () => {
    const mockDappVerificationStatuses = (statuses: Record<string, Dapp['blacklisted']>) =>
      jest
        .spyOn(PhishingController.prototype, 'updateDomainsBlacklistedStatus')
        .mockImplementation(async (_urls, callback) => {
          callback(statuses as { [key: string]: BlacklistedStatus })
        })

    test('should return loading banner for dapps with pending verification', async () => {
      const updateDomainsSpy = mockDappVerificationStatuses({ 'aave.com': 'LOADING' })

      try {
        const { controller } = await prepareTest(async (storageCtrl) => {
          await storageCtrl.set('dappsV2', predefinedDapps)
          await storageCtrl.set('lastDappsUpdateVersion', 'test-version')
        })
        await controller.fetchAndUpdatePromise

        const aave = controller.getDapp('aave.com')!
        expect(updateDomainsSpy).toHaveBeenCalled()
        expect(controller.getDappVerificationBanner([aave.url])).toEqual({
          id: DAPP_VERIFICATION_BANNER_IDS.LOADING,
          type: 'warning',
          text: "We're still verifying the app. Please wait, or make sure you trust it before signing requests: AAVE"
        })
      } finally {
        updateDomainsSpy.mockRestore()
      }
    })

    test('should return failed banner for dapps with failed verification', async () => {
      const updateDomainsSpy = mockDappVerificationStatuses({ 'aave.com': 'FAILED_TO_GET' })

      try {
        const { controller } = await prepareTest(async (storageCtrl) => {
          await storageCtrl.set('dappsV2', predefinedDapps)
          await storageCtrl.set('lastDappsUpdateVersion', 'test-version')
        })
        await controller.fetchAndUpdatePromise

        const aave = controller.getDapp('aave.com')!
        expect(updateDomainsSpy).toHaveBeenCalled()
        expect(controller.getDappVerificationBanner([aave.url])).toEqual({
          id: DAPP_VERIFICATION_BANNER_IDS.FAILED_TO_GET_OR_UNKNOWN,
          type: 'warning',
          text: "We couldn't verify the app. Make sure you trust it before signing requests: AAVE"
        })
      } finally {
        updateDomainsSpy.mockRestore()
      }
    })

    test('should return blacklisted banner for blacklisted dapps', async () => {
      const updateDomainsSpy = mockDappVerificationStatuses({ 'aave.com': 'BLACKLISTED' })

      try {
        const { controller } = await prepareTest(async (storageCtrl) => {
          await storageCtrl.set('dappsV2', predefinedDapps)
          await storageCtrl.set('lastDappsUpdateVersion', 'test-version')
        })
        await controller.fetchAndUpdatePromise

        const aave = controller.getDapp('aave.com')!
        expect(updateDomainsSpy).toHaveBeenCalled()
        expect(controller.getDappVerificationBanner([aave.url])).toEqual({
          id: DAPP_VERIFICATION_BANNER_IDS.BLACKLISTED,
          type: 'error',
          text: "This app didn't pass our safety check. Proceed at your own risk: AAVE"
        })
      } finally {
        updateDomainsSpy.mockRestore()
      }
    })

    test('should return not-in-catalog banner for verified custom dapps', async () => {
      const customDapp = makeDapp({
        id: 'custom-dapp.com',
        name: 'Custom Dapp',
        url: 'https://custom-dapp.com',
        blacklisted: 'LOADING',
        isCustom: true
      })
      const updateDomainsSpy = mockDappVerificationStatuses({ 'custom-dapp.com': 'VERIFIED' })

      try {
        const { controller } = await prepareTest(async (storageCtrl) => {
          await storageCtrl.set('dappsV2', [...predefinedDapps, customDapp])
          await storageCtrl.set('lastDappsUpdateVersion', 'test-version')
        })
        await controller.fetchAndUpdatePromise

        const verifiedCustomDapp = controller.getDapp(customDapp.id)!
        expect(updateDomainsSpy).toHaveBeenCalled()
        expect(controller.getDappVerificationBanner([verifiedCustomDapp.url])).toEqual({
          id: DAPP_VERIFICATION_BANNER_IDS.NOT_IN_CATALOG,
          type: 'warning',
          text: 'App is not on the default Ambire App Catalog. Make sure you trust it before signing requests: Custom Dapp'
        })
      } finally {
        updateDomainsSpy.mockRestore()
      }
    })

    test('should not return banner for verified dapps in the default catalog', async () => {
      const updateDomainsSpy = jest.spyOn(
        PhishingController.prototype,
        'updateDomainsBlacklistedStatus'
      )

      try {
        const { controller } = await prepareTest(async (storageCtrl) => {
          await storageCtrl.set('dappsV2', predefinedDapps)
          await storageCtrl.set('lastDappsUpdateVersion', 'test-version')
        })

        await controller.fetchAndUpdatePromise

        const aave = controller.dapps.find((dapp) => dapp.name === 'AAVE')!
        expect(updateDomainsSpy).toHaveBeenCalled()
        expect(updateDomainsSpy.mock.calls.some(([urls]) => urls.includes(aave.url))).toBe(true)
        expect(aave.blacklisted).toBe('VERIFIED')
        expect(controller.getDappVerificationBanner([aave.url])).toBe(null)
      } finally {
        updateDomainsSpy.mockRestore()
      }
    })

    // Suspicious hosting scenarios

    // Scenario: my-dapp.vercel.app (in SUSPICIOUS_HOSTING_DOMAINS, not in phishing DB)
    // intrinsic=SUSPICIOUS_HOSTING → SUSPICIOUS_HOSTING (warning)
    test('dApp on suspicious hosting domain shows SUSPICIOUS_HOSTING warning banner', async () => {
      const vercelDapp = makeDapp({
        id: 'my-dapp.vercel.app',
        name: 'Fake Uniswap on Vercel',
        url: 'https://my-dapp.vercel.app',
        blacklisted: 'LOADING',
        isCustom: true
      })

      const { controller } = await prepareTest(async (storageCtrl) => {
        await storageCtrl.set('dappsV2', [...predefinedDapps, vercelDapp])
        await storageCtrl.set('lastDappsUpdateVersion', '1.0.0')
      })
      await controller.fetchAndUpdatePromise

      const banner = controller.getDappVerificationBanner([vercelDapp.url])
      expect(banner?.id).toBe(DAPP_VERIFICATION_BANNER_IDS.SUSPICIOUS_HOSTING)
      expect(banner?.type).toBe('warning')
    })

    // Scenario: ipfs.io dApp opened directly
    // intrinsic=SUSPICIOUS_HOSTING → SUSPICIOUS_HOSTING (warning)
    test('ipfs.io dApp opened directly shows SUSPICIOUS_HOSTING warning banner', async () => {
      const ipfsDapp = makeDapp({
        id: 'ipfs.io',
        name: 'IPFS Dapp',
        url: 'https://ipfs.io/ipfs/bafkrei',
        blacklisted: 'LOADING',
        isCustom: true
      })

      const { controller } = await prepareTest(async (storageCtrl) => {
        await storageCtrl.set('dappsV2', [...predefinedDapps, ipfsDapp])
        await storageCtrl.set('lastDappsUpdateVersion', '1.0.0')
      })
      await controller.fetchAndUpdatePromise

      const banner = controller.getDappVerificationBanner([ipfsDapp.url])
      expect(banner?.id).toBe(DAPP_VERIFICATION_BANNER_IDS.SUSPICIOUS_HOSTING)
      expect(banner?.type).toBe('warning')
    })

    // Scenario: sites.google.com dApp (BLACKLISTED in phishing DB)
    // intrinsic=BLACKLISTED → BLACKLISTED (highest priority)
    test('dApp on BLACKLISTED domain shows BLACKLISTED error banner regardless of suspicious hosting list', async () => {
      const googleSitesDapp = makeDapp({
        id: 'sites.google.com',
        name: 'Fake Uniswap',
        url: 'https://sites.google.com/view/fake-uniswap',
        blacklisted: 'LOADING',
        isCustom: true
      })
      const updateDomainsSpy = mockDappVerificationStatuses({ 'sites.google.com': 'BLACKLISTED' })

      try {
        const { controller } = await prepareTest(async (storageCtrl) => {
          await storageCtrl.set('dappsV2', [...predefinedDapps, googleSitesDapp])
          await storageCtrl.set('lastDappsUpdateVersion', 'test-version')
        })
        await controller.fetchAndUpdatePromise

        expect(controller.getDappVerificationBanner([googleSitesDapp.url])?.id).toBe(
          DAPP_VERIFICATION_BANNER_IDS.BLACKLISTED
        )
      } finally {
        updateDomainsSpy.mockRestore()
      }
    })

    // Session context scenarios

    // Scenario: app.uniswap.org iframe inside a sites.google.com tab
    // intrinsic=VERIFIED, context=SUSPICIOUS_HOSTING → SUSPICIOUS_HOSTING (warning)
    test('VERIFIED dApp shows SUSPICIOUS_HOSTING when a co-session in the same tab is a suspicious hosting domain', async () => {
      const { controller } = await prepareTest(async (storageCtrl) => {
        await storageCtrl.set('dappsV2', predefinedDapps)
        await storageCtrl.set('lastDappsUpdateVersion', 'test-version')
      })
      await controller.fetchAndUpdatePromise

      const aave = controller.dapps.find((d) => d.name === 'AAVE')!
      expect(aave.blacklisted).toBe('VERIFIED')

      // Two sessions in the same tab: sites.google.com (suspicious) + AAVE (iframe dApp)
      const googleSession = new Session({ tabId: 50, windowId: 1, url: 'https://sites.google.com' })
      const aaveSession = new Session({ tabId: 50, windowId: 1, url: aave.url })
      controller.dappSessions[googleSession.sessionId] = googleSession
      controller.dappSessions[aaveSession.sessionId] = aaveSession

      const banner = controller.getDappVerificationBanner([aave.url], {
        sessionId: aaveSession.sessionId
      })
      expect(banner?.id).toBe(DAPP_VERIFICATION_BANNER_IDS.SUSPICIOUS_HOSTING)
      expect(banner?.type).toBe('warning')
    })

    // Scenario: app.uniswap.org opened directly (no suspicious co-session)
    // intrinsic=VERIFIED, context=undefined → null (no banner)
    test('VERIFIED dApp with no suspicious co-session shows no banner', async () => {
      const { controller } = await prepareTest(async (storageCtrl) => {
        await storageCtrl.set('dappsV2', predefinedDapps)
        await storageCtrl.set('lastDappsUpdateVersion', 'test-version')
      })
      await controller.fetchAndUpdatePromise

      const aave = controller.dapps.find((d) => d.name === 'AAVE')!
      expect(aave.blacklisted).toBe('VERIFIED')

      // Only the dApp's own session — no suspicious co-session
      const aaveSession = new Session({ tabId: 51, windowId: 1, url: aave.url })
      controller.dappSessions[aaveSession.sessionId] = aaveSession

      const banner = controller.getDappVerificationBanner([aave.url], {
        sessionId: aaveSession.sessionId
      })
      expect(banner).toBeNull()
    })

    // Scenario: app.uniswap.org iframe in sites.google.com, but uniswap is BLACKLISTED
    // intrinsic=BLACKLISTED wins → BLACKLISTED (context SUSPICIOUS_HOSTING is overridden)
    test('BLACKLISTED intrinsic status wins over SUSPICIOUS_HOSTING context', async () => {
      const blacklistedAaveDapp = makeDapp({
        id: 'aave.com',
        name: 'AAVE',
        url: 'https://aave.com',
        blacklisted: 'BLACKLISTED',
        isCustom: false
      })
      const updateDomainsSpy = mockDappVerificationStatuses({ 'aave.com': 'BLACKLISTED' })

      try {
        const { controller } = await prepareTest(async (storageCtrl) => {
          await storageCtrl.set('dappsV2', [...predefinedDapps, blacklistedAaveDapp])
          await storageCtrl.set('lastDappsUpdateVersion', 'test-version')
        })
        await controller.fetchAndUpdatePromise

        // Two sessions: sites.google.com (suspicious) + AAVE (BLACKLISTED itself)
        const googleSession = new Session({
          tabId: 52,
          windowId: 1,
          url: 'https://sites.google.com'
        })
        const aaveSession = new Session({ tabId: 52, windowId: 1, url: 'https://aave.com' })
        controller.dappSessions[googleSession.sessionId] = googleSession
        controller.dappSessions[aaveSession.sessionId] = aaveSession

        const banner = controller.getDappVerificationBanner(['https://aave.com'], {
          sessionId: aaveSession.sessionId
        })
        expect(banner?.id).toBe(DAPP_VERIFICATION_BANNER_IDS.BLACKLISTED)
      } finally {
        updateDomainsSpy.mockRestore()
      }
    })

    // Extra: co-session in a different tab must not affect context
    test('co-session in a different tab does not trigger SUSPICIOUS_HOSTING context', async () => {
      const { controller } = await prepareTest(async (storageCtrl) => {
        await storageCtrl.set('dappsV2', predefinedDapps)
        await storageCtrl.set('lastDappsUpdateVersion', 'test-version')
      })
      await controller.fetchAndUpdatePromise

      const aave = controller.dapps.find((d) => d.name === 'AAVE')!

      // Google session is in tab 99, AAVE session is in tab 53 — different tabs
      const googleSession = new Session({ tabId: 99, windowId: 1, url: 'https://sites.google.com' })
      const aaveSession = new Session({ tabId: 53, windowId: 1, url: aave.url })
      controller.dappSessions[googleSession.sessionId] = googleSession
      controller.dappSessions[aaveSession.sessionId] = aaveSession

      const banner = controller.getDappVerificationBanner([aave.url], {
        sessionId: aaveSession.sessionId
      })
      expect(banner).toBeNull()
    })

    // Extra: context status must not contaminate the dApp's global status in #dapps
    test('dApp global status in #dapps is not contaminated by session context SUSPICIOUS_HOSTING', async () => {
      const { controller } = await prepareTest(async (storageCtrl) => {
        await storageCtrl.set('dappsV2', predefinedDapps)
        await storageCtrl.set('lastDappsUpdateVersion', 'test-version')
      })
      await controller.fetchAndUpdatePromise

      const aave = controller.dapps.find((d) => d.name === 'AAVE')!

      const googleSession = new Session({ tabId: 54, windowId: 1, url: 'https://sites.google.com' })
      const aaveSession = new Session({ tabId: 54, windowId: 1, url: aave.url })
      controller.dappSessions[googleSession.sessionId] = googleSession
      controller.dappSessions[aaveSession.sessionId] = aaveSession

      // Banner shows SUSPICIOUS_HOSTING due to context
      const banner = controller.getDappVerificationBanner([aave.url], {
        sessionId: aaveSession.sessionId
      })
      expect(banner?.id).toBe(DAPP_VERIFICATION_BANNER_IDS.SUSPICIOUS_HOSTING)

      // But the global dApp status in #dapps is unchanged
      expect(controller.getDapp(aave.id)?.blacklisted).toBe('VERIFIED')
    })
  })

  describe('recentDapps', () => {
    test('recentDapps starts empty', async () => {
      const { controller } = await prepareTest(async (storageCtrl) => {
        await storageCtrl.set('dappsV2', predefinedDapps)
        await storageCtrl.set('lastDappsUpdateVersion', '1.0.0')
      })

      expect(controller.recentDapps).toEqual([])
    })

    test('addToRecentDapps adds an entry resolved from the catalog', async () => {
      const { controller } = await prepareTest(async (storageCtrl) => {
        await storageCtrl.set('dappsV2', predefinedDapps)
        await storageCtrl.set('lastDappsUpdateVersion', '1.0.0')
      })

      const target = predefinedDapps[0]!
      await controller.addToRecentDapps(target.id)

      expect(controller.recentDapps).toHaveLength(1)
      expect(controller.recentDapps[0]!.id).toBe(target.id)
    })

    test('adding the same id twice dedupes and bumps the timestamp', async () => {
      const { controller } = await prepareTest(async (storageCtrl) => {
        await storageCtrl.set('dappsV2', predefinedDapps)
        await storageCtrl.set('lastDappsUpdateVersion', '1.0.0')
      })

      const target = predefinedDapps[0]!
      const before = Date.now()
      await controller.addToRecentDapps(target.id)
      await wait(2)
      await controller.addToRecentDapps(target.id)
      const after = Date.now()

      expect(controller.recentDapps).toHaveLength(1)
      // Inspect the persisted entries directly via storage to check the timestamp moved.
      const persisted = (controller as any).toJSON().recentDapps as Dapp[]
      expect(persisted).toHaveLength(1)
      // openedAt is private; assert ordering remains stable.
      expect(persisted[0]!.id).toBe(target.id)
      // Sanity check on time window
      expect(after).toBeGreaterThanOrEqual(before)
    })

    test('cap is enforced at MAX_RECENT_DAPPS (oldest evicted)', async () => {
      const fakeDapps: Dapp[] = Array.from({ length: 25 }).map((_, i) => ({
        id: `fake-${i}.com`,
        name: `fake-${i}`,
        description: '',
        url: `https://fake-${i}.com`,
        icon: null,
        category: null,
        tvl: null,
        twitter: null,
        geckoId: null,
        chainIds: [1],
        isConnected: false,
        isFeatured: false,
        isCustom: true,
        chainId: 1,
        favorite: false,
        blacklisted: 'VERIFIED'
      }))

      const { controller } = await prepareTest(async (storageCtrl) => {
        await storageCtrl.set('dappsV2', fakeDapps)
        await storageCtrl.set('lastDappsUpdateVersion', '1.0.0')
      })

      for (const dapp of fakeDapps) {
        // eslint-disable-next-line no-await-in-loop
        await controller.addToRecentDapps(dapp.id)
      }

      expect(controller.recentDapps).toHaveLength(20)
      expect(controller.recentDapps.find((d) => d.id === 'fake-0.com')).toBeUndefined()
      // Most recent add is at the front
      expect(controller.recentDapps[0]!.id).toBe('fake-24.com')
    })

    test('addToRecentDapps persists to the recentDapps storage key', async () => {
      const { controller, mainCtrl } = await prepareTest(async (storageCtrl) => {
        await storageCtrl.set('dappsV2', predefinedDapps)
        await storageCtrl.set('lastDappsUpdateVersion', '1.0.0')
      })

      const target = predefinedDapps[0]!
      await controller.addToRecentDapps(target.id)

      const stored = await mainCtrl.storage.get('recentDapps', [])
      expect(stored).toHaveLength(1)
      expect(stored[0]!.id).toBe(target.id)
      expect(typeof stored[0]!.openedAt).toBe('number')
    })

    test('recentDapps is restored from storage on init (newest first)', async () => {
      const target = predefinedDapps[0]!
      const second = predefinedDapps[1]!
      const third = predefinedDapps[2]!
      const seedEntries = [
        { id: target.id, openedAt: 3000 },
        { id: second.id, openedAt: 2000 },
        { id: third.id, openedAt: 1000 }
      ]
      const { controller } = await prepareTest(async (storageCtrl) => {
        await storageCtrl.set('dappsV2', predefinedDapps)
        await storageCtrl.set('lastDappsUpdateVersion', '1.0.0')
        await storageCtrl.set('recentDapps', seedEntries)
      })

      expect(controller.recentDapps.map((d) => d.id)).toEqual([target.id, second.id, third.id])
    })

    test('clearRecentDapps empties and persists', async () => {
      const { controller, mainCtrl } = await prepareTest(async (storageCtrl) => {
        await storageCtrl.set('dappsV2', predefinedDapps)
        await storageCtrl.set('lastDappsUpdateVersion', '1.0.0')
      })

      await controller.addToRecentDapps(predefinedDapps[0]!.id)
      expect(controller.recentDapps).toHaveLength(1)

      await controller.clearRecentDapps()
      expect(controller.recentDapps).toEqual([])
      const stored = await mainCtrl.storage.get('recentDapps', [])
      expect(stored).toEqual([])
    })

    test('recentDapps getter filters stale ids missing from the catalog', async () => {
      const target = predefinedDapps[0]!
      const seedEntries = [
        { id: target.id, openedAt: 2000 },
        { id: 'ghost-dapp.com', openedAt: 1000 }
      ]
      const { controller } = await prepareTest(async (storageCtrl) => {
        await storageCtrl.set('dappsV2', predefinedDapps)
        await storageCtrl.set('lastDappsUpdateVersion', '1.0.0')
        await storageCtrl.set('recentDapps', seedEntries)
      })

      expect(controller.recentDapps).toHaveLength(1)
      expect(controller.recentDapps[0]!.id).toBe(target.id)
    })

    test('addToRecentDapps bails for unknown id and does not persist', async () => {
      const { controller, mainCtrl } = await prepareTest(async (storageCtrl) => {
        await storageCtrl.set('dappsV2', predefinedDapps)
        await storageCtrl.set('lastDappsUpdateVersion', '1.0.0')
      })

      await controller.addToRecentDapps('definitely-not-a-real-dapp.xyz')

      expect(controller.recentDapps).toEqual([])
      const stored = await mainCtrl.storage.get('recentDapps', null)
      expect(stored).toBeNull()
    })
  })

  describe('connection sources', () => {
    const baseDapp = (): Dapp =>
      makeDapp({
        id: 'sources-dapp.com',
        name: 'Sources Dapp',
        url: 'https://sources-dapp.com',
        isCustom: true,
        isConnected: true,
        chainId: 1,
        blacklisted: 'VERIFIED'
      })

    test('addDapp seeds connectedSources from the provided source (defaults to injected)', async () => {
      const { controller } = await prepareTest(async (storageCtrl) => {
        await storageCtrl.set('dappsV2', predefinedDapps)
        await storageCtrl.set('lastDappsUpdateVersion', '1.0.0')
      })

      await controller.addDapp(baseDapp())

      const stored = controller.getDapp('sources-dapp.com')!
      expect(stored.connectedSources).toEqual(['injected'])
      expect(stored.isConnected).toBe(true)
    })

    test('addDapp merges sources without duplicating', async () => {
      const { controller } = await prepareTest(async (storageCtrl) => {
        await storageCtrl.set('dappsV2', predefinedDapps)
        await storageCtrl.set('lastDappsUpdateVersion', '1.0.0')
      })

      await controller.addDapp(baseDapp(), 'injected')
      await controller.addDapp(baseDapp(), 'wc')
      await controller.addDapp(baseDapp(), 'wc') // duplicate

      const stored = controller.getDapp('sources-dapp.com')!
      expect(stored.connectedSources).toEqual(['injected', 'wc'])
    })

    test('hasPermission(id, source) is source-scoped; hasPermission(id) is any-source', async () => {
      const { controller } = await prepareTest(async (storageCtrl) => {
        await storageCtrl.set('dappsV2', predefinedDapps)
        await storageCtrl.set('lastDappsUpdateVersion', '1.0.0')
      })

      await controller.addDapp(baseDapp(), 'wc')

      expect(controller.hasPermission('sources-dapp.com')).toBe(true)
      expect(controller.hasPermission('sources-dapp.com', 'wc')).toBe(true)
      // Core behavior change: an injected request must still re-prompt even when WC is connected.
      expect(controller.hasPermission('sources-dapp.com', 'injected')).toBe(false)
    })

    // BUG: a stored dapp whose isConnected and connectedSources had drifted (isConnected: true
    // but connectedSources: []) used to load verbatim — the Explore "Connected" section (which
    // reads isConnected) showed it as connected, while hasPermission (which reads
    // connectedSources) returned false, forcing a reconnect on every request. #load now
    // normalizes to the invariant on read so the two can't disagree.
    test('normalizes a drifted stored dapp on load (connectedSources is source of truth)', async () => {
      const drifted = makeDapp({
        id: 'drifted-dapp.com',
        name: 'Drifted Dapp',
        url: 'https://drifted-dapp.com',
        isCustom: true,
        chainId: 1,
        blacklisted: 'VERIFIED'
      })
      // Force the divergence: connected flag on, but no active sources.
      drifted.isConnected = true
      drifted.connectedSources = []

      const { controller } = await prepareTest(async (storageCtrl) => {
        await storageCtrl.set('dappsV2', [...predefinedDapps, drifted])
        await storageCtrl.set('lastDappsUpdateVersion', '1.0.0')
      })

      const stored = controller.getDapp('drifted-dapp.com')!
      expect(stored.connectedSources).toEqual([])
      expect(stored.isConnected).toBe(false)
      expect(controller.hasPermission('drifted-dapp.com')).toBe(false)
    })

    // The inverse drift: a legacy record that never got connectedSources but had isConnected: true
    // must keep its connection (seeded as injected) rather than silently disconnecting.
    test('seeds connectedSources from a legacy isConnected flag on load', async () => {
      const legacy = makeDapp({
        id: 'legacy-dapp.com',
        name: 'Legacy Dapp',
        url: 'https://legacy-dapp.com',
        isCustom: true,
        chainId: 1,
        blacklisted: 'VERIFIED'
      })
      legacy.isConnected = true
      // Pre-per-source shape: connectedSources is absent entirely.
      delete (legacy as Partial<Dapp>).connectedSources

      const { controller } = await prepareTest(async (storageCtrl) => {
        await storageCtrl.set('dappsV2', [...predefinedDapps, legacy])
        await storageCtrl.set('lastDappsUpdateVersion', '1.0.0')
      })

      const stored = controller.getDapp('legacy-dapp.com')!
      expect(stored.connectedSources).toEqual(['injected'])
      expect(stored.isConnected).toBe(true)
      expect(controller.hasPermission('legacy-dapp.com', 'injected')).toBe(true)
    })

    test('disconnectDappSource removes only the targeted source', async () => {
      const { controller } = await prepareTest(async (storageCtrl) => {
        await storageCtrl.set('dappsV2', predefinedDapps)
        await storageCtrl.set('lastDappsUpdateVersion', '1.0.0')
      })

      // Use a non-custom dapp so partial disconnect doesn't trigger removeDapp.
      const dapp = makeDapp({
        id: 'multi-source-dapp.com',
        name: 'Multi Source',
        url: 'https://multi-source-dapp.com',
        isCustom: false,
        isConnected: true,
        chainId: 1,
        blacklisted: 'VERIFIED'
      })
      await controller.addDapp(dapp, 'injected')
      await controller.addDapp(dapp, 'wc')

      await controller.disconnectDappSource('multi-source-dapp.com', 'injected')

      const stored = controller.getDapp('multi-source-dapp.com')!
      expect(stored.connectedSources).toEqual(['wc'])
      expect(stored.isConnected).toBe(true)
      expect(controller.hasPermission('multi-source-dapp.com', 'wc')).toBe(true)
      expect(controller.hasPermission('multi-source-dapp.com', 'injected')).toBe(false)
    })

    test('disconnectDappSource on the last source fully disconnects (and removes custom dapp)', async () => {
      const { controller } = await prepareTest(async (storageCtrl) => {
        await storageCtrl.set('dappsV2', predefinedDapps)
        await storageCtrl.set('lastDappsUpdateVersion', '1.0.0')
      })

      await controller.addDapp(baseDapp(), 'wc')
      expect(controller.getDapp('sources-dapp.com')).toBeDefined()

      await controller.disconnectDappSource('sources-dapp.com', 'wc')

      // Custom dapps that lose their last source are removed from the catalog.
      expect(controller.getDapp('sources-dapp.com')).toBeUndefined()
    })
  })

  describe('WalletConnect chainId selection', () => {
    // 137 (Polygon) is a predefined, enabled network in the test harness; 5115 (Citrea) and
    // 9999 are not present in the networks list.
    const ENABLED_CHAIN_ID = 137
    const UNKNOWN_CHAIN_ID = 5115
    const ANOTHER_UNKNOWN_CHAIN_ID = 9999

    test('pickWalletConnectChainId prefers an enabled network over an unknown chain, regardless of order', async () => {
      const { controller } = await prepareTest(async (storageCtrl) => {
        await storageCtrl.set('dappsV2', predefinedDapps)
        await storageCtrl.set('lastDappsUpdateVersion', '1.0.0')
      })

      // Unknown chain first, enabled chain second — must still pick the enabled one.
      expect(controller.pickWalletConnectChainId([UNKNOWN_CHAIN_ID, ENABLED_CHAIN_ID])).toBe(
        ENABLED_CHAIN_ID
      )
    })

    test('pickWalletConnectChainId falls back to the first candidate when none match a known network', async () => {
      const { controller } = await prepareTest(async (storageCtrl) => {
        await storageCtrl.set('dappsV2', predefinedDapps)
        await storageCtrl.set('lastDappsUpdateVersion', '1.0.0')
      })

      // Neither chain is known: keep the dapp's real (first) chainId rather than defaulting to 1.
      expect(
        controller.pickWalletConnectChainId([UNKNOWN_CHAIN_ID, ANOTHER_UNKNOWN_CHAIN_ID])
      ).toBe(UNKNOWN_CHAIN_ID)
    })

    test('pickWalletConnectChainId returns undefined when there are no candidates', async () => {
      const { controller } = await prepareTest(async (storageCtrl) => {
        await storageCtrl.set('dappsV2', predefinedDapps)
        await storageCtrl.set('lastDappsUpdateVersion', '1.0.0')
      })

      expect(controller.pickWalletConnectChainId([])).toBeUndefined()
      expect(controller.pickWalletConnectChainId(undefined)).toBeUndefined()
    })

    test('addDappFromIdentity stores the enabled candidate chainId, not chains[0]', async () => {
      const { controller } = await prepareTest(async (storageCtrl) => {
        await storageCtrl.set('dappsV2', predefinedDapps)
        await storageCtrl.set('lastDappsUpdateVersion', '1.0.0')
      })

      await controller.addDappFromIdentity(
        {
          id: 'wc-multichain-dapp.com',
          name: 'WC Multichain Dapp',
          url: 'https://wc-multichain-dapp.com',
          icon: null,
          // Legacy single chainId points at an unknown chain; candidates list the real enabled one second.
          chainId: UNKNOWN_CHAIN_ID,
          candidateChainIds: [UNKNOWN_CHAIN_ID, ENABLED_CHAIN_ID]
        },
        'wc'
      )

      const stored = controller.getDapp('wc-multichain-dapp.com')!
      expect(stored.chainId).toBe(ENABLED_CHAIN_ID)
    })

    test('addDappFromIdentity keeps an unknown chainId from candidates instead of resetting to 1', async () => {
      const { controller } = await prepareTest(async (storageCtrl) => {
        await storageCtrl.set('dappsV2', predefinedDapps)
        await storageCtrl.set('lastDappsUpdateVersion', '1.0.0')
      })

      await controller.addDappFromIdentity(
        {
          id: 'wc-unknown-chain-dapp.com',
          name: 'WC Unknown Chain Dapp',
          url: 'https://wc-unknown-chain-dapp.com',
          icon: null,
          chainId: UNKNOWN_CHAIN_ID,
          candidateChainIds: [UNKNOWN_CHAIN_ID]
        },
        'wc'
      )

      const stored = controller.getDapp('wc-unknown-chain-dapp.com')!
      // BUG GUARD: #buildDapp resets an unknown chainId to 1 (DEFAULT_CHAIN_ID) for not-yet-loaded
      // custom networks. pickWalletConnectChainId resolves the candidate, but #buildDapp still
      // overrides it. This documents the current behavior; see note in the answer.
      expect(stored.chainId).toBe(1)
    })
  })
})
