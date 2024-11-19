import { Account } from '../../interfaces/account'
import { Banner } from '../../interfaces/banner'
import { SelectedAccountPortfolio } from '../../interfaces/selectedAccount'
import { Storage } from '../../interfaces/storage'
// eslint-disable-next-line import/no-cycle
import { getNetworksWithDeFiPositionsErrorBanners } from '../../libs/banners/banners'
import { sortByValue } from '../../libs/defiPositions/helpers'
import { PositionsByProvider } from '../../libs/defiPositions/types'
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
  totalBalance: 0,
  isAllReady: false,
  simulationNonces: {},
  tokenAmounts: [],
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

  #shouldDebounceFlags: { [key: string]: boolean } = {}

  defiPositions: PositionsByProvider[] = []

  defiPositionsBanners: Banner[] = []

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
    this.#updateSelectedAccountDefiPositions(true)
    this.#updateDefiPositionsBanners(true)

    this.#portfolio.onUpdate(async () => {
      this.#debounceFunctionCallsOnSameTick('updateSelectedAccountPortfolio', () =>
        this.#updateSelectedAccountPortfolio()
      )
    }, 'selectedAccount')

    this.#defiPositions.onUpdate(() => {
      this.#debounceFunctionCallsOnSameTick('updateSelectedAccountPortfolio', () =>
        this.#updateSelectedAccountPortfolio()
      )
      this.#debounceFunctionCallsOnSameTick('updateSelectedAccountDefiPositions', () =>
        this.#updateSelectedAccountDefiPositions()
      )
      this.#debounceFunctionCallsOnSameTick('updateDefiPositionsBanners', () =>
        this.#updateDefiPositionsBanners()
      )
    })

    this.#providers.onUpdate(() => {
      this.#debounceFunctionCallsOnSameTick('updateDefiPositionsBanners', () =>
        this.#updateDefiPositionsBanners()
      )
      // TODO: add portfolio banners and call updatePortfolioBanners here
    })

    this.areControllersInitialized = true

    this.emitUpdate()
  }

  async setAccount(account: Account | null) {
    this.account = account
    this.resetSelectedAccountPortfolio(true)

    if (!account) {
      await this.#storage.remove('selectedAccount')
    } else {
      await this.#storage.set('selectedAccount', account.addr)
    }

    this.emitUpdate()
  }

  resetSelectedAccountPortfolio(skipUpdate?: boolean) {
    this.portfolio = DEFAULT_SELECTED_ACCOUNT_PORTFOLIO

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
      defiPositionsAccountState
    )

    const pendingStateSelectedAccountWithDefiPositions = updatePortfolioStateWithDefiPositions(
      pendingStateSelectedAccount,
      defiPositionsAccountState
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

  #updateDefiPositionsBanners(skipUpdate?: boolean) {
    if (!this.account || !this.#networks || !this.#providers || !this.#defiPositions) return

    const defiPositionsAccountState = this.#defiPositions.getDefiPositionsState(this.account.addr)

    const errorBanners = getNetworksWithDeFiPositionsErrorBanners({
      networks: this.#networks.networks,
      currentAccountState: defiPositionsAccountState,
      providers: this.#providers.providers
    })

    this.defiPositionsBanners = errorBanners

    if (!skipUpdate) {
      this.emitUpdate()
    }
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      areDefiPositionsLoading: this.areDefiPositionsLoading
    }
  }
}
