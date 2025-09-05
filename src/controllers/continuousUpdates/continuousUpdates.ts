import {
  IRecurringTimeout,
  RecurringTimeout
} from '../../classes/recurringTimeout/recurringTimeout'
import {
  ACCOUNT_STATE_PENDING_INTERVAL,
  ACCOUNT_STATE_STAND_BY_INTERVAL,
  ACTIVE_EXTENSION_PORTFOLIO_UPDATE_INTERVAL,
  ACTIVITY_REFRESH_INTERVAL,
  INACTIVE_EXTENSION_PORTFOLIO_UPDATE_INTERVAL
} from '../../consts/intervals'
import { IMainController } from '../../interfaces/main'
import { Network } from '../../interfaces/network'
import { getNetworksWithFailedRPC } from '../../libs/networks/networks'
import EventEmitter from '../eventEmitter/eventEmitter'

/* eslint-disable @typescript-eslint/no-floating-promises */

export class ContinuousUpdatesController extends EventEmitter {
  #main: IMainController

  #updatePortfolioInterval: IRecurringTimeout

  get updatePortfolioInterval() {
    return this.#updatePortfolioInterval
  }

  #accountsOpsStatusesInterval: IRecurringTimeout

  get accountsOpsStatusesInterval() {
    return this.#accountsOpsStatusesInterval
  }

  #accountStateLatestInterval: IRecurringTimeout

  get accountStateLatestInterval() {
    return this.#accountStateLatestInterval
  }

  #accountStatePendingInterval: IRecurringTimeout

  get accountStatePendingInterval() {
    return this.#accountStatePendingInterval
  }

  #fastAccountStateReFetchTimeout: IRecurringTimeout

  get fastAccountStateReFetchTimeout() {
    return this.#fastAccountStateReFetchTimeout
  }

  #retriedFastAccountStateReFetchForNetworks: string[] = []

  // Holds the initial load promise, so that one can wait until it completes
  initialLoadPromise?: Promise<void> | undefined

  constructor({ main }: { main: IMainController }) {
    super()

    this.#main = main

    // Postpone the portfolio update for the next interval
    // if we have broadcasted but not yet confirmed acc op.
    // Here's why:
    // 1. On the Dashboard, we show a pending-to-be-confirmed token badge
    //    if an acc op has been broadcasted but is still unconfirmed.
    // 2. To display the expected balance change, we calculate it from the portfolio's pending simulation state.
    // 3. When we sign and broadcast the acc op, we remove it from the Main controller.
    // 4. If we trigger a portfolio update at this point, we will lose the pending simulation state.
    // 5. Therefore, to ensure the badge is displayed, we pause the portfolio update temporarily.
    //    Once the acc op is confirmed or failed, the portfolio interval will resume as normal.
    // 6. Gotcha: If the user forcefully updates the portfolio, we will also lose the simulation.
    //    However, this is not a frequent case, and we can make a compromise here.
    this.#updatePortfolioInterval = new RecurringTimeout(
      () => this.updatePortfolio(),
      INACTIVE_EXTENSION_PORTFOLIO_UPDATE_INTERVAL,
      this.emitError.bind(this)
    )

