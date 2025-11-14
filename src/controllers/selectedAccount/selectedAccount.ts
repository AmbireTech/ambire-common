/* eslint-disable no-underscore-dangle */
import { getAddress } from 'ethers'

import { STK_WALLET, WALLET_TOKEN } from '../../consts/addresses'
import { AMBIRE_ACCOUNT_FACTORY } from '../../consts/deploy'
import { Account, IAccountsController } from '../../interfaces/account'
import { AutoLoginPolicy, IAutoLoginController } from '../../interfaces/autoLogin'
import { Banner } from '../../interfaces/banner'
import { IDefiPositionsController } from '../../interfaces/defiPositions'
import { IKeystoreController } from '../../interfaces/keystore'
import { INetworksController } from '../../interfaces/network'
import { IPortfolioController } from '../../interfaces/portfolio'
import { IProvidersController } from '../../interfaces/provider'
import {
  ISelectedAccountController,
  SelectedAccountPortfolio,
  SelectedAccountPortfolioByNetworks
} from '../../interfaces/selectedAccount'
import { IStorageController } from '../../interfaces/storage'
import { isSmartAccount } from '../../libs/account/account'
import {
  defiPositionsOnDisabledNetworksBannerId,
  getDefiPositionsOnDisabledNetworksForTheSelectedAccount
} from '../../libs/banners/banners'
import { sortByValue } from '../../libs/defiPositions/helpers'
import { getStakedWalletPositions } from '../../libs/defiPositions/providers'
import { PositionsByProvider } from '../../libs/defiPositions/types'
import {
  getNetworksWithDeFiPositionsErrorErrors,
  getNetworksWithErrors,
  SelectedAccountBalanceError
} from '../../libs/selectedAccount/errors'
import {
  calculateAndSetProjectedRewards,
  calculateSelectedAccountPortfolio
} from '../../libs/selectedAccount/selectedAccount'
import EventEmitter from '../eventEmitter/eventEmitter'

export const DEFAULT_SELECTED_ACCOUNT_PORTFOLIO = {
  tokens: [],
  collections: [],
  tokenAmounts: [],
  totalBalance: 0,
  balancePerNetwork: {},
  isReadyToVisualize: false,
  isAllReady: false,
  shouldShowPartialResult: false,
  isReloading: false,
  networkSimulatedAccountOp: {},
  portfolioState: {}
}

export class SelectedAccountController extends EventEmitter implements ISelectedAccountController {
  #storage: IStorageController

  #accounts: IAccountsController

  #autoLogin: IAutoLoginController

  #portfolio: IPortfolioController | null = null

  #defiPositions: IDefiPositionsController | null = null

  #networks: INetworksController | null = null

  #keystore: IKeystoreController | null = null

  #providers: IProvidersController | null = null

  account: Account | null = null

  /**
   * Holds the selected account portfolio that is used by the UI to display the portfolio.
   * It includes the portfolio and defi positions for the selected account.
   * It is updated when the portfolio or defi positions controllers are updated.
   */
  portfolio: SelectedAccountPortfolio = DEFAULT_SELECTED_ACCOUNT_PORTFOLIO

  /**
   * Holds the selected account portfolio divided by networks. It includes the portfolio
   * and defi positions for each network. It's used when calculating the portfolio
   * for the UI - unnecessary calculations are avoided by using data stored here
   * in case it doesn't have to be recalculated.
   */
  #portfolioByNetworks: SelectedAccountPortfolioByNetworks = {}

  #portfolioLoadingTimeout: NodeJS.Timeout | null = null

  #isManualUpdate = true

  dashboardNetworkFilter: bigint | string | null = null

  #shouldDebounceFlags: { [key: string]: boolean } = {}

  #portfolioErrors: SelectedAccountBalanceError[] = []

  #defiPositionsErrors: SelectedAccountBalanceError[] = []

  isReady: boolean = false

  areControllersInitialized: boolean = false

  // Holds the initial load promise, so that one can wait until it completes
  initialLoadPromise?: Promise<void>

  dismissedBannerIds: { [key: string]: string[] } = {}

  #_defiPositions: PositionsByProvider[] = []

  set defiPositions(val: PositionsByProvider[]) {
    this.#_defiPositions = val
  }

