import { getAddress } from 'ethers'

import { AMBIRE_ACCOUNT_FACTORY } from '../../consts/deploy'
import { Account } from '../../interfaces/account'
import { Banner } from '../../interfaces/banner'
import { NetworkId } from '../../interfaces/network'
import { SelectedAccountPortfolio } from '../../interfaces/selectedAccount'
import { Storage } from '../../interfaces/storage'
import { isSmartAccount } from '../../libs/account/account'
import { sortByValue } from '../../libs/defiPositions/helpers'
import { PositionsByProvider } from '../../libs/defiPositions/types'
// eslint-disable-next-line import/no-cycle
import {
  getNetworksWithDeFiPositionsErrorErrors,
  getNetworksWithFailedRPCErrors,
  getNetworksWithPortfolioErrorErrors,
  SelectedAccountBalanceError
} from '../../libs/selectedAccount/errors'
import {
  calculateSelectedAccountPortfolio,
  updatePortfolioStateWithDefiPositions
} from '../../libs/selectedAccount/selectedAccount'
// eslint-disable-next-line import/no-cycle
import { AccountsController } from '../accounts/accounts'
// eslint-disable-next-line import/no-cycle
import { ActionsController } from '../actions/actions'
// eslint-disable-next-line import/no-cycle
import { DefiPositionsController } from '../defiPositions/defiPositions'
import EventEmitter from '../eventEmitter/eventEmitter'
import { NetworksController } from '../networks/networks'
// eslint-disable-next-line import/no-cycle
import { PortfolioController } from '../portfolio/portfolio'
import { ProvidersController } from '../providers/providers'

export const DEFAULT_SELECTED_ACCOUNT_PORTFOLIO = {
  tokens: [],
  collections: [],
  tokenAmounts: [],
  totalBalance: 0,
  isAllReady: false,
  networkSimulatedAccountOp: {},
  latest: {},
  pending: {}
}

export class SelectedAccountController extends EventEmitter {
  #storage: Storage

  #accounts: AccountsController

  #portfolio: PortfolioController | null = null

  #defiPositions: DefiPositionsController | null = null

  #actions: ActionsController | null = null

  #networks: NetworksController | null = null

  #providers: ProvidersController | null = null

  account: Account | null = null

  portfolio: SelectedAccountPortfolio = DEFAULT_SELECTED_ACCOUNT_PORTFOLIO

  portfolioStartedLoadingAtTimestamp: number | null = null

  dashboardNetworkFilter: NetworkId | null = null

  #shouldDebounceFlags: { [key: string]: boolean } = {}

  defiPositions: PositionsByProvider[] = []

  #portfolioErrors: SelectedAccountBalanceError[] = []

  #defiPositionsErrors: SelectedAccountBalanceError[] = []

  isReady: boolean = false

  areControllersInitialized: boolean = false

  // Holds the initial load promise, so that one can wait until it completes
  initialLoadPromise: Promise<void>

  constructor({ storage, accounts }: { storage: Storage; accounts: AccountsController }) {
    super()

    this.#storage = storage
    this.#accounts = accounts

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.initialLoadPromise = this.#load()
  }

  async #load() {
    await this.#accounts.initialLoadPromise
    const selectedAccountAddress = await this.#storage.get('selectedAccount', null)

    const selectedAccount = this.#accounts.accounts.find((a) => a.addr === selectedAccountAddress)

    this.account = selectedAccount || null
    this.isReady = true

