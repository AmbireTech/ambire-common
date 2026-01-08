import fetch from 'node-fetch'

import { expect } from '@jest/globals'

import { relayerUrl, velcroUrl } from '../../../test/config'
import { produceMemoryStore } from '../../../test/helpers'
import { mockUiManager } from '../../../test/helpers/ui'
import { DEFAULT_ACCOUNT_LABEL } from '../../consts/account'
import { networks } from '../../consts/networks'
import { IProvidersController } from '../../interfaces/provider'
import { Storage } from '../../interfaces/storage'
import { DeFiPositionsError } from '../../libs/defiPositions/types'
import { KeystoreSigner } from '../../libs/keystoreSigner/keystoreSigner'
import { stringify } from '../../libs/richJson/richJson'
import { DEFAULT_SELECTED_ACCOUNT_PORTFOLIO } from '../../libs/selectedAccount/selectedAccount'
import { getRpcProvider } from '../../services/provider'
import { AccountsController } from '../accounts/accounts'
import { AutoLoginController } from '../autoLogin/autoLogin'
import { BannerController } from '../banner/banner'
import EventEmitter from '../eventEmitter/eventEmitter'
import { InviteController } from '../invite/invite'
import { KeystoreController } from '../keystore/keystore'
import { NetworksController } from '../networks/networks'
import { PortfolioController } from '../portfolio/portfolio'
import { ProvidersController } from '../providers/providers'
import { StorageController } from '../storage/storage'
import { UiController } from '../ui/ui'
import { SelectedAccountController } from './selectedAccount'

const accounts = [
  {
    addr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
    associatedKeys: ['0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'],
    initialPrivileges: [],
    creation: {
      factoryAddr: '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA',
      bytecode:
        '0x7f00000000000000000000000000000000000000000000000000000000000000017f02c94ba85f2ea274a3869293a0a9bf447d073c83c617963b0be7c862ec2ee44e553d602d80604d3d3981f3363d3d373d3d3d363d732a2b85eb1054d6f0c6c2e37da05ed3e5fea684ef5af43d82803e903d91602b57fd5bf3',
      salt: '0x2ee01d932ede47b0b2fb1b6af48868de9f86bfc9a5be2f0b42c0111cf261d04c'
    },
    preferences: {
      label: DEFAULT_ACCOUNT_LABEL,
      pfp: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'
    }
  },
  {
    addr: '0xC2E6dFcc2C6722866aD65F211D5757e1D2879337',
    initialPrivileges: [],
    associatedKeys: ['0x5Be214147EA1AE3653f289E17fE7Dc17A73AD175'],
    creation: {
      factoryAddr: '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA',
      bytecode:
        '0x7f00000000000000000000000000000000000000000000000000000000000000017f02c94ba85f2ea274a3869293a0a9bf447d073c83c617963b0be7c862ec2ee44e553d602d80604d3d3981f3363d3d373d3d3d363d732a2b85eb1054d6f0c6c2e37da05ed3e5fea684ef5af43d82803e903d91602b57fd5bf3',
      salt: '0x2ee01d932ede47b0b2fb1b6af48868de9f86bfc9a5be2f0b42c0111cf261d04c'
    },
    preferences: {
      label: DEFAULT_ACCOUNT_LABEL,
      pfp: '0xC2E6dFcc2C6722866aD65F211D5757e1D2879337'
    }
  }
]

const waitSelectedAccCtrlPortfolioAllReady = (selectedAccountCtrl: SelectedAccountController) => {
  return new Promise((resolve) => {
    const unsubscribe = selectedAccountCtrl.onUpdate(() => {
      if (selectedAccountCtrl.portfolio.isAllReady) {
        unsubscribe()
        resolve(true)
      }
    })
  })
}

const forceBannerRecalculation = async (providersCtrl: IProvidersController) => {
  // Portfolio and DeFi positions banners are recalculated on every emitUpdate
  // of the providers controller.
  await providersCtrl.forceEmitUpdate()
}

const waitNextControllerUpdate = (ctrl: EventEmitter) => {
  return new Promise((resolve) => {
    const unsubscribe = ctrl.onUpdate(() => {
      unsubscribe()
      resolve(true)
    })
  })
}

