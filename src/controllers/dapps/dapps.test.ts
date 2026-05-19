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
  })

  describe('per-dapp account scoping', () => {
    const ADDR_1 = '0x16c81367c30c71d6B712355255A07FCe8fd3b5bB'
    const ADDR_2 = '0xa07D75aacEFd11b425AF7181958F0F85c312f143'
    const ADDR_3 = '0x4AA524DDa82630cE769e5C9d7ec7a45B94a41bc6'

    const prepareWithDapps = async (
      dapps: Dapp[],
      storageInit?: (storageCtrl: IStorageController) => Promise<void>
    ) =>
      prepareTest(async (storageCtrl) => {
        await storageCtrl.set('dappsV2', dapps)
        await storageCtrl.set('lastDappsUpdateVersion', '1.0.0')

        if (storageInit) {
          await storageInit(storageCtrl)
        }
      })

    test('broadcasts accountsChanged when selectedAccount changes; skips when unchanged or unrelated', async () => {
      const dappId = 'test-dapp.com'
      const { controller } = await prepareWithDapps([
        makeDapp({
          id: dappId,
          name: 'Test Dapp',
          url: `https://${dappId}`,
          isConnected: true,
          accountPreferences: {
            enabled: true,
            selectedAccount: ADDR_1,
            accounts: [ADDR_1, ADDR_2]
          }
        })
      ])

      const broadcastSpy = jest
        .spyOn(controller, 'broadcastDappSessionEvent')
        .mockResolvedValue(undefined)

      // Same selectedAccount - no broadcast
      controller.updateDapp(dappId, {
        accountPreferences: { enabled: true, selectedAccount: ADDR_1, accounts: [ADDR_1, ADDR_2] }
      })
      expect(broadcastSpy).not.toHaveBeenCalled()

      // Unrelated update - no broadcast
      controller.updateDapp(dappId, { chainId: 137 })
      expect(broadcastSpy).not.toHaveBeenCalled()

      // Changed selectedAccount - broadcast
      controller.updateDapp(dappId, {
        accountPreferences: { enabled: true, selectedAccount: ADDR_2, accounts: [ADDR_1, ADDR_2] }
      })
      expect(broadcastSpy).toHaveBeenCalledWith('accountsChanged', [ADDR_2], dappId, true)

      broadcastSpy.mockRestore()
    })

    test('broadcasts when accountPreferences are set for the first time', async () => {
      const dappId = 'no-prefs-dapp.com'
      const { controller } = await prepareWithDapps([
        makeDapp({
          id: dappId,
          name: 'No Prefs Dapp',
          url: `https://${dappId}`,
          isConnected: true
        })
      ])

      const broadcastSpy = jest
        .spyOn(controller, 'broadcastDappSessionEvent')
        .mockResolvedValue(undefined)

      controller.updateDapp(dappId, {
        accountPreferences: { enabled: true, selectedAccount: ADDR_1, accounts: [ADDR_1] }
      })

      expect(broadcastSpy).toHaveBeenCalledWith('accountsChanged', [ADDR_1], dappId, true)
      broadcastSpy.mockRestore()
    })

    test('updates dappToConnect when id matches; emits silent error for null or mismatched id', async () => {
      const { controller } = await prepareWithDapps([])
      const pendingDapp = makeDapp({
        id: 'pending-dapp.com',
        name: 'Pending Dapp',
        url: 'https://pending-dapp.com'
      })
      // Silence console.log from emitError
      const emitErrorSpy = jest.spyOn(controller as any, 'emitError').mockImplementation(() => {})

      // Error when dappToConnect is null
      controller.updateDappToConnect('pending-dapp.com', { name: 'Updated' })
      expect(emitErrorSpy).toHaveBeenCalledWith(expect.objectContaining({ level: 'silent' }))
      emitErrorSpy.mockClear()

      controller.dappToConnect = pendingDapp

      // Error when id doesn't match current dappToConnect
      controller.updateDappToConnect('other-dapp.com', { name: 'Updated' })
      expect(emitErrorSpy).toHaveBeenCalledWith(expect.objectContaining({ level: 'silent' }))
      expect(controller.dappToConnect!.name).toBe('Pending Dapp')
      emitErrorSpy.mockClear()

      // Success: id matches - dappToConnect is updated and emitUpdate fires
      await new Promise<void>((resolve) => {
        const unsubscribe = controller.onUpdate(() => {
          expect(controller.dappToConnect!.name).toBe('Updated Name')
          unsubscribe()
          resolve()
        })
        controller.updateDappToConnect('pending-dapp.com', { name: 'Updated Name' })
      })

      expect(emitErrorSpy).not.toHaveBeenCalled()
      emitErrorSpy.mockRestore()
    })

    test('broadcasts to all permitted sessions when no account preferences or preferences are disabled', async () => {
      const dappAId = 'dapp-a.com'
      const dappBId = 'dapp-b.com'
      const { controller } = await prepareWithDapps([
        makeDapp({ id: dappAId, name: 'Dapp A', url: `https://${dappAId}`, isConnected: true }),
        makeDapp({
          id: dappBId,
          name: 'Dapp B',
          url: `https://${dappBId}`,
          isConnected: true,
          accountPreferences: { enabled: false, selectedAccount: ADDR_1, accounts: [ADDR_1] }
        })
      ])

      await controller.getOrCreateDappSession({ tabId: 1, url: `https://${dappAId}` })
      await controller.getOrCreateDappSession({ tabId: 2, url: `https://${dappBId}` })

      const broadcastSpy = jest
        .spyOn(controller, 'broadcastDappSessionEvent')
        .mockResolvedValue(undefined)

      await controller.onSelectedAccountChange(ADDR_2)

      expect(broadcastSpy).toHaveBeenCalledWith('accountsChanged', [ADDR_2], dappAId, true)
      expect(broadcastSpy).toHaveBeenCalledWith('accountsChanged', [ADDR_2], dappBId, true)
      broadcastSpy.mockRestore()
    })

    test('respects account scoping: broadcasts when new account is in the list, skips when not', async () => {
      const dappInListId = 'dapp-in-list.com'
      const dappNotInListId = 'dapp-not-in-list.com'
      const { controller } = await prepareWithDapps([
        makeDapp({
          id: dappInListId,
          name: 'Dapp In List',
          url: `https://${dappInListId}`,
          isConnected: true,
          accountPreferences: {
            enabled: true,
            selectedAccount: ADDR_1,
            accounts: [ADDR_1, ADDR_2]
          }
        }),
        makeDapp({
          id: dappNotInListId,
          name: 'Dapp Not In List',
          url: `https://${dappNotInListId}`,
          isConnected: true,
          accountPreferences: {
            enabled: true,
            selectedAccount: ADDR_1,
            accounts: [ADDR_1, ADDR_3]
          }
        })
      ])

      await controller.getOrCreateDappSession({ tabId: 1, url: `https://${dappInListId}` })
      await controller.getOrCreateDappSession({ tabId: 2, url: `https://${dappNotInListId}` })

      const broadcastSpy = jest
        .spyOn(controller, 'broadcastDappSessionEvent')
        .mockResolvedValue(undefined)

      // ADDR_2 is in dappInList's accounts but not in dappNotInList's
      await controller.onSelectedAccountChange(ADDR_2)

      expect(broadcastSpy).toHaveBeenCalledWith('accountsChanged', [ADDR_2], dappInListId, true)
      expect(broadcastSpy).not.toHaveBeenCalledWith(
        'accountsChanged',
        [ADDR_2],
        dappNotInListId,
        true
      )
      broadcastSpy.mockRestore()
    })

    test('skips sessions for disconnected dapps', async () => {
      const dappId = 'disconnected-dapp.com'
      const { controller } = await prepareWithDapps([
        makeDapp({
          id: dappId,
          name: 'Disconnected Dapp',
          url: `https://${dappId}`,
          isConnected: false
        })
      ])

      await controller.getOrCreateDappSession({ tabId: 1, url: `https://${dappId}` })

      const broadcastSpy = jest
        .spyOn(controller, 'broadcastDappSessionEvent')
        .mockResolvedValue(undefined)

      await controller.onSelectedAccountChange(ADDR_1)

      expect(broadcastSpy).not.toHaveBeenCalled()
      broadcastSpy.mockRestore()
    })

    test('removes address from accounts, promotes selectedAccount if needed, keeps dapp connected when accounts remain', async () => {
      const dappId = 'multi-account-dapp.com'
      const { controller } = await prepareWithDapps([
        makeDapp({
          id: dappId,
          name: 'Multi Account Dapp',
          url: `https://${dappId}`,
          isConnected: true,
          accountPreferences: {
            enabled: true,
            selectedAccount: ADDR_1,
            accounts: [ADDR_1, ADDR_2, ADDR_3]
          }
        })
      ])

      // Remove the selected account - ADDR_2 should be promoted to selectedAccount
      controller.removeAccountData(ADDR_1)

      let dapp = controller.getDapp(dappId)!
      expect(dapp.isConnected).toBe(true)
      expect(dapp.accountPreferences!.accounts).toEqual([ADDR_2, ADDR_3])
      expect(dapp.accountPreferences!.selectedAccount).toBe(ADDR_2)

      // Remove a non-selected account - selectedAccount should remain ADDR_2
      controller.removeAccountData(ADDR_3)

      dapp = controller.getDapp(dappId)!
      expect(dapp.accountPreferences!.accounts).toEqual([ADDR_2])
      expect(dapp.accountPreferences!.selectedAccount).toBe(ADDR_2)
      expect(dapp.isConnected).toBe(true)
    })

    test('disconnects dapp and clears accountPreferences when last allowed account is removed', async () => {
      const dappId = 'single-account-dapp.com'
      const { controller } = await prepareWithDapps([
        makeDapp({
          id: dappId,
          name: 'Single Account Dapp',
          url: `https://${dappId}`,
          isConnected: true,
          accountPreferences: { enabled: true, selectedAccount: ADDR_1, accounts: [ADDR_1] }
        })
      ])

      controller.removeAccountData(ADDR_1)

      const dapp = controller.getDapp(dappId)!
      expect(dapp.isConnected).toBe(false)
      expect(dapp.accountPreferences).toBeUndefined()
    })

    test('skips dapps without accountPreferences or where address is absent; always calls emitUpdate', async () => {
      const dappNoPrefsId = 'no-prefs-dapp.com'
      const dappOtherAccountsId = 'other-accounts-dapp.com'
      const { controller } = await prepareWithDapps([
        makeDapp({
          id: dappNoPrefsId,
          name: 'No Prefs',
          url: `https://${dappNoPrefsId}`,
          isConnected: true
        }),
        makeDapp({
          id: dappOtherAccountsId,
          name: 'Other Accounts',
          url: `https://${dappOtherAccountsId}`,
          isConnected: true,
          accountPreferences: {
            enabled: true,
            selectedAccount: ADDR_2,
            accounts: [ADDR_2, ADDR_3]
          }
        })
      ])

      const emitUpdateSpy = jest.spyOn(controller as any, 'emitUpdate')
      controller.removeAccountData(ADDR_1)

      expect(controller.getDapp(dappNoPrefsId)!.accountPreferences).toBeUndefined()
      expect(controller.getDapp(dappOtherAccountsId)!.accountPreferences!.accounts).toEqual([
        ADDR_2,
        ADDR_3
      ])
      expect(emitUpdateSpy).toHaveBeenCalledTimes(1)
      emitUpdateSpy.mockRestore()
    })

    test('mainCtrl.selectAccount delegates to onSelectedAccountChange; removeAccount calls dapps.removeAccountData', async () => {
      const { mainCtrl } = await prepareWithDapps([], async (storageCtrl) => {
        await storageCtrl.set('accounts', [
          {
            addr: ADDR_1,
            associatedKeys: [ADDR_1],
            initialPrivileges: [],
            creation: null,
            preferences: { label: '', pfp: '' }
          },
          {
            addr: ADDR_2,
            associatedKeys: [ADDR_2],
            initialPrivileges: [],
            creation: null,
            preferences: { label: '', pfp: '' }
          }
        ])
        await storageCtrl.set('selectedAccount', ADDR_1)
      })

      const onSelectedAccountChangeSpy = jest
        .spyOn(mainCtrl.dapps, 'onSelectedAccountChange')
        .mockResolvedValue(undefined)
      const removeAccountDataSpy = jest
        .spyOn(mainCtrl.dapps, 'removeAccountData')
        .mockImplementation(() => {})

      await mainCtrl.selectAccount(ADDR_1)
      expect(onSelectedAccountChangeSpy).toHaveBeenCalledWith(ADDR_1)

      await mainCtrl.removeAccount(ADDR_1)
      expect(removeAccountDataSpy).toHaveBeenCalledWith(ADDR_1)
    })
  })
})
