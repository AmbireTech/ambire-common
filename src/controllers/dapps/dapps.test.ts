import fetch from 'node-fetch'

import { expect } from '@jest/globals'

import { relayerUrl } from '../../../test/config'
import { produceMemoryStore } from '../../../test/helpers'
import { mockUiManager } from '../../../test/helpers/ui'
import { Session } from '../../classes/session'
import { predefinedDapps } from '../../consts/dapps/dapps'
import mockChains from '../../consts/dapps/mockChains'
import mockDapps from '../../consts/dapps/mockDapps'
import { IProvidersController } from '../../interfaces/provider'
import { IStorageController, Storage } from '../../interfaces/storage'
import { DappConnectRequest } from '../../interfaces/userRequest'
import { AccountsController } from '../accounts/accounts'
import { AddressBookController } from '../addressBook/addressBook'
import { AutoLoginController } from '../autoLogin/autoLogin'
import { InviteController } from '../invite/invite'
import { KeystoreController } from '../keystore/keystore'
import { NetworksController } from '../networks/networks'
import { PhishingController } from '../phishing/phishing'
import { ProvidersController } from '../providers/providers'
import { SelectedAccountController } from '../selectedAccount/selectedAccount'
import { StorageController } from '../storage/storage'
import { UiController } from '../ui/ui'
import { DappsController } from './dapps'

const prepareTest = async (
  storageInit?: (storageController: IStorageController) => Promise<void>,
  getMockFetchImplementation?: (url: string, ...args: any) => Promise<any>
) => {
  const storage: Storage = produceMemoryStore()
  const storageCtrl = new StorageController(storage)

  !!storageInit && (await storageInit(storageCtrl))

  let providersCtrl: IProvidersController
  const networksCtrl = new NetworksController({
    storage: storageCtrl,
    fetch,
    relayerUrl,
    useTempProvider: (props, cb) => {
      return providersCtrl.useTempProvider(props, cb)
    },
    onAddOrUpdateNetworks: () => {},
    onReady: async () => {
      await providersCtrl.init({ networks: networksCtrl.allNetworks })
    }
  })
  const { uiManager } = mockUiManager()
  const uiCtrl = new UiController({ uiManager })
  providersCtrl = new ProvidersController({
    storage: storageCtrl,
    getNetworks: () => networksCtrl.allNetworks,
    sendUiMessage: () => uiCtrl.message.sendUiMessage
  })
  const keystore = new KeystoreController('default', storageCtrl, {}, uiCtrl)
  const accountsCtrl = new AccountsController(
    storageCtrl,
    providersCtrl,
    networksCtrl,
    keystore,
    () => {},
    () => {},
    () => {},
    relayerUrl,
    fetch
  )
  const autoLoginCtrl = new AutoLoginController(
    storageCtrl,
    keystore,
    providersCtrl,
    networksCtrl,
    accountsCtrl,
    {},
    new InviteController({ relayerUrl, fetch, storage: storageCtrl })
  )
  const selectedAccountCtrl = new SelectedAccountController({
    storage: storageCtrl,
    accounts: accountsCtrl,
    autoLogin: autoLoginCtrl
  })
  const addressBookCtrl = new AddressBookController(storageCtrl, accountsCtrl, selectedAccountCtrl)

  const phishingCtrl = new PhishingController({
    fetch,
    storage: storageCtrl,
    addressBook: addressBookCtrl
  })

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
  const controller = new DappsController({
    fetch: mockFetch,
    appVersion: '1.0.0',
    storage: storageCtrl,
    networks: networksCtrl,
    phishing: phishingCtrl,
    ui: uiCtrl
  })
  await controller.initialLoadPromise

  return { controller }
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
    expect(controller.dapps.length).toBe(predefinedDapps.length)
    expect(controller.isReadyToDisplayDapps).toBe(true) // fetch and update is already running
    expect(controller.dapps.some((d) => d.name === 'AAVE')).toBe(false)
    expect(controller.dapps.some((d) => d.name === 'AAVE')).toBe(false)
    expect(controller.dapps.some((d) => d.name === 'Lido')).toBe(false)
  })
  test('should retry on fetch and update fail', async () => {
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
          dapp: null,
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

    controller.setDappToConnectIfNeeded(DAPP_CONNECT_REQUEST)

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
})
