import EventEmitterClass from 'controllers/eventEmitter/eventEmitter'
import EventEmitter from 'events'
import fetch from 'node-fetch'

import { expect } from '@jest/globals'

import { relayerUrl, velcroUrl } from '../../../test/config'
import { produceMemoryStore } from '../../../test/helpers'
import { DEFAULT_ACCOUNT_LABEL } from '../../consts/account'
import { networks } from '../../consts/networks'
import { Storage } from '../../interfaces/storage'
import { DeFiPositionsError } from '../../libs/defiPositions/types'
import { getRpcProvider } from '../../services/provider'
import { AccountsController } from '../accounts/accounts'
import { ActionsController } from '../actions/actions'
import { DefiPositionsController } from '../defiPositions/defiPositions'
import { NetworksController } from '../networks/networks'
import { PortfolioController } from '../portfolio/portfolio'
import { ProvidersController } from '../providers/providers'
import { StorageController } from '../storage/storage'
import { DEFAULT_SELECTED_ACCOUNT_PORTFOLIO, SelectedAccountController } from './selectedAccount'

const providers = Object.fromEntries(
  networks.map((network) => [network.id, getRpcProvider(network.rpcUrls, network.chainId)])
)

const storage: Storage = produceMemoryStore()
let providersCtrl: ProvidersController
const storageCtrl = new StorageController(storage)
const networksCtrl = new NetworksController(
  storageCtrl,
  fetch,
  relayerUrl,
  (net) => {
    providersCtrl.setProvider(net)
  },
  (id) => {
    providersCtrl.removeProvider(id)
  }
)

providersCtrl = new ProvidersController(networksCtrl)
providersCtrl.providers = providers

const accountsCtrl = new AccountsController(
  storageCtrl,
  providersCtrl,
  networksCtrl,
  () => {},
  () => {},
  () => {}
)

const selectedAccountCtrl = new SelectedAccountController({
  storage: storageCtrl,
  accounts: accountsCtrl
})

const portfolioCtrl = new PortfolioController(
  storageCtrl,
  fetch,
  providersCtrl,
  networksCtrl,
  accountsCtrl,
  relayerUrl,
  velcroUrl
)

const defiPositionsCtrl = new DefiPositionsController({
  fetch,
  storage,
  selectedAccount: selectedAccountCtrl,
  networks: networksCtrl,
  providers: providersCtrl
})

const event = new EventEmitter()
let windowId = 0
const windowManager = {
  event,
  focus: () => Promise.resolve(),
  open: () => {
    windowId++
    return Promise.resolve({
      id: windowId,
      top: 0,
      left: 0,
      width: 100,
      height: 100,
      focused: true
    })
  },
  remove: () => {
    event.emit('windowRemoved', windowId)
    return Promise.resolve()
  },
  sendWindowToastMessage: () => {},
  sendWindowUiMessage: () => {}
}

const notificationManager = {
  create: () => Promise.resolve()
}

const actionsCtrl = new ActionsController({
  selectedAccount: selectedAccountCtrl,
  windowManager,
  notificationManager,
  onActionWindowClose: () => {}
})

const accounts = [
  {
    addr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
    associatedKeys: [],
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
  }
]

const waitSelectedAccCtrlPortfolioAllReady = () => {
  return new Promise((resolve) => {
    const unsubscribe = selectedAccountCtrl.onUpdate(() => {
      if (selectedAccountCtrl.portfolio.isAllReady) {
        unsubscribe()
        resolve(true)
      }
    })
  })
}

const forceBannerRecalculation = async () => {
  // Portfolio and DeFi positions banners are recalculated on every emitUpdate
  // of the providers controller.
  await providersCtrl.forceEmitUpdate()
}

const waitNextControllerUpdate = (ctrl: EventEmitterClass) => {
  return new Promise((resolve) => {
    const unsubscribe = ctrl.onUpdate(() => {
      unsubscribe()
      resolve(true)
    })
  })
}

