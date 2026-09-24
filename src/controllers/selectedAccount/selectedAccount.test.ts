import { expect } from '@jest/globals'

import { makeMainController } from '../../../test/helpers/mainController'
import { DEFAULT_ACCOUNT_LABEL } from '../../consts/account'
import { BIP44_STANDARD_DERIVATION_TEMPLATE } from '../../consts/derivation'
import { networks } from '../../consts/networks'
import { IProvidersController } from '../../interfaces/provider'
import { ISelectedAccountController } from '../../interfaces/selectedAccount'
import { DeFiPositionsError } from '../../libs/defiPositions/types'
import { PORTFOLIO_LIB_ERROR_NAMES } from '../../libs/portfolio/portfolio'
import { stringify } from '../../libs/richJson/richJson'
import { DEFAULT_SELECTED_ACCOUNT_PORTFOLIO } from '../../libs/selectedAccount/selectedAccount'
import wait from '../../utils/wait'
import EventEmitter from '../eventEmitter/eventEmitter'

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

const waitSelectedAccCtrlPortfolioAllReady = (selectedAccountCtrl: ISelectedAccountController) => {
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
  // Subcontroller updates are debounced on the next tick. We must await 1second
  // to account for that
  await wait(1)
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
  const { mainCtrl } = await makeMainController(async (storageCtrl) => {
    await storageCtrl.set('accounts', accounts)
    await storageCtrl.set('selectedAccount', accounts[0]!.addr)
  })

  await mainCtrl.selectedAccount.initialLoadPromise
  await mainCtrl.autoLogin.initialLoadPromise
  await mainCtrl.portfolio.initialLoadPromise

  // Wait 1 tick because controller update listeners are debounced in the selectedAccount controller
  await wait(1)

  return {
    selectedAccountCtrl: mainCtrl.selectedAccount,
    portfolioCtrl: mainCtrl.portfolio,
    providersCtrl: mainCtrl.providers,
    autoLoginCtrl: mainCtrl.autoLogin,
    accountsCtrl: mainCtrl.accounts,
    storage: mainCtrl.storage
  }
}

const ethereum = networks.find((n) => n.chainId === 1n)!