const prepareTest = async () => {
  const providers = Object.fromEntries(
    networks.map((network) => [network.chainId, getRpcProvider(network.rpcUrls, network.chainId)])
  )

  const storage: Storage = produceMemoryStore()
  let providersCtrl: IProvidersController
  const storageCtrl = new StorageController(storage)
  const networksCtrl = new NetworksController({
    storage: storageCtrl,
    fetch,
    relayerUrl,
    onAddOrUpdateNetworks: (nets) => {
      nets.forEach((n) => {
        providersCtrl.setProvider(n)
      })
    },
    onRemoveNetwork: (id) => {
      providersCtrl.removeProvider(id)
    }
  })

  providersCtrl = new ProvidersController(networksCtrl, storageCtrl)
  providersCtrl.providers = providers

  const { uiManager } = mockUiManager()
  const uiCtrl = new UiController({ uiManager })

  // Purposefully mocking these methods as they are not used
  // and listeners result in a memory leak warning in tests
  uiCtrl.addView = jest.fn()
  uiCtrl.removeView = jest.fn()
  uiCtrl.uiEvent.on = jest.fn()

  const keystore = new KeystoreController(
    'default',
    storageCtrl,
    { internal: KeystoreSigner },
    uiCtrl
  )

  await storageCtrl.set('accounts', accounts)
  await storageCtrl.set('selectedAccount', accounts[0]!.addr)

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
    keystore,
    autoLogin: autoLoginCtrl
  })

  const portfolioCtrl = new PortfolioController(
    storageCtrl,
    fetch,
    providersCtrl,
    networksCtrl,
    accountsCtrl,
    keystore,
    relayerUrl,
    velcroUrl,
    new BannerController(storageCtrl)
  )

  await accountsCtrl.initialLoadPromise
  await accountsCtrl.accountStateInitialLoadPromise
  await networksCtrl.initialLoadPromise
  await providersCtrl.initialLoadPromise
  await autoLoginCtrl.initialLoadPromise
  await selectedAccountCtrl.initialLoadPromise

  selectedAccountCtrl.initControllers({
    portfolio: portfolioCtrl,
    networks: networksCtrl,
    providers: providersCtrl
  })

  return {
    selectedAccountCtrl,
    portfolioCtrl,
    providersCtrl,
    autoLoginCtrl,
    accountsCtrl,
    storage
  }
}

const ethereum = networks.find((n) => n.chainId === 1n)!

