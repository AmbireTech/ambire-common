import { Account } from '../../interfaces/account'
import { SelectedAccountPortfolio } from '../../interfaces/selectedAccount'
import { Storage } from '../../interfaces/storage'
import { sortByValue } from '../../libs/defiPositions/helpers'
import { PositionsByProvider } from '../../libs/defiPositions/types'
import {
  calculateSelectedAccountPortfolio,
  getSelectedAccountPortfolio
} from '../../libs/selectedAccount/selectedAccount'
// eslint-disable-next-line import/no-cycle
import { AccountsController } from '../accounts/accounts'
// eslint-disable-next-line import/no-cycle
import { Action, ActionsController } from '../actions/actions'
// eslint-disable-next-line import/no-cycle
import { DefiPositionsController } from '../defiPositions/defiPositions'
import EventEmitter from '../eventEmitter/eventEmitter'
// eslint-disable-next-line import/no-cycle
import { PortfolioController } from '../portfolio/portfolio'

const DEFAULT_SELECTED_ACCOUNT_PORTFOLIO = {
  tokens: [],
  collections: [],
  totalBalance: 0,
  isAllReady: false,
  simulationNonces: {},
  tokenAmounts: [],
  latestStateByNetworks: {},
  pendingStateByNetwork: {}
}

export class SelectedAccountController extends EventEmitter {
  #storage: Storage

  #accounts: AccountsController

  #portfolio: PortfolioController | null = null

  #defiPositions: DefiPositionsController | null = null

  #actions: ActionsController | null = null

  account: Account | null = null

  portfolio: SelectedAccountPortfolio = DEFAULT_SELECTED_ACCOUNT_PORTFOLIO

  defiPositions: PositionsByProvider[] = []

  actions: Action[] = []

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
    actions
  }: {
    portfolio: PortfolioController
    defiPositions: DefiPositionsController
    actions: ActionsController
  }) {
    this.#portfolio = portfolio
    this.#defiPositions = defiPositions
    this.#actions = actions

    this.#updateSelectedAccountPortfolio(true)
    this.#updateSelectedAccountDefiPositions(true)
    this.#updateSelectedAccountActions(true)

    this.#portfolio.onUpdate(() => {
      this.#updateSelectedAccountPortfolio()
    })

    this.#defiPositions.onUpdate(() => {
      this.#updateSelectedAccountPortfolio()
      this.#updateSelectedAccountDefiPositions()
    })

    this.#actions.onUpdate(() => {
      this.#updateSelectedAccountActions()
    })

    this.areControllersInitialized = true

    this.emitUpdate()
  }

  async setAccount(account: Account | null) {
    this.account = account

    if (!account) {
      await this.#storage.remove('selectedAccount')
    } else {
      await this.#storage.set('selectedAccount', account.addr)
    }

    this.emitUpdate()
  }

  async resetPortfolio() {
    this.portfolio = DEFAULT_SELECTED_ACCOUNT_PORTFOLIO

    this.emitUpdate()
  }

  #updateSelectedAccountPortfolio(skipUpdate?: boolean) {
    if (!this.#portfolio || !this.#defiPositions || !this.account) return

    const defiPositionsAccountState = this.#defiPositions.state[this.account.addr]

    const updatedPortfolioState = getSelectedAccountPortfolio(
      structuredClone({
        latest: this.#portfolio.latest,
        pending: this.#portfolio.pending
      }),
      defiPositionsAccountState,
      this.account
    )

    const hasSignAccountOp = !!this.actions.filter((action) => action.type === 'accountOp')

    const newSelectedAccountPortfolio = calculateSelectedAccountPortfolio(
      this.account.addr,
      updatedPortfolioState,
      this.portfolio,
      hasSignAccountOp
    )

    if (
      newSelectedAccountPortfolio.isAllReady ||
      (!this.portfolio?.tokens?.length && newSelectedAccountPortfolio.tokens.length)
    ) {
      this.portfolio = newSelectedAccountPortfolio

      if (!skipUpdate) {
        this.emitUpdate()
      }
    }
  }

  #updateSelectedAccountDefiPositions(skipUpdate?: boolean) {
    if (!this.#defiPositions || !this.account) return

    const positionsByProvider = Object.values(
      this.#defiPositions.state[this.account.addr] || {}
    ).flatMap((n) => n.positionsByProvider)

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

  #updateSelectedAccountActions(skipUpdate?: boolean) {
    if (!this.#actions || !this.account) return

    this.actions = this.#actions.actionsQueue.filter((a) => {
      if (a.type === 'accountOp') {
        return a.accountOp.accountAddr === this.account!.addr
      }
      if (a.type === 'signMessage') {
        return a.userRequest.meta.accountAddr === this.account!.addr
      }
      if (a.type === 'benzin') {
        return a.userRequest.meta.accountAddr === this.account!.addr
      }

      return true
    })

    if (!skipUpdate) {
      this.emitUpdate()
    }
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON()
    }
  }
}