describe('SelectedAccount Controller', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.restoreAllMocks()
  })
  it('should init controllers and set account', async () => {
    const { selectedAccountCtrl, storage } = await prepareTest()

    const selectedAccountInStorage = await storage.get('selectedAccount')

    expect(selectedAccountCtrl.account?.addr).toEqual(selectedAccountInStorage)

    expect(selectedAccountCtrl.areControllersInitialized).toEqual(true)
  })
  it('should update selected account portfolio', async () => {
    const { selectedAccountCtrl, portfolioCtrl } = await prepareTest()

    await portfolioCtrl.updateSelectedAccount('0x77777777789A8BBEE6C64381e5E89E501fb0e4c8')
    await waitSelectedAccCtrlPortfolioAllReady(selectedAccountCtrl)

    expect(selectedAccountCtrl.portfolio.totalBalance).toBeGreaterThan(0)
    expect(selectedAccountCtrl.portfolio.tokens.length).toBeGreaterThan(0)
  })
  it('should update when projected rewards data is unavailable because privacy opt outs are disabled', async () => {
    const { selectedAccountCtrl, portfolioCtrl } = await prepareTest()

    jest.spyOn(portfolioCtrl, 'getAccountPortfolioState').mockReturnValue({
      '1': {
        isReady: true,
        isLoading: false,
        errors: [],
        result: {
          tokens: [],
          total: { usd: 0 },
          defiPositions: { positionsByProvider: [] }
        }
      },
      projectedRewards: {
        isReady: true,
        isLoading: false,
        errors: [],
        result: {}
      }
    } as any)

    expect(() => selectedAccountCtrl.updateSelectedAccountPortfolio()).not.toThrow()
    expect(selectedAccountCtrl.portfolio.projectedRewardsStats).toBeNull()
  })
  it('the portfolio controller state is not mutated when updating the selected account portfolio', async () => {
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
  it('should reset selected account portfolio', async () => {
    const { selectedAccountCtrl, portfolioCtrl } = await prepareTest()

    await portfolioCtrl.updateSelectedAccount('0x77777777789A8BBEE6C64381e5E89E501fb0e4c8', [
      ethereum
    ])
    await waitSelectedAccCtrlPortfolioAllReady(selectedAccountCtrl)

    selectedAccountCtrl.resetSelectedAccountPortfolio()
    expect(selectedAccountCtrl.portfolio).toEqual(DEFAULT_SELECTED_ACCOUNT_PORTFOLIO)
  })
  it('should toJSON()', async () => {
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
    const { selectedAccountCtrl, portfolioCtrl } = await prepareTest()

    await portfolioCtrl.updateSelectedAccount(accounts[0]!.addr)
    await waitSelectedAccCtrlPortfolioAllReady(selectedAccountCtrl)

    expect(selectedAccountCtrl.portfolio.isAllReady).toBe(true)

    let didSetToFalse = false

    const unsubscribe = selectedAccountCtrl.onUpdate(() => {
      if (!selectedAccountCtrl.portfolio.isAllReady) {
        didSetToFalse = true
      }
    })

    await portfolioCtrl.updateSelectedAccount(accounts[0]!.addr, [ethereum], undefined, {
      isManualUpdate: true,
      defiMaxDataAgeMs: 0
    })

    expect(selectedAccountCtrl.portfolio.isAllReady).toBe(true)
    expect(didSetToFalse).toBe(false)
    unsubscribe()
  })

  describe('Privacy Pools account', () => {
    const PRIVACY_POOLS_SEED_ID = 'privacy-pools-seed'

    /**
     * A wallet with the two regular accounts and one Privacy Pools account. The stored seed only
     * needs its metadata here - nothing is decrypted or derived.
     */
    const preparePrivacyPoolsTest = async ({
      storedAccounts = accounts,
      selectedAccount = accounts[0]!.addr,
      selectedPrivacyPoolsAccount = null,
      privacyPoolsSeedIds = [PRIVACY_POOLS_SEED_ID]
    }: {
      storedAccounts?: typeof accounts
      selectedAccount?: string | null
      selectedPrivacyPoolsAccount?: string | null
      privacyPoolsSeedIds?: string[]
    } = {}) => {
      const { mainCtrl } = await makeMainController(async (storageCtrl) => {
        await storageCtrl.set('accounts', storedAccounts)
        if (selectedAccount) await storageCtrl.set('selectedAccount', selectedAccount)
        if (selectedPrivacyPoolsAccount)
          await storageCtrl.set('selectedPrivacyPoolsAccount', selectedPrivacyPoolsAccount)
        await storageCtrl.set('keystoreSeeds', [
          {
            id: PRIVACY_POOLS_SEED_ID,
            label: 'Privacy seed',
            seed: {} as any,
            hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE
          }
        ])
        await storageCtrl.set(
          'privacyPoolsAccounts',
          privacyPoolsSeedIds.map((seedId) => ({ seedId, createdAt: 1 }))
        )
      })
      await mainCtrl.initialLoadPromise

      return { mainCtrl, selectedAccountCtrl: mainCtrl.selectedAccount }
    }

    it('selecting one leaves no regular account selected, in memory and in storage', async () => {
      const { mainCtrl, selectedAccountCtrl } = await preparePrivacyPoolsTest()

      await mainCtrl.selectPrivacyPoolsAccount(PRIVACY_POOLS_SEED_ID)

      expect(selectedAccountCtrl.account).toBeNull()
      expect(selectedAccountCtrl.privacyPoolsAccountId).toBe(PRIVACY_POOLS_SEED_ID)
      expect(await mainCtrl.storage.get('selectedAccount', null)).toBeNull()
      expect(await mainCtrl.storage.get('selectedPrivacyPoolsAccount', null)).toBe(
        PRIVACY_POOLS_SEED_ID
      )
    })

    it('selecting a regular account deselects the Privacy Pools one', async () => {
      const { mainCtrl, selectedAccountCtrl } = await preparePrivacyPoolsTest()
      await mainCtrl.selectPrivacyPoolsAccount(PRIVACY_POOLS_SEED_ID)

      await mainCtrl.selectAccount(accounts[1]!.addr)

      expect(selectedAccountCtrl.account?.addr).toBe(accounts[1]!.addr)
      expect(selectedAccountCtrl.privacyPoolsAccountId).toBeNull()
      expect(await mainCtrl.storage.get('selectedPrivacyPoolsAccount', null)).toBeNull()
    })

    it('never reports neither account selected while switching between the two kinds', async () => {
      const { mainCtrl, selectedAccountCtrl } = await preparePrivacyPoolsTest()
      const selectionStates: boolean[] = []
      const unsubscribe = selectedAccountCtrl.onUpdate(() => {
        selectionStates.push(
          !!selectedAccountCtrl.account || !!selectedAccountCtrl.privacyPoolsAccountId
        )
      })

      await mainCtrl.selectPrivacyPoolsAccount(PRIVACY_POOLS_SEED_ID)
      await mainCtrl.selectAccount(accounts[0]!.addr)
      unsubscribe()

      expect(selectionStates.length).toBeGreaterThan(0)
      expect(selectionStates.every(Boolean)).toBe(true)
    })

    it('does not select a Privacy Pools account that does not exist', async () => {
      const { mainCtrl, selectedAccountCtrl } = await preparePrivacyPoolsTest()

      await mainCtrl.selectPrivacyPoolsAccount('unknown-seed')

      expect(selectedAccountCtrl.account?.addr).toBe(accounts[0]!.addr)
      expect(selectedAccountCtrl.privacyPoolsAccountId).toBeNull()
    })

    it('is restored as selected on the next start', async () => {
      const { selectedAccountCtrl } = await preparePrivacyPoolsTest({
        selectedAccount: null,
        selectedPrivacyPoolsAccount: PRIVACY_POOLS_SEED_ID
      })

      expect(selectedAccountCtrl.account).toBeNull()
      expect(selectedAccountCtrl.privacyPoolsAccountId).toBe(PRIVACY_POOLS_SEED_ID)
    })

    it('a restored selection whose account is gone falls back to the first regular account', async () => {
      const { selectedAccountCtrl } = await preparePrivacyPoolsTest({
        selectedAccount: null,
        selectedPrivacyPoolsAccount: 'deleted-seed'
      })

      expect(selectedAccountCtrl.account?.addr).toBe(accounts[0]!.addr)
      expect(selectedAccountCtrl.privacyPoolsAccountId).toBeNull()
    })

    it('removing the last regular account selects the Privacy Pools account', async () => {
      const { mainCtrl, selectedAccountCtrl } = await preparePrivacyPoolsTest({
        storedAccounts: [accounts[0]!]
      })

      await mainCtrl.removeAccount(accounts[0]!.addr)

      expect(selectedAccountCtrl.account).toBeNull()
      expect(selectedAccountCtrl.privacyPoolsAccountId).toBe(PRIVACY_POOLS_SEED_ID)
    })

    it('removing the selected Privacy Pools account selects a regular account', async () => {
      const { mainCtrl, selectedAccountCtrl } = await preparePrivacyPoolsTest()
      await mainCtrl.selectPrivacyPoolsAccount(PRIVACY_POOLS_SEED_ID)

      await mainCtrl.privacyPools.removeAccount(PRIVACY_POOLS_SEED_ID)

      expect(selectedAccountCtrl.account?.addr).toBe(accounts[0]!.addr)
      expect(selectedAccountCtrl.privacyPoolsAccountId).toBeNull()
    })

    it('removing the only account of either kind leaves nothing selected', async () => {
      const { mainCtrl, selectedAccountCtrl } = await preparePrivacyPoolsTest({
        storedAccounts: [],
        selectedAccount: null,
        selectedPrivacyPoolsAccount: PRIVACY_POOLS_SEED_ID
      })

      await mainCtrl.privacyPools.removeAccount(PRIVACY_POOLS_SEED_ID)

      expect(selectedAccountCtrl.account).toBeNull()
      expect(selectedAccountCtrl.privacyPoolsAccountId).toBeNull()
      expect(await mainCtrl.storage.get('selectedPrivacyPoolsAccount', null)).toBeNull()
    })
  })

  describe('Banners', () => {
    const accountAddr = accounts[0]!.addr
    beforeEach(() => {
      jest.clearAllMocks()
      jest.restoreAllMocks()
    })

    const mockEthereumDefiErrorState = {
      isLoading: false,
      isReady: true,
      errors: [
        {
          name: PORTFOLIO_LIB_ERROR_NAMES.DefiDiscoveryError,
          message: 'Damn, another defi error',
          level: 'critical' as const
        }
      ],
      lastSuccessfulUpdate: 0,
      result: {
        tokens: [],
        total: {
          usd: 0
        },
        discoveryTime: 0,
        tokenDataCache: new Map(),
        tokenErrors: [],
        collectionErrors: [],
        collections: [],
        blockNumber: 0,
        toBeLearned: {
          erc20s: [],
          erc721s: {}
        },
        feeTokens: [],
        priceUpdateTime: 0,
        oracleCallTime: 0,
        lastExternalApiUpdateData: null,
        updateStarted: 0,
        defiPositions: {
          positionsByProvider: [],
          isLoading: false,
          updatedAt: undefined,
          error: DeFiPositionsError.CriticalError
        }
      }
    }

    it("An RPC banner is displayed when it's not working and the user has assets on it", async () => {
      const { selectedAccountCtrl, portfolioCtrl, providersCtrl } = await prepareTest()
      await portfolioCtrl.updateSelectedAccount(accountAddr)
      providersCtrl.updateProviderIsWorking(1n, false)
      jest.spyOn(portfolioCtrl, 'getNetworksWithAssets').mockImplementation(() => ({ '1': true }))
      await forceBannerRecalculation(providersCtrl)

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
      await forceBannerRecalculation(providersCtrl)

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
      await forceBannerRecalculation(providersCtrl)

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
      await forceBannerRecalculation(providersCtrl)

      // A portfolio error banner isn't displayed when there is an RPC error banner
      expect(
        selectedAccountCtrl.balanceAffectingErrors.find(({ id }) => id === 'rpcs-down')
      ).toBeDefined()
      expect(
        selectedAccountCtrl.balanceAffectingErrors.find(({ id }) => id === 'portfolio-critical')
      ).not.toBeDefined()

      providersCtrl.updateProviderIsWorking(1n, true)
      await forceBannerRecalculation(providersCtrl)

      // The portfolio error banner is displayed when there isn't an RPC error banner
      expect(
        selectedAccountCtrl.balanceAffectingErrors.find(({ id }) => id === 'rpcs-down')
      ).not.toBeDefined()
      expect(
        selectedAccountCtrl.balanceAffectingErrors.find(({ id }) => id === 'portfolio-critical')
      ).toBeDefined()
    })
    it('Portfolio error banner lastSuccessfulUpdate logic is working properly', async () => {
      const { selectedAccountCtrl, portfolioCtrl, providersCtrl, accountsCtrl } =
        await prepareTest()
      selectedAccountCtrl.resetSelectedAccountPortfolio()
      await portfolioCtrl.updateSelectedAccount(accountAddr)
      await waitSelectedAccCtrlPortfolioAllReady(selectedAccountCtrl)

      // Mock account state
      accountsCtrl.accountStates[accountAddr] = {
        '137': {
          updatedAt: Date.now()
        } as any
      }

      // There is a critical error but lastSuccessfulUpdate is less than 10 minutes ago
      selectedAccountCtrl.portfolio.portfolioState['137']!.criticalError = new Error('Mock error')
      await forceBannerRecalculation(providersCtrl)

      expect(selectedAccountCtrl.balanceAffectingErrors.length).toBe(0)

      // There is a critical error and lastSuccessfulUpdate is more than 10 minutes ago
      selectedAccountCtrl.portfolio.portfolioState['137']!.lastSuccessfulUpdate = 0
      await forceBannerRecalculation(providersCtrl)

      expect(selectedAccountCtrl.balanceAffectingErrors.length).toBeGreaterThan(0)
    })
    it('Defi error banner is displayed when there is a critical network error and the user has positions on that network/provider', async () => {
      const { selectedAccountCtrl, portfolioCtrl } = await prepareTest()

      // Bypass the `updatePositions` cache by setting `maxDataAgeMs` to 0.
      // Otherwise, no update is emitted and the test cannot proceed.
      await portfolioCtrl.updateSelectedAccount(accountAddr, [ethereum], undefined, {
        isManualUpdate: true,
        defiMaxDataAgeMs: 0
      })
      await waitNextControllerUpdate(selectedAccountCtrl)

      expect(selectedAccountCtrl.balanceAffectingErrors.length).toBe(0)
      // Mock an error
      jest.spyOn(portfolioCtrl, 'getAccountPortfolioState').mockImplementation((() => ({
        '1': mockEthereumDefiErrorState
      })) as any)
      jest.spyOn(portfolioCtrl, 'getNetworksWithDefiPositions').mockImplementation(() => ({
        '1': ['AAVE v3', 'Uniswap V3']
      }))
      // Bypass the cache by setting `maxDataAgeMs` to 0.
      // Otherwise, no update is emitted and the test cannot proceed.
      await portfolioCtrl.updateSelectedAccount(accountAddr, [ethereum], undefined, {
        isManualUpdate: true,
        defiMaxDataAgeMs: 0
      })
      await waitNextControllerUpdate(selectedAccountCtrl)

      expect(selectedAccountCtrl.balanceAffectingErrors.length).toBeGreaterThan(0)
    })
    it('Defi error banner is not displayed when there is a critical network error but the user has no positions', async () => {
      const { selectedAccountCtrl, portfolioCtrl } = await prepareTest()
      selectedAccountCtrl.portfolio.defiPositions = []
      // Bypass the cache by setting `maxDataAgeMs` to 0.
      // Otherwise, no update is emitted and the test cannot proceed.
      await portfolioCtrl.updateSelectedAccount(accountAddr, [ethereum], undefined, {
        isManualUpdate: true,
        defiMaxDataAgeMs: 0
      })
      await waitNextControllerUpdate(selectedAccountCtrl)

      expect(selectedAccountCtrl.balanceAffectingErrors.length).toBe(0)
      // Mock an error
      jest.spyOn(portfolioCtrl, 'getAccountPortfolioState').mockImplementation((() => ({
        '1': mockEthereumDefiErrorState
      })) as any)
      // This mocks the case where we have fetched the positions but the user has none
      // and there is a critical error but we don't want to show the banner
      jest.spyOn(portfolioCtrl, 'getNetworksWithDefiPositions').mockImplementation(() => ({
        '1': []
      }))
      // Bypass the cache by setting `maxDataAgeMs` to 0.
      // Otherwise, no update is emitted and the test cannot proceed.
      await portfolioCtrl.updateSelectedAccount(accountAddr, [ethereum], undefined, {
        isManualUpdate: true,
        defiMaxDataAgeMs: 0
      })
      await waitNextControllerUpdate(selectedAccountCtrl)

      expect(selectedAccountCtrl.balanceAffectingErrors.length).toBe(0)
    })
    it("Defi error banner is displayed when there is a critical error and we don't know if the user has positions or not", async () => {
      const { selectedAccountCtrl, portfolioCtrl } = await prepareTest()
      selectedAccountCtrl.portfolio.defiPositions = []
      // Bypass the cache by setting `maxDataAgeMs` to 0.
      // Otherwise, no update is emitted and the test cannot proceed.
      await portfolioCtrl.updateSelectedAccount(accountAddr, [ethereum], undefined, {
        isManualUpdate: true,
        defiMaxDataAgeMs: 0
      })
      await waitNextControllerUpdate(selectedAccountCtrl)

      expect(selectedAccountCtrl.balanceAffectingErrors.length).toBe(0)
      // Mock an error
      jest.spyOn(portfolioCtrl, 'getAccountPortfolioState').mockImplementation((() => ({
        '1': mockEthereumDefiErrorState
      })) as any)
      // This mocks the case where we have never fetched the positions
      // and there is a critical error but we don't want to show the banner
      jest.spyOn(portfolioCtrl, 'getNetworksWithDefiPositions').mockImplementation(() => ({}))
      // Bypass thecache by setting `maxDataAgeMs` to 0.
      // Otherwise, no update is emitted and the test cannot proceed.
      await portfolioCtrl.updateSelectedAccount(accountAddr, [ethereum], undefined, {
        isManualUpdate: true,
        defiMaxDataAgeMs: 0
      })
      await waitNextControllerUpdate(selectedAccountCtrl)

      expect(selectedAccountCtrl.balanceAffectingErrors.length).toBe(1)
    })
  })
})