describe('SelectedAccount Controller', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.restoreAllMocks()
  })
  test('should init controllers and set account', async () => {
    const { selectedAccountCtrl, storage } = await prepareTest()

    const selectedAccountInStorage = await storage.get('selectedAccount')

    expect(selectedAccountCtrl.account?.addr).toEqual(selectedAccountInStorage)

    expect(selectedAccountCtrl.areControllersInitialized).toEqual(true)
  })
  test('should update selected account portfolio', async () => {
    const { selectedAccountCtrl, portfolioCtrl } = await prepareTest()

    await portfolioCtrl.updateSelectedAccount('0x77777777789A8BBEE6C64381e5E89E501fb0e4c8')
    await waitSelectedAccCtrlPortfolioAllReady(selectedAccountCtrl)

    expect(selectedAccountCtrl.portfolio.totalBalance).toBeGreaterThan(0)
    expect(selectedAccountCtrl.portfolio.tokens.length).toBeGreaterThan(0)
  })
  test('the portfolio controller state is not mutated when updating the selected account portfolio', async () => {
    // NOTE! THE TEST ACCOUNT MUST HAVE AAVE DEFI BORROW FOR THIS TEST
    const { selectedAccountCtrl, portfolioCtrl } = await prepareTest()

    await selectedAccountCtrl.setAccount(accounts[1]!)

    await portfolioCtrl.updateSelectedAccount('0xC2E6dFcc2C6722866aD65F211D5757e1D2879337')
    const PORTFOLIO_STATE_BEFORE = stringify(
      portfolioCtrl.getAccountPortfolioState('0xC2E6dFcc2C6722866aD65F211D5757e1D2879337')
    )
    await waitSelectedAccCtrlPortfolioAllReady(selectedAccountCtrl)

    selectedAccountCtrl.resetSelectedAccountPortfolio()
    selectedAccountCtrl.updateSelectedAccountPortfolio()

    const PORTFOLIO_STATE_AFTER = stringify(
      portfolioCtrl.getAccountPortfolioState('0xC2E6dFcc2C6722866aD65F211D5757e1D2879337')
    )

    expect(PORTFOLIO_STATE_AFTER).toEqual(PORTFOLIO_STATE_BEFORE)
  })
  test('should reset selected account portfolio', async () => {
    const { selectedAccountCtrl, portfolioCtrl } = await prepareTest()

    await portfolioCtrl.updateSelectedAccount('0x77777777789A8BBEE6C64381e5E89E501fb0e4c8', [
      ethereum
    ])
    await waitSelectedAccCtrlPortfolioAllReady(selectedAccountCtrl)

    selectedAccountCtrl.resetSelectedAccountPortfolio()
    expect(selectedAccountCtrl.portfolio).toEqual(DEFAULT_SELECTED_ACCOUNT_PORTFOLIO)
  })
  test('should toJSON()', async () => {
    const { selectedAccountCtrl } = await prepareTest()
    const json = selectedAccountCtrl.toJSON()
    expect(json).toBeDefined()
  })
  it('The dashboard filter is removed if the filtered network is removed from the networks list', async () => {
    const { selectedAccountCtrl } = await prepareTest()

    selectedAccountCtrl.setDashboardNetworkFilter('1')

    expect(selectedAccountCtrl.dashboardNetworkFilter).toBe('1')

    selectedAccountCtrl.removeNetworkData(1n)

    expect(selectedAccountCtrl.dashboardNetworkFilter).toBeNull()
  })
  it('Selected account portfolio is calculated immediately when an account with ready portfolio is selected', async () => {
    const { selectedAccountCtrl, portfolioCtrl } = await prepareTest()

    await portfolioCtrl.updateSelectedAccount(accounts[0]!.addr)
    await waitSelectedAccCtrlPortfolioAllReady(selectedAccountCtrl)

    expect(selectedAccountCtrl.portfolio.isAllReady).toBe(true)

    await selectedAccountCtrl.setAccount(accounts[1]!)

    await portfolioCtrl.updateSelectedAccount(accounts[1]!.addr)
    await waitSelectedAccCtrlPortfolioAllReady(selectedAccountCtrl)

    expect(selectedAccountCtrl.portfolio.isAllReady).toBe(true)

    const secondAccountTokensCount = selectedAccountCtrl.portfolio.tokens.length

    await selectedAccountCtrl.setAccount(accounts[0]!)

    expect(selectedAccountCtrl.portfolio.isAllReady).toBe(true)
    expect(selectedAccountCtrl.portfolio.tokens.length).not.toBe(secondAccountTokensCount)
  })
  it('An update of the portfolio results in only one update of the selected account controller', async () => {
    const { selectedAccountCtrl, portfolioCtrl } = await prepareTest()

    let updateCount = 0

    const unsubscribe = selectedAccountCtrl.onUpdate(() => {
      updateCount++
    })

    updateCount = 0 // reset after initial sync

    await portfolioCtrl.forceEmitUpdate()

    await new Promise((resolve) => {
      setTimeout(resolve, 1000)
    })

    expect(updateCount).toBe(1)
    unsubscribe()
  })
  it('An update of accounts, providers, autoLogin result in only one update of the selected account controller', async () => {
    const { selectedAccountCtrl, accountsCtrl, providersCtrl, autoLoginCtrl } = await prepareTest()
    let updateCount = 0

    const unsubscribe = selectedAccountCtrl.onUpdate(() => {
      updateCount++
    })

    await accountsCtrl.forceEmitUpdate()
    await providersCtrl.forceEmitUpdate()
    await autoLoginCtrl.forceEmitUpdate()

    await new Promise((resolve) => {
      setTimeout(resolve, 1000)
    })

    expect(updateCount).toBe(3)
    unsubscribe()
  })
  it('portfolio isAllReady becomes false when resetSelectedAccountPortfolio is called with isManualUpdate=true', async () => {
    const { selectedAccountCtrl, portfolioCtrl } = await prepareTest()

    await portfolioCtrl.updateSelectedAccount(accounts[0]!.addr)
    await waitSelectedAccCtrlPortfolioAllReady(selectedAccountCtrl)

    expect(selectedAccountCtrl.portfolio.isAllReady).toBe(true)

    selectedAccountCtrl.resetSelectedAccountPortfolio({ isManualUpdate: true })
    expect(selectedAccountCtrl.portfolio.isAllReady).toBe(false)
  })
  it('portfolio isAllReady remains true in subsequent portfolio and defi updates', async () => {
    const { selectedAccountCtrl, portfolioCtrl, defiPositionsCtrl } = await prepareTest()

    await portfolioCtrl.updateSelectedAccount(accounts[0]!.addr)
    await waitSelectedAccCtrlPortfolioAllReady(selectedAccountCtrl)

    expect(selectedAccountCtrl.portfolio.isAllReady).toBe(true)

    let didSetToFalse = false

    const unsubscribe = selectedAccountCtrl.onUpdate(() => {
      if (!selectedAccountCtrl.portfolio.isAllReady) {
        didSetToFalse = true
      }
    })

    await defiPositionsCtrl.updatePositions({ forceUpdate: true })
    await portfolioCtrl.updateSelectedAccount(accounts[0]!.addr)

    expect(selectedAccountCtrl.portfolio.isAllReady).toBe(true)
    expect(didSetToFalse).toBe(false)
    unsubscribe()
  })

  describe('Banners', () => {
    const accountAddr = accounts[0]!.addr
    beforeEach(() => {
      jest.clearAllMocks()
      jest.restoreAllMocks()
    })

    it("An RPC banner is displayed when it's not working and the user has assets on it", async () => {
      const { selectedAccountCtrl, portfolioCtrl, providersCtrl } = await prepareTest()
      await portfolioCtrl.updateSelectedAccount(accountAddr)
      providersCtrl.updateProviderIsWorking(1n, false)
      jest.spyOn(portfolioCtrl, 'getNetworksWithAssets').mockImplementation(() => ({ '1': true }))
      await waitNextControllerUpdate(selectedAccountCtrl)

      expect(
        selectedAccountCtrl.balanceAffectingErrors.find(({ id }) => id === 'rpcs-down')
      ).toBeDefined()
      providersCtrl.updateProviderIsWorking(1n, true)
    })
    it("An RPC banner is displayed when it's not working and we still don't know if the user has assets on it", async () => {
      const { selectedAccountCtrl, portfolioCtrl, providersCtrl } = await prepareTest()
      await portfolioCtrl.updateSelectedAccount(accountAddr)
      providersCtrl.updateProviderIsWorking(1n, false)
      jest.spyOn(portfolioCtrl, 'getNetworksWithAssets').mockImplementation(() => ({}))
      await waitNextControllerUpdate(selectedAccountCtrl)

      expect(
        selectedAccountCtrl.balanceAffectingErrors.find(({ id }) => id === 'rpcs-down')
      ).toBeDefined()
      providersCtrl.updateProviderIsWorking(1n, true)
    })
    it("No RPC/portfolio banner is displayed when an RPC isn't working and the user has no assets on it", async () => {
      const { selectedAccountCtrl, portfolioCtrl, providersCtrl } = await prepareTest()
      await portfolioCtrl.updateSelectedAccount(accountAddr)
      await waitSelectedAccCtrlPortfolioAllReady(selectedAccountCtrl)

      jest
        .spyOn(portfolioCtrl, 'getNetworksWithAssets')
        .mockImplementation(() => ({ '137': true, '1': false }))
      selectedAccountCtrl.portfolio.portfolioState['1']!.criticalError = new Error('Mock error')
      selectedAccountCtrl.portfolio.portfolioState['1']!.lastSuccessfulUpdate = 0
      providersCtrl.updateProviderIsWorking(1n, false)
      await waitNextControllerUpdate(selectedAccountCtrl)

      expect(
        selectedAccountCtrl.balanceAffectingErrors.find(({ id }) => id === 'rpcs-down')
      ).toBeUndefined()
      expect(
        selectedAccountCtrl.balanceAffectingErrors.find(({ id }) => id === 'portfolio-critical')
      ).toBeUndefined()
      providersCtrl.updateProviderIsWorking(1n, true)
    })
    it("A portfolio error banners isn't displayed when there is an RPC error banner", async () => {
      const { selectedAccountCtrl, portfolioCtrl, providersCtrl } = await prepareTest()
      jest.spyOn(portfolioCtrl, 'getNetworksWithAssets').mockImplementation(() => ({ '1': true }))
      selectedAccountCtrl.resetSelectedAccountPortfolio()
      await portfolioCtrl.updateSelectedAccount(accountAddr)

      await waitSelectedAccCtrlPortfolioAllReady(selectedAccountCtrl)

      selectedAccountCtrl.portfolio.portfolioState['1']!.criticalError = new Error('Mock error')
      selectedAccountCtrl.portfolio.portfolioState['1']!.lastSuccessfulUpdate = 0
      providersCtrl.updateProviderIsWorking(1n, false)
      await waitNextControllerUpdate(selectedAccountCtrl)

      // A portfolio error banner isn't displayed when there is an RPC error banner
      expect(
        selectedAccountCtrl.balanceAffectingErrors.find(({ id }) => id === 'rpcs-down')
      ).toBeDefined()
      expect(
        selectedAccountCtrl.balanceAffectingErrors.find(({ id }) => id === 'portfolio-critical')
      ).not.toBeDefined()

      providersCtrl.updateProviderIsWorking(1n, true)
      await waitNextControllerUpdate(selectedAccountCtrl)

      // The portfolio error banner is displayed when there isn't an RPC error banner
      expect(
        selectedAccountCtrl.balanceAffectingErrors.find(({ id }) => id === 'rpcs-down')
      ).not.toBeDefined()
      expect(
        selectedAccountCtrl.balanceAffectingErrors.find(({ id }) => id === 'portfolio-critical')
      ).toBeDefined()
    })
    it('Portfolio error banner lastSuccessfulUpdate logic is working properly', async () => {
      const { selectedAccountCtrl, portfolioCtrl, providersCtrl } = await prepareTest()
      selectedAccountCtrl.resetSelectedAccountPortfolio()
      await portfolioCtrl.updateSelectedAccount(accountAddr)
      await waitSelectedAccCtrlPortfolioAllReady(selectedAccountCtrl)

      // There is a critical error but lastSuccessfulUpdate is less than 10 minutes ago
      selectedAccountCtrl.portfolio.portfolioState['1']!.criticalError = new Error('Mock error')
      await forceBannerRecalculation(providersCtrl)

      expect(selectedAccountCtrl.balanceAffectingErrors.length).toBe(0)

      // There is a critical error and lastSuccessfulUpdate is more than 10 minutes ago
      selectedAccountCtrl.portfolio.portfolioState['1']!.lastSuccessfulUpdate = 0
      await forceBannerRecalculation(providersCtrl)

      expect(selectedAccountCtrl.balanceAffectingErrors.length).toBeGreaterThan(0)
    })
    it('Defi error banner is displayed when there is a critical network error and the user has positions on that network/provider', async () => {
      const { selectedAccountCtrl, portfolioCtrl } = await prepareTest()
      // Bypass the `updatePositions` cache by setting `maxDataAgeMs` to 0.
      // Otherwise, no update is emitted and the test cannot proceed.
      jest.spyOn(defiPositionsCtrl, 'getDefiPositionsState').mockImplementation(() => ({
        '1': { positionsByProvider: [], isLoading: false, updatedAt: 0 }
      }))
      await defiPositionsCtrl.updatePositions({ maxDataAgeMs: 0, forceUpdate: true })
      await waitNextControllerUpdate(selectedAccountCtrl)

      expect(selectedAccountCtrl.balanceAffectingErrors.length).toBe(0)
      // Mock an error
      jest.spyOn(defiPositionsCtrl, 'getDefiPositionsState').mockImplementation(() => ({
        '1': {
          positionsByProvider: [],
          isLoading: false,
          updatedAt: 0,
          error: DeFiPositionsError.CriticalError
        }
      }))
      jest.spyOn(defiPositionsCtrl, 'getNetworksWithPositions').mockImplementation(() => ({
        '1': ['AAVE v3', 'Uniswap V3']
      }))
      // Bypass the `updatePositions` cache by setting `maxDataAgeMs` to 0.
      // Otherwise, no update is emitted and the test cannot proceed.
      await defiPositionsCtrl.updatePositions({ maxDataAgeMs: 0, forceUpdate: true })

      await waitNextControllerUpdate(selectedAccountCtrl)

      expect(selectedAccountCtrl.balanceAffectingErrors.length).toBeGreaterThan(0)
    })
    it('Defi error banner is not displayed when there is a critical network error but the user has no positions', async () => {
      const { selectedAccountCtrl, defiPositionsCtrl } = await prepareTest()
      selectedAccountCtrl.portfolio.defiPositions = []
      // Bypass the `updatePositions` cache by setting `maxDataAgeMs` to 0.
      // Otherwise, no update is emitted and the test cannot proceed.
      await defiPositionsCtrl.updatePositions({ maxDataAgeMs: 0, forceUpdate: true })
      await waitNextControllerUpdate(selectedAccountCtrl)

      expect(selectedAccountCtrl.balanceAffectingErrors.length).toBe(0)
      // Mock an error
      jest.spyOn(defiPositionsCtrl, 'getDefiPositionsState').mockImplementation(() => ({
        '1': {
          positionsByProvider: [],
          isLoading: false,
          updatedAt: 0,
          error: DeFiPositionsError.CriticalError
        }
      }))
      // This mocks the case where we have fetched the positions but the user has none
      // and there is a critical error but we don't want to show the banner
      jest.spyOn(defiPositionsCtrl, 'getNetworksWithPositions').mockImplementation(() => ({
        '1': []
      }))
      // Bypass the `updatePositions` cache by setting `maxDataAgeMs` to 0.
      // Otherwise, no update is emitted and the test cannot proceed.
      await defiPositionsCtrl.updatePositions({ maxDataAgeMs: 0, forceUpdate: true })
      await waitNextControllerUpdate(selectedAccountCtrl)

      expect(selectedAccountCtrl.balanceAffectingErrors.length).toBe(0)
    })
    it("Defi error banner is displayed when there is a critical error and we don't know if the user has positions or not", async () => {
      const { selectedAccountCtrl, defiPositionsCtrl } = await prepareTest()
      selectedAccountCtrl.portfolio.defiPositions = []
      // Bypass the `updatePositions` cache by setting `maxDataAgeMs` to 0.
      // Otherwise, no update is emitted and the test cannot proceed.
      await defiPositionsCtrl.updatePositions({ maxDataAgeMs: 0, forceUpdate: true })
      await waitNextControllerUpdate(selectedAccountCtrl)

      expect(selectedAccountCtrl.balanceAffectingErrors.length).toBe(0)
      // Mock an error
      jest.spyOn(defiPositionsCtrl, 'getDefiPositionsState').mockImplementation(() => ({
        '1': {
          positionsByProvider: [],
          isLoading: false,
          updatedAt: 0,
          error: DeFiPositionsError.CriticalError
        }
      }))
      // This mocks the case where we have never fetched the positions
      // and there is a critical error but we don't want to show the banner
      jest.spyOn(defiPositionsCtrl, 'getNetworksWithPositions').mockImplementation(() => ({}))
      // Bypass the `updatePositions` cache by setting `maxDataAgeMs` to 0.
      // Otherwise, no update is emitted and the test cannot proceed.
      await defiPositionsCtrl.updatePositions({ maxDataAgeMs: 0, forceUpdate: true })
      await waitNextControllerUpdate(selectedAccountCtrl)

      expect(selectedAccountCtrl.balanceAffectingErrors.length).toBe(1)
    })
  })
})
