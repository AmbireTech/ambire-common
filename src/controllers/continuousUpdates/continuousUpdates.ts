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

  #accountStateRetriesByNetwork: {
    [chainId: string]: number
  } = {}

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
      this.#updatePortfolio.bind(this),
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
      this.#updateAccountStateLatest.bind(this),
      ACCOUNT_STATE_STAND_BY_INTERVAL,
      this.emitError.bind(this)
    )

    this.#accountStatePendingInterval = new RecurringTimeout(
      this.#updateAccountStatePending.bind(this),
      ACCOUNT_STATE_PENDING_INTERVAL,
      this.emitError.bind(this),
      'accountStatePendingInterval'
    )

    this.#accountsOpsStatusesInterval = new RecurringTimeout(
      this.#updateAccountsOpsStatuses.bind(this),
      ACTIVITY_REFRESH_INTERVAL,
      this.emitError.bind(this)
    )

    /**
     * Update failed network states more often. If a network's first failed
     *  update is just now, retry in 8s. If it's a repeated failure, retry in 20s.
     */
    this.#fastAccountStateReFetchTimeout = new RecurringTimeout(
      this.#fastAccountStateReFetch.bind(this),
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
      const allBroadcastedButNotConfirmed = Object.values(
        this.#main.activity.broadcastedButNotConfirmed
      ).flat()

      if (allBroadcastedButNotConfirmed.length) {
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

  async #updatePortfolio() {
    await this.initialLoadPromise

    const selectedAccountBroadcastedButNotConfirmed = this.#main.selectedAccount.account
      ? this.#main.activity.broadcastedButNotConfirmed[this.#main.selectedAccount.account.addr]
      : []
    if (selectedAccountBroadcastedButNotConfirmed?.length) return
    await this.#main.updateSelectedAccountPortfolio({
      maxDataAgeMs: 60 * 1000,
      maxDataAgeMsUnused: 60 * 60 * 1000
    })
  }

  async #updateAccountsOpsStatuses() {
    await this.initialLoadPromise
    await this.#main.updateAccountsOpsStatuses()
  }

  async #updateAccountStateLatest() {
    await this.initialLoadPromise
    await this.#main.accounts.accountStateInitialLoadPromise

    if (!this.#main.selectedAccount.account) {
      console.error('No selected account to latest state')
      return
    }

    const failedChainIds: string[] = getNetworksWithFailedRPC({
      providers: this.#main.providers.providers
    })

    const selectedAccountBroadcastedButNotConfirmed = this.#main.selectedAccount.account
      ? this.#main.activity.broadcastedButNotConfirmed[this.#main.selectedAccount.account.addr] ||
        []
      : []
    const networksWithPendingAccountOp = selectedAccountBroadcastedButNotConfirmed
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

  async #updateAccountStatePending() {
    await this.initialLoadPromise
    await this.#main.accounts.accountStateInitialLoadPromise

    if (!this.#main.selectedAccount.account) {
      console.error('No selected account to update pending state')
      return
    }

    const selectedAccountBroadcastedButNotConfirmed = this.#main.selectedAccount.account
      ? this.#main.activity.broadcastedButNotConfirmed[this.#main.selectedAccount.account.addr] ||
        []
      : []
    const networksToUpdate = selectedAccountBroadcastedButNotConfirmed
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

  async #fastAccountStateReFetch() {
    await this.initialLoadPromise

    const selectedAccountAddr = this.#main.selectedAccount.account?.addr

    const failedChainIds: string[] = getNetworksWithFailedRPC({
      providers: this.#main.providers.providers
    })

    const chainIdsToRetry = failedChainIds.filter((id) => {
      const retries = this.#accountStateRetriesByNetwork[id] || 0

      return retries < 3
    })

    if (!chainIdsToRetry.length || !selectedAccountAddr) {
      this.#fastAccountStateReFetchTimeout.stop()
      this.#accountStateRetriesByNetwork = {}
      return
    }

    await this.#main.accounts.updateAccountState(
      selectedAccountAddr,
      'latest',
      chainIdsToRetry.map((id) => BigInt(id))
    )

    // Increment the retry count for each chainId
    chainIdsToRetry.forEach((id) => {
      this.#accountStateRetriesByNetwork[id] = (this.#accountStateRetriesByNetwork[id] || 0) + 1
    })

    const failedChainIdsAfterUpdate = getNetworksWithFailedRPC({
      providers: this.#main.providers.providers
    })

    // Delete the network ids that have been successfully re-fetched so the logic can be re-applied
    // if the RPC goes down again
    if (Object.keys(this.#accountStateRetriesByNetwork).length) {
      const networksToUpdate: Network[] = []
      Object.keys(this.#accountStateRetriesByNetwork).forEach((chainId) => {
        if (!failedChainIdsAfterUpdate.includes(chainId)) {
          delete this.#accountStateRetriesByNetwork[chainId]

          const network = this.#main.networks.networks.find((n) => n.chainId.toString() === chainId)

          if (network) networksToUpdate.push(network)
        }
      })
      this.#main.updateSelectedAccountPortfolio({
        networks: networksToUpdate.length ? networksToUpdate : undefined,
        maxDataAgeMs: 60 * 1000
      })
    }

    if (!failedChainIdsAfterUpdate.length) {
      this.#fastAccountStateReFetchTimeout.stop()
      return
    }

    // Filter out the network ids that have already been retried
    const networksNotYetRetried = failedChainIdsAfterUpdate.filter(
      (id) => !this.#accountStateRetriesByNetwork[id]
    )

    const updateTime = networksNotYetRetried.length ? 8000 : 20000

    this.#fastAccountStateReFetchTimeout.updateTimeout({ timeout: updateTime })
  }
}