  // @TODO: Get rid of this and get ambire's staked wallet position from cena, like all other positions
  // Currently, if you hide the stkWallet token, its balance will be deducted from the total balance,
  // unlike other positions (which isn't desired).
  get defiPositions() {
    const stkWalletToken = this.portfolio.tokens.find(
      (t) =>
        t.chainId === 1n &&
        t.address === '0xE575cC6EC0B5d176127ac61aD2D3d9d19d1aa4a0' &&
        !t.flags.rewardsType
    )
    const ambireStakedWalletDefiPosition = getStakedWalletPositions(stkWalletToken)

    if (ambireStakedWalletDefiPosition) {
      return [ambireStakedWalletDefiPosition, ...this.#_defiPositions]
    }

    return this.#_defiPositions
  }

  constructor({
    storage,
    accounts,
    keystore,
    autoLogin
  }: {
    storage: IStorageController
    accounts: IAccountsController
    keystore: IKeystoreController
    autoLogin: IAutoLoginController
  }) {
    super()

    this.#storage = storage
    this.#accounts = accounts
    this.#keystore = keystore
    this.#autoLogin = autoLogin

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.initialLoadPromise = this.#load().finally(() => {
      this.initialLoadPromise = undefined
    })
  }

  async #load() {
    await this.#accounts.initialLoadPromise

    const [selectedAccountAddress, selectedAccountDismissedBannerIds] = await Promise.all([
      this.#storage.get('selectedAccount', null),
      this.#storage.get('selectedAccountDismissedBannerIds', [])
    ])
    this.dismissedBannerIds = selectedAccountDismissedBannerIds
    this.account = this.#accounts.accounts.find((a) => a.addr === selectedAccountAddress) || null
    this.isReady = true

    this.emitUpdate()
  }

  initControllers({
    portfolio,
    defiPositions,
    networks,
    providers
  }: {
    portfolio: IPortfolioController
    defiPositions: IDefiPositionsController
    networks: INetworksController
    providers: IProvidersController
  }) {
    this.#portfolio = portfolio
    this.#defiPositions = defiPositions
    this.#networks = networks
    this.#providers = providers

    this.updateSelectedAccountPortfolio(true)
    this.#updatePortfolioErrors(true)
    this.#updateSelectedAccountDefiPositions(true)
    this.#updateDefiPositionsErrors(true)

    this.#portfolio.onUpdate(async () => {
      this.#debounceFunctionCallsOnSameTick('updateSelectedAccountPortfolio', () => {
        this.updateSelectedAccountPortfolio()
      })
    }, 'selectedAccount')

    this.#defiPositions.onUpdate(() => {
      this.#debounceFunctionCallsOnSameTick('updateSelectedAccountDefiPositions', () => {
        this.#updateSelectedAccountDefiPositions()

        if (!this.areDefiPositionsLoading) {
          this.#debounceFunctionCallsOnSameTick('updateSelectedAccountPortfolio', () => {
            this.updateSelectedAccountPortfolio(true)
            this.#updateDefiPositionsErrors()
          })
        }
      })
    })

    this.#providers.onUpdate(() => {
      this.#debounceFunctionCallsOnSameTick('updateDefiPositionsErrors', () => {
        this.#updatePortfolioErrors(true)
        this.#updateDefiPositionsErrors()
      })
    })

    this.#accounts.onUpdate(() => {
      this.#debounceFunctionCallsOnSameTick('updateSelectedAccount', () => {
        this.#updateSelectedAccount(true)
        this.#updatePortfolioErrors(true)
        this.#updateDefiPositionsErrors()
      })
    })

    this.#autoLogin.onUpdate(() => {
      if (this.account) {
        this.emitUpdate()
      }
    })

    this.areControllersInitialized = true

    this.emitUpdate()
  }

  async setAccount(account: Account | null) {
    this.account = account
    this.#portfolioErrors = []
    this.#defiPositionsErrors = []
    this.defiPositions = []
    this.#portfolioByNetworks = {}
    this.resetSelectedAccountPortfolio({ skipUpdate: true })

    const isStateWithOutdatedNetworks =
      this.account &&
      this.#portfolio &&
      this.#portfolio.getIsStateWithOutdatedNetworks(this.account.addr)

    // Display the current portfolio state immediately only if the user hasn't
    // added/removed networks since the last time the portfolio was calculated.
    if (!isStateWithOutdatedNetworks) {
      this.#updateSelectedAccountDefiPositions(true)
      this.updateSelectedAccountPortfolio(true)
      this.#updateDefiPositionsErrors(true)
    }
    this.dashboardNetworkFilter = null
    if (this.#portfolioLoadingTimeout) clearTimeout(this.#portfolioLoadingTimeout)
    this.#portfolioLoadingTimeout = null

    if (!account) {
      await this.#storage.remove('selectedAccount')
    } else {
      await this.#storage.set('selectedAccount', account.addr)
    }

    this.emitUpdate()
  }

  #updateSelectedAccount(skipUpdate: boolean = false) {
    if (!this.account) return

    const updatedAccount = this.#accounts.accounts.find((a) => a.addr === this.account!.addr)
    if (!updatedAccount) return

    this.account = updatedAccount

    if (!skipUpdate) this.emitUpdate()
  }

  resetSelectedAccountPortfolio({
    isManualUpdate,
    skipUpdate
  }: { isManualUpdate?: boolean; skipUpdate?: boolean } = {}) {
    if (!this.#portfolio || !this.account) return

    if (isManualUpdate) {
      this.#isManualUpdate = true
    }

    this.portfolio = DEFAULT_SELECTED_ACCOUNT_PORTFOLIO
    this.#portfolioErrors = []
    this.#portfolioByNetworks = {}

    if (!skipUpdate) {
      this.emitUpdate()
    }
  }

  updateSelectedAccountPortfolio(skipUpdate?: boolean) {
    if (!this.#portfolio || !this.#defiPositions || !this.account) return

    const defiPositionsAccountState = this.#defiPositions.getDefiPositionsState(this.account.addr)

    const portfolioAccountState = structuredClone(
      this.#portfolio.getAccountPortfolioState(this.account.addr)
    )

    const {
      selectedAccountPortfolio: newSelectedAccountPortfolio,
      selectedAccountPortfolioByNetworks: newSelectedAccountPortfolioByNetworks
    } = calculateSelectedAccountPortfolio(
      portfolioAccountState,
      structuredClone(this.#portfolioByNetworks),
      defiPositionsAccountState,
      this.portfolio.shouldShowPartialResult,
      this.#isManualUpdate
    )

    // Find stkWALLET or WALLET token in the latest portfolio state
    const walletORStkWalletToken = portfolioAccountState['1']?.result?.tokens.find(
      ({ address }) => address === STK_WALLET || address === WALLET_TOKEN
    )

    if (newSelectedAccountPortfolio.isAllReady && portfolioAccountState.projectedRewards) {
      const walletOrStkWalletTokenPrice = walletORStkWalletToken?.priceIn?.[0]?.price

      // Calculate and add projected rewards token
      const projectedRewardsToken = calculateAndSetProjectedRewards(
        portfolioAccountState.projectedRewards,
        newSelectedAccountPortfolio.balancePerNetwork,
        walletOrStkWalletTokenPrice
      )

      if (projectedRewardsToken) newSelectedAccountPortfolio.tokens.push(projectedRewardsToken)
    }

    // Reset the loading timestamp if the portfolio is ready
    if (this.#portfolioLoadingTimeout && newSelectedAccountPortfolio.isAllReady) {
      clearTimeout(this.#portfolioLoadingTimeout)
      this.#portfolioLoadingTimeout = null
    }

    // Set the loading timestamp when the portfolio starts loading
    if (!this.#portfolioLoadingTimeout && !newSelectedAccountPortfolio.isAllReady) {
      this.#portfolioLoadingTimeout = setTimeout(() => {
        this.portfolio.shouldShowPartialResult = true
        this.updateSelectedAccountPortfolio()
        this.#portfolioLoadingTimeout = null
      }, 5000)
    }

    // Reset isManualUpdate flag when the portfolio has finished the initial load
    if (this.#isManualUpdate && newSelectedAccountPortfolio.isAllReady) {
      this.#isManualUpdate = false
      this.portfolio.shouldShowPartialResult = false
    }

    this.portfolio = newSelectedAccountPortfolio
    this.#portfolioByNetworks = newSelectedAccountPortfolioByNetworks
    this.#updatePortfolioErrors(true)

    if (!skipUpdate) {
      this.emitUpdate()
    }
  }

  get areDefiPositionsLoading() {
    if (!this.account || !this.#defiPositions) return false

    const defiPositionsAccountState = this.#defiPositions.getDefiPositionsState(this.account.addr)
    return (
      !Object.keys(defiPositionsAccountState).length ||
      Object.values(defiPositionsAccountState).some((n) => n.isLoading)
    )
  }

  #updateSelectedAccountDefiPositions(skipUpdate?: boolean) {
    if (!this.#defiPositions || !this.account) return

    const defiPositionsAccountState = this.#defiPositions.getDefiPositionsState(this.account.addr)

    const positionsByProvider = Object.values(defiPositionsAccountState).flatMap(
      (n) => n.positionsByProvider
    )

    const positionsByProviderWithSortedAssets = positionsByProvider.map((provider) => {
      const positions = provider.positions
        .map((position) => {
          const assets = position.assets
            .filter(Boolean)
            .sort((a, b) => sortByValue(a.value, b.value))

          return { ...position, assets }
        })
        .sort((a, b) => sortByValue(a.additionalData.positionInUSD, b.additionalData.positionInUSD))

      return { ...provider, positions }
    })

    const sortedPositionsByProvider = positionsByProviderWithSortedAssets.sort((a, b) =>
      sortByValue(a.positionInUSD, b.positionInUSD)
    )

    this.defiPositions = sortedPositionsByProvider

    if (!skipUpdate) {
      this.emitUpdate()
    }
  }

  #debounceFunctionCallsOnSameTick(funcName: string, func: () => void) {
    if (this.#shouldDebounceFlags[funcName]) return
    this.#shouldDebounceFlags[funcName] = true

    // Debounce multiple calls in the same tick and only execute one of them
    setTimeout(() => {
      this.#shouldDebounceFlags[funcName] = false
      try {
        func()
      } catch (error: any) {
        this.emitError({
          level: 'silent',
          message: `The execution of ${funcName} in SelectedAccountController failed`,
          error
        })
      }
    }, 0)
  }

  #updateDefiPositionsErrors(skipUpdate?: boolean) {
    if (
      !this.account ||
      !this.#networks ||
      !this.#providers ||
      !this.#defiPositions ||
      this.areDefiPositionsLoading
    ) {
      this.#defiPositionsErrors = []
      if (!skipUpdate) {
        this.emitUpdate()
      }
      return
    }

    const defiPositionsAccountState = this.#defiPositions.getDefiPositionsState(this.account.addr)

    const errorBanners = getNetworksWithDeFiPositionsErrorErrors({
      networks: this.#networks.networks,
      currentAccountState: defiPositionsAccountState,
      providers: this.#providers.providers,
      networksWithPositions: this.#defiPositions.getNetworksWithPositions(this.account.addr)
    })

    this.#defiPositionsErrors = errorBanners

    if (!skipUpdate) {
      this.emitUpdate()
    }
  }

  #updatePortfolioErrors(skipUpdate?: boolean) {
    if (
      !this.account ||
      !this.#networks ||
      !this.#providers ||
      !this.#portfolio ||
      (!this.portfolio.isAllReady && !this.portfolio.shouldShowPartialResult)
    ) {
      this.#portfolioErrors = []
      if (!skipUpdate) {
        this.emitUpdate()
      }
      return
    }

    this.#portfolioErrors = getNetworksWithErrors({
      networks: this.#networks.networks,
      shouldShowPartialResult: this.portfolio.shouldShowPartialResult,
      selectedAccountPortfolioState: this.portfolio.portfolioState,
      isAllReady: this.portfolio.isAllReady,
      accountState: this.#accounts.accountStates[this.account.addr] || {},
      providers: this.#providers.providers,
      networksWithAssets: this.#portfolio.getNetworksWithAssets(this.account.addr)
    })

    if (!skipUpdate) {
      this.emitUpdate()
    }
  }

  get balanceAffectingErrors() {
    return [...this.#portfolioErrors, ...this.#defiPositionsErrors]
  }

  get deprecatedSmartAccountBanner(): Banner[] {
    if (!this.account || !isSmartAccount(this.account)) return []

    if (
      !this.#accounts.accountStates[this.account.addr] ||
      !this.#accounts.accountStates[this.account.addr]['1'] ||
      !this.#accounts.accountStates[this.account.addr]['1'].isV2
    )
      return []

    if (
      !this.account.creation ||
      getAddress(this.account.creation.factoryAddr) === AMBIRE_ACCOUNT_FACTORY
    )
      return []

    return [
      {
        id: 'old-account',
        meta: {
          accountAddr: this.account.addr
        },
        type: 'warning',
        category: 'old-account',
        title: 'Old Ambire Account',
        text: "The account you are using is an old Ambire Account that was intended for testing the extension only. Fee options aren't available on custom networks. It won't be supported in the future. Please migrate to another by creating a new smart account in the extension or contact the team for support",
        actions: []
      }
    ]
  }

  get autoLoginPolicies(): AutoLoginPolicy[] {
    if (!this.account) return []

    return this.#autoLogin.getAccountPolicies(this.account.addr, true)
  }

  setDashboardNetworkFilter(networkFilter: bigint | string | null) {
    this.dashboardNetworkFilter = networkFilter
    this.emitUpdate()
  }

  removeNetworkData(chainId: bigint) {
    const stringChainId = chainId.toString()

    if (this.#portfolioByNetworks[stringChainId]) {
      delete this.#portfolioByNetworks[stringChainId]
    }
    if (String(this.dashboardNetworkFilter) === stringChainId) {
      this.dashboardNetworkFilter = null
    }

    this.updateSelectedAccountPortfolio()
  }

  async dismissDefiPositionsBannerForTheSelectedAccount() {
    if (!this.account) return

    const defiBanner = this.banners.find((b) => b.id === defiPositionsOnDisabledNetworksBannerId)
    if (!defiBanner) return

    const action = defiBanner.actions.find((a) => a.actionName === 'enable-networks')
    if (!action) return

    if (!this.dismissedBannerIds[defiPositionsOnDisabledNetworksBannerId])
      this.dismissedBannerIds[defiPositionsOnDisabledNetworksBannerId] = []

    action.meta.networkChainIds.forEach((chainId) => {
      if (
        this.dismissedBannerIds[defiPositionsOnDisabledNetworksBannerId].includes(
          `${this.account!.addr}-${chainId}`
        )
      )
        return
      this.dismissedBannerIds[defiPositionsOnDisabledNetworksBannerId].push(
        `${this.account!.addr}-${chainId}`
      )
    })

    await this.#storage.set('selectedAccountDismissedBannerIds', this.dismissedBannerIds)
    this.emitUpdate()
  }

  // ! IMPORTANT !
  // Banners that depend on async data from sub-controllers should be implemented
  // in the sub-controllers themselves. This is because updates in the sub-controllers
  // will not trigger emitUpdate in the MainController, therefore the banners will
  // remain the same until a subsequent update in the MainController.
  get banners(): Banner[] {
    if (
      !this.account ||
      !this.#networks ||
      !this.#networks.isInitialized ||
      !this.#defiPositions ||
      !this.portfolio.isAllReady
    )
      return []

    const defiPositionsAccountState = this.#defiPositions.getDefiPositionsStateForAllNetworks(
      this.account.addr
    )

    const notDismissedNetworks = this.dismissedBannerIds[defiPositionsOnDisabledNetworksBannerId]
      ? this.#networks.allNetworks.filter(
          (n) =>
            !this.dismissedBannerIds[defiPositionsOnDisabledNetworksBannerId].includes(
              `${this.account!.addr}-${n.chainId}`
            )
        )
      : this.#networks.allNetworks
    return getDefiPositionsOnDisabledNetworksForTheSelectedAccount({
      defiPositionsAccountState,
      networks: notDismissedNetworks
    })
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      banners: this.banners,
      deprecatedSmartAccountBanner: this.deprecatedSmartAccountBanner,
      balanceAffectingErrors: this.balanceAffectingErrors,
      defiPositions: this.defiPositions,
      areDefiPositionsLoading: this.areDefiPositionsLoading,
      autoLoginPolicies: this.autoLoginPolicies
    }
  }
}
