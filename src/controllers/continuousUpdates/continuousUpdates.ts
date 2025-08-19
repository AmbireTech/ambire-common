import {
  ACCOUNT_STATE_PENDING_INTERVAL,
  ACCOUNT_STATE_STAND_BY_INTERVAL,
  ACTIVE_EXTENSION_PORTFOLIO_UPDATE_INTERVAL,
  ACTIVITY_REFRESH_INTERVAL,
  INACTIVE_EXTENSION_PORTFOLIO_UPDATE_INTERVAL
} from '../../consts/intervals'
import { IMainController } from '../../interfaces/main'
import { getNetworksWithFailedRPC } from '../../libs/networks/networks'
import { createRecurringTimeout, RecurringTimeout } from '../../utils/timeout'

/* eslint-disable @typescript-eslint/no-floating-promises */

const getIntervalRefreshTime = (constUpdateInterval: number, newestOpTimestamp: number): number => {
  // 5s + new Date().getTime() - timestamp of newest op / 10
  // here are some example of what this means:
  // 1s diff between now and newestOpTimestamp: 5.1s
  // 10s diff between now and newestOpTimestamp: 6s
  // 60s diff between now and newestOpTimestamp: 11s
  // 5m diff between now and newestOpTimestamp: 35s
  // 10m diff between now and newestOpTimestamp: 65s
  return newestOpTimestamp === 0
    ? constUpdateInterval
    : constUpdateInterval + (new Date().getTime() - newestOpTimestamp) / 10
}
export class ContinuousUpdatesController {
  #main: IMainController

  updatePortfolioInterval: RecurringTimeout

  accountsOpsStatusesInterval: RecurringTimeout

  accountStateLatestInterval: RecurringTimeout

  accountStatePendingInterval: RecurringTimeout

  fastAccountStateReFetchTimeout: RecurringTimeout

  #retriedFastAccountStateReFetchForNetworks: string[] = []

