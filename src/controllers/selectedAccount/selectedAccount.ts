import { Account } from '../../interfaces/account'
import { Storage } from '../../interfaces/storage'
// eslint-disable-next-line import/no-cycle
import { AccountsController } from '../accounts/accounts'
// eslint-disable-next-line import/no-cycle
import { DefiPositionsController } from '../defiPositions/defiPositions'
import EventEmitter from '../eventEmitter/eventEmitter'
// eslint-disable-next-line import/no-cycle
import { PortfolioController } from '../portfolio/portfolio'

export class SelectedAccountController extends EventEmitter {
  #storage: Storage

  #accounts: AccountsController

  #portfolio: PortfolioController | null = null

  #defiPositions: DefiPositionsController | null = null

  account: Account | null = null

  isReady: boolean = false

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
    if (!selectedAccount) return

    this.account = selectedAccount
    this.isReady = true

    this.emitUpdate()
  }

  initControllers({
    portfolio,
    defiPositions
  }: {
    portfolio: PortfolioController
    defiPositions: DefiPositionsController
  }) {
    this.#portfolio = portfolio
    this.#defiPositions = defiPositions
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

  toJSON() {
    return {
      ...this,
      ...super.toJSON()
    }
  }
}