    this.#main.ui.uiEvent.on('addView', () => {
      if (this.#main.ui.views.length === 1) {
        this.#updatePortfolioInterval.restart({
          timeout: ACTIVE_EXTENSION_PORTFOLIO_UPDATE_INTERVAL
        })
        this.#fastAccountStateReFetchTimeout.start()
      }
    })
    this.#main.ui.uiEvent.on('removeView', () => {
      if (!this.#main.ui.views.length) {
        this.#updatePortfolioInterval.restart({
          timeout: INACTIVE_EXTENSION_PORTFOLIO_UPDATE_INTERVAL
        })
        this.#fastAccountStateReFetchTimeout.stop()
      }
    })

    /**
     * Updates the account state for the selected account. Doesn't update the state for networks with failed RPC as this is handled by a different interval.
     */
    this.#accountStateLatestInterval = new RecurringTimeout(
      async () => this.updateAccountStateLatest(),
      ACCOUNT_STATE_STAND_BY_INTERVAL,
      this.emitError.bind(this)
    )

    this.#accountStatePendingInterval = new RecurringTimeout(
      async () => this.updateAccountStatePending(),
      ACCOUNT_STATE_PENDING_INTERVAL,
      this.emitError.bind(this),
      'accountStatePendingInterval'
    )

    this.#accountsOpsStatusesInterval = new RecurringTimeout(
      async () => this.updateAccountsOpsStatuses(),
      ACTIVITY_REFRESH_INTERVAL,
      this.emitError.bind(this)
    )

    /**
     * Update failed network states more often. If a network's first failed
     *  update is just now, retry in 8s. If it's a repeated failure, retry in 20s.
     */
    this.#fastAccountStateReFetchTimeout = new RecurringTimeout(
      async () => this.fastAccountStateReFetch(),
      8000,
      this.emitError.bind(this),
      'fastAccountStateReFetchTimeout'
    )

    this.#main.onUpdate(() => {
      if (this.#main.statuses.signAndBroadcastAccountOp === 'SUCCESS') {
        this.#accountStatePendingInterval.start({ timeout: ACCOUNT_STATE_PENDING_INTERVAL / 2 })
        this.#accountStateLatestInterval.restart()
      }
    }, 'continuous-update')

    this.#main.providers.onUpdate(() => {
      this.#fastAccountStateReFetchTimeout.restart()
    }, 'continuous-update')

    this.#main.activity.onUpdate(() => {
      if (this.#main.activity.broadcastedButNotConfirmed.length) {
        this.#accountsOpsStatusesInterval.start()
      } else {
        this.#accountsOpsStatusesInterval.stop()
      }
    }, 'continuous-update')

    this.initialLoadPromise = this.#load().finally(() => {
      this.initialLoadPromise = undefined
    })
  }

  async #load() {
    await this.#main.initialLoadPromise

    this.#accountStateLatestInterval.start()
  }

  async updatePortfolio() {
    await this.initialLoadPromise

    if (this.#main.activity.broadcastedButNotConfirmed.length) return
    await this.#main.updateSelectedAccountPortfolio()
  }

  async updateAccountsOpsStatuses() {
    await this.initialLoadPromise
    await this.#main.updateAccountsOpsStatuses()
  }

  async updateAccountStateLatest() {
    await this.initialLoadPromise

    if (!this.#main.selectedAccount.account) {
      console.error('No selected account to latest state')
      return
    }

    const failedChainIds: string[] = getNetworksWithFailedRPC({
      providers: this.#main.providers.providers
    })

    const networksWithPendingAccountOp = this.#main.activity.broadcastedButNotConfirmed
      .map((op) => op.chainId)
      .filter((chainId, index, self) => self.indexOf(chainId) === index)

    const networksToUpdate = this.#main.networks.networks
      .filter(
        ({ chainId }) =>
          !networksWithPendingAccountOp.includes(chainId) &&
          !failedChainIds.includes(chainId.toString())
      )
      .map(({ chainId }) => chainId)

    await this.#main.accounts.updateAccountState(
      this.#main.selectedAccount.account.addr,
      'latest',
      networksToUpdate
    )
  }

  async updateAccountStatePending() {
    await this.initialLoadPromise

    if (!this.#main.selectedAccount.account) {
      console.error('No selected account to update pending state')
      return
    }

    const networksToUpdate = this.#main.activity.broadcastedButNotConfirmed
      .map((op) => op.chainId)
      .filter((chainId, index, self) => self.indexOf(chainId) === index)

    if (!networksToUpdate.length) {
      this.#accountStatePendingInterval.stop()
      this.#accountStateLatestInterval.restart()
      return
    }

    await this.#main.accounts.updateAccountState(
      this.#main.selectedAccount.account.addr,
      'pending',
      networksToUpdate
    )
  }

  async fastAccountStateReFetch() {
    await this.initialLoadPromise

    const failedChainIds: string[] = getNetworksWithFailedRPC({
      providers: this.#main.providers.providers
    })
    if (!failedChainIds.length) {
      this.#fastAccountStateReFetchTimeout.stop()
      this.#retriedFastAccountStateReFetchForNetworks = []
      return
    }

    await this.#main.accounts.updateAccountStates(
      this.#main.selectedAccount.account?.addr,
      'latest',
      failedChainIds.map((id) => BigInt(id))
    )

    // Add the networks that have been retried to the list
    failedChainIds.forEach((id) => {
      if (this.#retriedFastAccountStateReFetchForNetworks.includes(id)) return
      this.#retriedFastAccountStateReFetchForNetworks.push(id)
    })

    const failedChainIdsAfterUpdate = getNetworksWithFailedRPC({
      providers: this.#main.providers.providers
    })

    // Delete the network ids that have been successfully re-fetched so the logic can be re-applied
    // if the RPC goes down again
    if (this.#retriedFastAccountStateReFetchForNetworks.length) {
      const networksToUpdate: Network[] = []
      this.#retriedFastAccountStateReFetchForNetworks.forEach((chainId, index) => {
        if (!failedChainIdsAfterUpdate.includes(chainId)) {
          delete this.#retriedFastAccountStateReFetchForNetworks[index]

          const network = this.#main.networks.networks.find((n) => n.chainId.toString() === chainId)

          if (network) networksToUpdate.push(network)
        }
      })
      this.#main.updateSelectedAccountPortfolio({
        networks: networksToUpdate.length ? networksToUpdate : undefined
      })
    }

    if (!failedChainIdsAfterUpdate.length) {
      this.#fastAccountStateReFetchTimeout.stop()
      this.#retriedFastAccountStateReFetchForNetworks = []
      return
    }

    // Filter out the network ids that have already been retried
    const networksNotYetRetried = failedChainIdsAfterUpdate.filter(
      (id) => !this.#retriedFastAccountStateReFetchForNetworks.find((chainId) => chainId === id)
    )

    const updateTime = networksNotYetRetried.length ? 8000 : 20000

    this.#fastAccountStateReFetchTimeout.updateTimeout({ timeout: updateTime })
  }
}