    this.emitUpdate()
  }

  initControllers({
    portfolio,
    defiPositions,
    actions,
    networks,
    providers
  }: {
    portfolio: PortfolioController
    defiPositions: DefiPositionsController
    actions: ActionsController
    networks: NetworksController
    providers: ProvidersController
  }) {
    this.#portfolio = portfolio
    this.#defiPositions = defiPositions
    this.#actions = actions
    this.#networks = networks
    this.#providers = providers

    this.#updateSelectedAccountPortfolio(true)
    this.#updatePortfolioErrors(true)
    this.#updateSelectedAccountDefiPositions(true)
    this.#updateDefiPositionsErrors(true)

    this.#portfolio.onUpdate(async () => {
      this.#debounceFunctionCallsOnSameTick('updateSelectedAccountPortfolio', () => {
        this.#updateSelectedAccountPortfolio()
      })
    }, 'selectedAccount')

    this.#defiPositions.onUpdate(() => {
      this.#debounceFunctionCallsOnSameTick('updateSelectedAccountDefiPositions', () => {
        this.#updateSelectedAccountDefiPositions()

        if (!this.areDefiPositionsLoading && this.portfolio.isAllReady) {
          this.#updateSelectedAccountPortfolio(true)
          this.#updateDefiPositionsErrors()
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
        this.#updateSelectedAccount()
        this.#updatePortfolioErrors(true)
        this.#updateDefiPositionsErrors()
      })
    })

    this.areControllersInitialized = true

    this.emitUpdate()
  }

  async setAccount(account: Account | null) {
    this.account = account
    this.#portfolioErrors = []
    this.#defiPositionsErrors = []
    this.resetSelectedAccountPortfolio(true)
    this.dashboardNetworkFilter = null

    if (!account) {
      await this.#storage.remove('selectedAccount')
    } else {
      await this.#storage.set('selectedAccount', account.addr)
    }

    this.emitUpdate()
  }

  #updateSelectedAccount() {
    if (!this.account) return

    const updatedAccount = this.#accounts.accounts.find((a) => a.addr === this.account!.addr)
    if (!updatedAccount) return

    this.account = updatedAccount

    this.emitUpdate()
  }

  resetSelectedAccountPortfolio(skipUpdate?: boolean) {
    this.portfolio = DEFAULT_SELECTED_ACCOUNT_PORTFOLIO
    this.#portfolioErrors = []

    if (!skipUpdate) {
      this.emitUpdate()
    }
  }

  #updateSelectedAccountPortfolio(skipUpdate?: boolean) {
    if (!this.#portfolio || !this.#defiPositions || !this.account) return
    const defiPositionsAccountState = this.#defiPositions.getDefiPositionsState(this.account.addr)

    const latestStateSelectedAccount = structuredClone(
      this.#portfolio.getLatestPortfolioState(this.account.addr)
    )
    const pendingStateSelectedAccount = structuredClone(
      this.#portfolio.getPendingPortfolioState(this.account.addr)
    )

    const latestStateSelectedAccountWithDefiPositions = updatePortfolioStateWithDefiPositions(
      latestStateSelectedAccount,
      defiPositionsAccountState,
      this.areDefiPositionsLoading
    )

    const pendingStateSelectedAccountWithDefiPositions = updatePortfolioStateWithDefiPositions(
      pendingStateSelectedAccount,
      defiPositionsAccountState,
      this.areDefiPositionsLoading
    )

    const hasSignAccountOp = !!this.#actions?.visibleActionsQueue.filter(
      (action) => action.type === 'accountOp'
    )

    const newSelectedAccountPortfolio = calculateSelectedAccountPortfolio(
      latestStateSelectedAccountWithDefiPositions,
      pendingStateSelectedAccountWithDefiPositions,
      this.portfolio,
      hasSignAccountOp
    )

    if (this.portfolioStartedLoadingAtTimestamp && newSelectedAccountPortfolio.isAllReady) {
      this.portfolioStartedLoadingAtTimestamp = null
    }

    if (!this.portfolioStartedLoadingAtTimestamp && !newSelectedAccountPortfolio.isAllReady) {
      this.portfolioStartedLoadingAtTimestamp = Date.now()
    }

    if (
      newSelectedAccountPortfolio.isAllReady ||
      (!this.portfolio?.tokens?.length && newSelectedAccountPortfolio.tokens.length)
    ) {
      this.portfolio = newSelectedAccountPortfolio
      this.#updatePortfolioErrors(true)
    }

    if (!skipUpdate) {
      this.emitUpdate()
    }
  }

  get areDefiPositionsLoading() {
    if (!this.account || !this.#defiPositions) return false

    const defiPositionsAccountState = this.#defiPositions.getDefiPositionsState(this.account.addr)
    return Object.values(defiPositionsAccountState).some((n) => n.isLoading)
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
          const assets = position.assets.sort((a, b) => sortByValue(a.value, b.value))

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

  #debounceFunctionCallsOnSameTick(funcName: string, func: Function) {
    if (this.#shouldDebounceFlags[funcName]) return
    this.#shouldDebounceFlags[funcName] = true

    // Debounce multiple calls in the same tick and only execute one of them
    setTimeout(() => {
      this.#shouldDebounceFlags[funcName] = false
      func()
    }, 0)
  }

  #updateDefiPositionsErrors(skipUpdate?: boolean) {
    if (
      !this.account ||
      !this.#networks ||
      !this.#providers ||
      !this.#defiPositions ||
      this.areDefiPositionsLoading ||
      !this.#accounts.areAccountStatesLoading
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
      !this.portfolio.isAllReady
    ) {
      this.#portfolioErrors = []
      if (!skipUpdate) {
        this.emitUpdate()
      }
      return
    }

    const networksWithFailedRPCBanners = getNetworksWithFailedRPCErrors({
      providers: this.#providers.providers,
      networks: this.#networks.networks,
      networksWithAssets: this.#portfolio.getNetworksWithAssets(this.account.addr)
    })

    const errorBanners = getNetworksWithPortfolioErrorErrors({
      networks: this.#networks.networks,
      selectedAccountLatest: this.portfolio.latest,
      providers: this.#providers.providers
    })

    this.#portfolioErrors = [...networksWithFailedRPCBanners, ...errorBanners]

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
      !this.#accounts.accountStates[this.account.addr].ethereum ||
      !this.#accounts.accountStates[this.account.addr].ethereum.isV2
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
        accountAddr: this.account.addr,
        type: 'warning',
        category: 'old-account',
        title: 'Old Ambire Account',
        text: "The account you are using is an old Ambire Account that was intended for testing the extension only. Fee options aren't available on custom networks. It won't be supported in the future. Please migrate to another by creating a new smart account in the extension or contact the team for support",
        actions: []
      }
    ]
  }

  setDashboardNetworkFilter(networkFilter: NetworkId | null) {
    this.dashboardNetworkFilter = networkFilter
    this.emitUpdate()
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      deprecatedSmartAccountBanner: this.deprecatedSmartAccountBanner,
      areDefiPositionsLoading: this.areDefiPositionsLoading,
      balanceAffectingErrors: this.balanceAffectingErrors
    }
  }
}