  constructor({ main }: { main: IMainController }) {
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
    this.updatePortfolioInterval = createRecurringTimeout(async () => {
      if (this.#main.activity.broadcastedButNotConfirmed.length) return
      await this.#main.updateSelectedAccountPortfolio()
    }, INACTIVE_EXTENSION_PORTFOLIO_UPDATE_INTERVAL)

    this.#main.ui.uiEvent.on('addView', () => {
      if (this.#main.ui.views.length === 1) {
        this.updatePortfolioInterval.restart({
          timeout: ACTIVE_EXTENSION_PORTFOLIO_UPDATE_INTERVAL
        })
        this.fastAccountStateReFetchTimeout.start()
      }
    })
    this.#main.ui.uiEvent.on('removeView', () => {
      if (!this.#main.ui.views.length) {
        this.updatePortfolioInterval.restart({
          timeout: INACTIVE_EXTENSION_PORTFOLIO_UPDATE_INTERVAL
        })
        this.fastAccountStateReFetchTimeout.stop()
      }
    })

    /**
     * Updates the account state for the selected account. Doesn't update the state for networks with failed RPC as this is handled by a different interval.
     */
    this.accountStateLatestInterval = createRecurringTimeout(async () => {
      if (!this.#main.selectedAccount.account) {
        console.error('No selected account to latest state')
        return
      }

      const failedChainIds = getNetworksWithFailedRPC({
        providers: this.#main.providers.providers
      })
      const networksToUpdate = this.#main.networks.networks
        .filter(({ chainId }) => !failedChainIds.includes(chainId.toString()))
        .map(({ chainId }) => chainId)

      await this.#main.accounts.updateAccountState(
        this.#main.selectedAccount.account.addr,
        'latest',
        networksToUpdate
      )
    }, ACCOUNT_STATE_STAND_BY_INTERVAL)
    this.accountStateLatestInterval.start()

    this.accountStatePendingInterval = createRecurringTimeout(async () => {
      if (!this.#main.selectedAccount.account) {
        console.error('No selected account to update pending state')
        return
      }

      const networksToUpdate = this.#main.activity.broadcastedButNotConfirmed
        .map((op) => op.chainId)
        .filter((chainId, index, self) => self.indexOf(chainId) === index)

      if (!networksToUpdate.length) this.accountStatePendingInterval.stop()

      await this.#main.accounts.updateAccountState(
        this.#main.selectedAccount.account.addr,
        'pending',
        networksToUpdate
      )

      const newestOpTimestamp = this.#main.activity.broadcastedButNotConfirmed.reduce(
        (newestTimestamp, accOp) => {
          return accOp.timestamp > newestTimestamp ? accOp.timestamp : newestTimestamp
        },
        0
      )
      const interval = getIntervalRefreshTime(ACCOUNT_STATE_PENDING_INTERVAL, newestOpTimestamp)
      this.accountStatePendingInterval.updateTimeout({ timeout: interval })
    }, ACCOUNT_STATE_PENDING_INTERVAL)

    this.accountsOpsStatusesInterval = createRecurringTimeout(async () => {
      const { newestOpTimestamp } = await this.#main.updateAccountsOpsStatuses()
      // Schedule the next update only when the previous one completes
      const interval = getIntervalRefreshTime(ACTIVITY_REFRESH_INTERVAL, newestOpTimestamp)
      this.accountsOpsStatusesInterval.updateTimeout({ timeout: interval })
    }, ACTIVITY_REFRESH_INTERVAL)

    /**
     * Update failed network states more often. If a network's first failed
     *  update is just now, retry in 8s. If it's a repeated failure, retry in 20s.
     */
    this.fastAccountStateReFetchTimeout = createRecurringTimeout(async () => {
      const failedChainIds = getNetworksWithFailedRPC({ providers: this.#main.providers.providers })
      if (!failedChainIds.length) this.fastAccountStateReFetchTimeout.stop()

      const retriedFastAccountStateReFetchForNetworks =
        this.#retriedFastAccountStateReFetchForNetworks

      // Delete the network ids that have been successfully re-fetched so the logic can be re-applied
      // if the RPC goes down again
      if (retriedFastAccountStateReFetchForNetworks.length) {
        retriedFastAccountStateReFetchForNetworks.forEach((chainId, index) => {
          if (!failedChainIds.includes(chainId)) {
            delete retriedFastAccountStateReFetchForNetworks[index]

            const network = this.#main.networks.networks.find(
              (n) => n.chainId.toString() === chainId
            )
            this.#main.updateSelectedAccountPortfolio({ networks: network ? [network] : undefined })
          }
        })
      }

      // Filter out the network ids that have already been retried
      const recentlyFailedNetworks = failedChainIds.filter(
        (id) => !this.#retriedFastAccountStateReFetchForNetworks.find((chainId) => chainId === id)
      )

      const updateTime = recentlyFailedNetworks.length ? 8000 : 20000

      await this.#main.accounts.updateAccountStates(
        this.#main.selectedAccount.account?.addr,
        'latest',
        failedChainIds.map((id) => BigInt(id))
      )
      // Add the network ids that have been retried to the list
      failedChainIds.forEach((id) => {
        if (retriedFastAccountStateReFetchForNetworks.includes(id)) return

        retriedFastAccountStateReFetchForNetworks.push(id)
      })

      if (!failedChainIds.length) this.fastAccountStateReFetchTimeout.stop()

      this.fastAccountStateReFetchTimeout.updateTimeout({ timeout: updateTime })
    }, 8000)

    this.#main.onUpdate(() => {
      if (this.#main.statuses.signAndBroadcastAccountOp === 'SUCCESS') {
        this.accountStatePendingInterval.start({ timeout: ACCOUNT_STATE_PENDING_INTERVAL / 2 })
        this.accountsOpsStatusesInterval.start()
      }
    }, 'continuous-update')

    this.#main.providers.onUpdate(() => {
      this.fastAccountStateReFetchTimeout.restart()
    }, 'continuous-update')

    this.#main.activity.onUpdate(() => {
      if (this.#main.activity.broadcastedButNotConfirmed.length) {
        this.accountsOpsStatusesInterval.start()
      } else {
        this.accountsOpsStatusesInterval.stop()
      }
    }, 'continuous-update')
  }
}