describe('SelectedAccount Controller', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.restoreAllMocks()
  })
  test('should load', async () => {
    await storage.set('accounts', accounts)
    await accountsCtrl.addAccounts(accounts)
    await selectedAccountCtrl.initialLoadPromise
    expect(selectedAccountCtrl).toBeDefined()
    expect(selectedAccountCtrl.isReady).toEqual(true)
    expect(selectedAccountCtrl.areControllersInitialized).toEqual(false)
  })
  test('should set account', async () => {
    await selectedAccountCtrl.initialLoadPromise
    expect(selectedAccountCtrl.isReady).toEqual(true)
    expect(selectedAccountCtrl.account).toBeNull()
    await selectedAccountCtrl.setAccount(accounts[0])
    expect(selectedAccountCtrl.account).not.toBe(null)
    expect(selectedAccountCtrl.account?.addr).toEqual(accounts[0].addr)
    const selectedAccountInStorage = await storage.get('selectedAccount', null)
    expect(selectedAccountInStorage).toEqual(accounts[0].addr)
  })
  test('should init controllers', async () => {
    selectedAccountCtrl.initControllers({
      portfolio: portfolioCtrl,
      defiPositions: defiPositionsCtrl,
      actions: actionsCtrl,
      networks: networksCtrl,
      providers: providersCtrl
    })
    expect(selectedAccountCtrl.areControllersInitialized).toEqual(true)
  })
  test('should update selected account portfolio', async () => {
    await portfolioCtrl.updateSelectedAccount('0x77777777789A8BBEE6C64381e5E89E501fb0e4c8')
    await waitSelectedAccCtrlPortfolioAllReady()

    expect(selectedAccountCtrl.portfolio.totalBalance).toBeGreaterThan(0)
    expect(selectedAccountCtrl.portfolio.tokens.length).toBeGreaterThan(0)
  })
  test('should reset selected account portfolio', () => {
    selectedAccountCtrl.resetSelectedAccountPortfolio()
    expect(selectedAccountCtrl.portfolio).toEqual(DEFAULT_SELECTED_ACCOUNT_PORTFOLIO)
  })
  test('should toJSON()', () => {
    const json = selectedAccountCtrl.toJSON()
    expect(json).toBeDefined()
  })

  describe('Banners', () => {
    const accountAddr = accounts[0].addr

    it("An RPC banner is displayed when it's not working and the user has assets on it", async () => {
      await portfolioCtrl.updateSelectedAccount(accountAddr)
      providersCtrl.updateProviderIsWorking('ethereum', false)
      jest
        .spyOn(portfolioCtrl, 'getNetworksWithAssets')
        .mockImplementation(() => ({ ethereum: true }))
      await waitNextControllerUpdate(selectedAccountCtrl)

      expect(
        selectedAccountCtrl.balanceAffectingErrors.find(({ id }) => id === 'rpcs-down')
      ).toBeDefined()
      providersCtrl.updateProviderIsWorking('ethereum', true)
    })
    it("An RPC banner is displayed when it's not working and we still don't know if the user has assets on it", async () => {
      await portfolioCtrl.updateSelectedAccount(accountAddr)
      providersCtrl.updateProviderIsWorking('ethereum', false)
      jest.spyOn(portfolioCtrl, 'getNetworksWithAssets').mockImplementation(() => ({}))
      await waitNextControllerUpdate(selectedAccountCtrl)

      expect(
        selectedAccountCtrl.balanceAffectingErrors.find(({ id }) => id === 'rpcs-down')
      ).toBeDefined()
      providersCtrl.updateProviderIsWorking('ethereum', true)
    })
    it("No RPC banner is displayed when an RPC isn't working and the user has no assets on it", async () => {
      await portfolioCtrl.updateSelectedAccount(accountAddr)
      jest
        .spyOn(portfolioCtrl, 'getNetworksWithAssets')
        .mockImplementation(() => ({ polygon: true, ethereum: false }))
      providersCtrl.updateProviderIsWorking('ethereum', false)
      await waitNextControllerUpdate(selectedAccountCtrl)

      expect(
        selectedAccountCtrl.balanceAffectingErrors.find(({ id }) => id === 'rpcs-down')
      ).toBeUndefined()
      providersCtrl.updateProviderIsWorking('ethereum', true)
    })
    it("A portfolio error banners isn't displayed when there is an RPC error banner", async () => {
      jest
        .spyOn(portfolioCtrl, 'getNetworksWithAssets')
        .mockImplementation(() => ({ ethereum: true }))
      selectedAccountCtrl.resetSelectedAccountPortfolio()
      await portfolioCtrl.updateSelectedAccount(accountAddr)

      await waitSelectedAccCtrlPortfolioAllReady()

      selectedAccountCtrl.portfolio.latest.ethereum!.criticalError = new Error('Mock error')
      selectedAccountCtrl.portfolio.latest.ethereum!.result!.lastSuccessfulUpdate = 0
      providersCtrl.updateProviderIsWorking('ethereum', false)
      await waitNextControllerUpdate(selectedAccountCtrl)

      // A portfolio error banner isn't displayed when there is an RPC error banner
      expect(
        selectedAccountCtrl.balanceAffectingErrors.find(({ id }) => id === 'rpcs-down')
      ).toBeDefined()
      expect(
        selectedAccountCtrl.balanceAffectingErrors.find(({ id }) => id === 'portfolio-critical')
      ).not.toBeDefined()

      providersCtrl.updateProviderIsWorking('ethereum', true)
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
      selectedAccountCtrl.resetSelectedAccountPortfolio()
      await portfolioCtrl.updateSelectedAccount(accountAddr)
      await waitSelectedAccCtrlPortfolioAllReady()

      // There is a critical error but lastSuccessfulUpdate is less than 10 minutes ago
      selectedAccountCtrl.portfolio.latest.ethereum!.criticalError = new Error('Mock error')
      await forceBannerRecalculation()

      expect(selectedAccountCtrl.balanceAffectingErrors.length).toBe(0)

      // There is a critical error and lastSuccessfulUpdate is more than 10 minutes ago
      selectedAccountCtrl.portfolio.latest.ethereum!.result!.lastSuccessfulUpdate = 0
      await forceBannerRecalculation()

      expect(selectedAccountCtrl.balanceAffectingErrors.length).toBeGreaterThan(0)
    })
    it('Defi error banner is displayed when there is a critical network error and the user has positions on that network/provider', async () => {
      await defiPositionsCtrl.updatePositions()
      await waitNextControllerUpdate(selectedAccountCtrl)

      expect(selectedAccountCtrl.balanceAffectingErrors.length).toBe(0)
      // Mock an error
      jest.spyOn(defiPositionsCtrl, 'getDefiPositionsState').mockImplementation(() => ({
        ethereum: {
          positionsByProvider: [],
          isLoading: false,
          updatedAt: 0,
          error: DeFiPositionsError.CriticalError
        }
      }))
      jest.spyOn(defiPositionsCtrl, 'getNetworksWithPositions').mockImplementation(() => ({
        ethereum: ['AAVE v3', 'Uniswap V3']
      }))
      await defiPositionsCtrl.updatePositions()
      await waitNextControllerUpdate(selectedAccountCtrl)

      expect(selectedAccountCtrl.balanceAffectingErrors.length).toBeGreaterThan(0)
    })
    it('Defi error banner is not displayed when there is a critical network error but the user has no positions', async () => {
      selectedAccountCtrl.defiPositions = []
      await defiPositionsCtrl.updatePositions()
      await waitNextControllerUpdate(selectedAccountCtrl)

      expect(selectedAccountCtrl.balanceAffectingErrors.length).toBe(0)
      // Mock an error
      jest.spyOn(defiPositionsCtrl, 'getDefiPositionsState').mockImplementation(() => ({
        ethereum: {
          positionsByProvider: [],
          isLoading: false,
          updatedAt: 0,
          error: DeFiPositionsError.CriticalError
        }
      }))
      // This mocks the case where we have fetched the positions but the user has none
      // and there is a critical error but we don't want to show the banner
      jest.spyOn(defiPositionsCtrl, 'getNetworksWithPositions').mockImplementation(() => ({
        ethereum: []
      }))
      await defiPositionsCtrl.updatePositions()
      await waitNextControllerUpdate(selectedAccountCtrl)

      expect(selectedAccountCtrl.balanceAffectingErrors.length).toBe(0)
    })
    it("Defi error banner is displayed when there is a critical error and we don't know if the user has positions or not", async () => {
      selectedAccountCtrl.defiPositions = []
      await defiPositionsCtrl.updatePositions()
      await waitNextControllerUpdate(selectedAccountCtrl)

      expect(selectedAccountCtrl.balanceAffectingErrors.length).toBe(0)
      // Mock an error
      jest.spyOn(defiPositionsCtrl, 'getDefiPositionsState').mockImplementation(() => ({
        ethereum: {
          positionsByProvider: [],
          isLoading: false,
          updatedAt: 0,
          error: DeFiPositionsError.CriticalError
        }
      }))
      // This mocks the case where we have never fetched the positions
      // and there is a critical error but we don't want to show the banner
      jest.spyOn(defiPositionsCtrl, 'getNetworksWithPositions').mockImplementation(() => ({}))
      await defiPositionsCtrl.updatePositions()
      await waitNextControllerUpdate(selectedAccountCtrl)

      expect(selectedAccountCtrl.balanceAffectingErrors.length).toBe(1)
    })
  })
})
