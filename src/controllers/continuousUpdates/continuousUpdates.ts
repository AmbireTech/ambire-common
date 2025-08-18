import {
  ACCOUNT_STATE_PENDING_INTERVAL,
  ACCOUNT_STATE_STAND_BY_INTERVAL,
  ACTIVE_EXTENSION_PORTFOLIO_UPDATE_INTERVAL,
  ACTIVITY_REFRESH_INTERVAL,
  INACTIVE_EXTENSION_PORTFOLIO_UPDATE_INTERVAL
} from '../../consts/intervals'
import { IMainController } from '../../interfaces/main'
import { getNetworksWithFailedRPC } from '../../libs/networks/networks'
import EventEmitter from '../eventEmitter/eventEmitter'

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
export class ContinuousUpdatesController extends EventEmitter {
  #main: IMainController

  #updatePortfolioInterval?: NodeJS.Timeout

  #portfolioLastUpdatedByIntervalAt: number = Date.now()

  #accountsOpsStatusesInterval?: NodeJS.Timeout

  #accountStateLatestInterval?: NodeJS.Timeout

  #accountStatePendingInterval?: NodeJS.Timeout

  #fastAccountStateReFetchTimeout?: NodeJS.Timeout

  #retriedFastAccountStateReFetchForNetworks: string[] = []

  constructor({ main }: { main: IMainController }) {
    super()

    this.#main = main

    this.#setPortfolioContinuousUpdate() // init
    this.#setLatestAccountStateContinuousUpdate(ACCOUNT_STATE_STAND_BY_INTERVAL) // init

    this.#main.ui.uiEvent.on('addView', () => {
      this.#setPortfolioContinuousUpdate.bind(this)
    })
    this.#main.ui.uiEvent.on('removeView', this.#setPortfolioContinuousUpdate.bind(this))

    this.#main.onUpdate(() => {
      if (this.#main.statuses.signAndBroadcastAccountOp === 'SUCCESS') {
        this.#setPendingAccountStateContinuousUpdate(ACCOUNT_STATE_PENDING_INTERVAL)
        this.#setAccountsOpsStatusesContinuousUpdate(ACTIVITY_REFRESH_INTERVAL)
      }
    }, 'continuous-update')

    this.#main.providers.onUpdate(() => {
      this.#setFrequentLatestAccountStateContinuousUpdate()
    }, 'continuous-update')

    this.#main.activity.onUpdate(() => {
      if (this.#main.activity.broadcastedButNotConfirmed.length) {
        if (!this.#accountsOpsStatusesInterval) {
          this.#setAccountsOpsStatusesContinuousUpdate(ACTIVITY_REFRESH_INTERVAL)
        }
      } else {
        !!this.#accountsOpsStatusesInterval && clearTimeout(this.#accountsOpsStatusesInterval)
        this.#accountsOpsStatusesInterval = undefined
      }
    }, 'continuous-update')
  }

  async #setPortfolioContinuousUpdate() {
    if (this.#updatePortfolioInterval) clearTimeout(this.#updatePortfolioInterval)

    const isExtensionActive = this.#main.ui.views.length > 0
    const updateInterval = isExtensionActive
      ? ACTIVE_EXTENSION_PORTFOLIO_UPDATE_INTERVAL
      : INACTIVE_EXTENSION_PORTFOLIO_UPDATE_INTERVAL

    const updatePortfolio = async () => {
      if (this.#main.activity.broadcastedButNotConfirmed.length) {
        this.#updatePortfolioInterval = setTimeout(updatePortfolio, updateInterval)
        return
      }

      await this.#main.updateSelectedAccountPortfolio()

      this.#portfolioLastUpdatedByIntervalAt = Date.now()
      this.#updatePortfolioInterval = setTimeout(updatePortfolio, updateInterval)
    }

    const isAtLeastOnePortfolioUpdateMissed =
      Date.now() - this.#portfolioLastUpdatedByIntervalAt >
      INACTIVE_EXTENSION_PORTFOLIO_UPDATE_INTERVAL

    if (isAtLeastOnePortfolioUpdateMissed) {
      clearTimeout(this.#updatePortfolioInterval)
      await updatePortfolio()
    } else {
      this.#updatePortfolioInterval = setTimeout(updatePortfolio, updateInterval)
    }
  }

  #setAccountsOpsStatusesContinuousUpdate(updateInterval: number) {
    if (this.#accountsOpsStatusesInterval) clearTimeout(this.#accountsOpsStatusesInterval)

    const updateStatuses = async () => {
      const { newestOpTimestamp } = await this.#main.updateAccountsOpsStatuses()

      // Schedule the next update only when the previous one completes
      const interval = getIntervalRefreshTime(updateInterval, newestOpTimestamp)
      this.#accountsOpsStatusesInterval = setTimeout(updateStatuses, interval)
    }

    this.#accountsOpsStatusesInterval = setTimeout(updateStatuses, updateInterval)
  }

  /**
   * Updates the account state for the selected account. Doesn't update the state for networks with failed RPC as this is handled by a different interval.
   */
  async #setLatestAccountStateContinuousUpdate(intervalLength: number) {
    if (this.#accountStateLatestInterval) clearTimeout(this.#accountStateLatestInterval)

    const updateAccountState = async () => {
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
      this.#accountStateLatestInterval = setTimeout(updateAccountState, intervalLength)
    }

    // Start the first update
    this.#accountStateLatestInterval = setTimeout(updateAccountState, intervalLength)
  }

  async #setPendingAccountStateContinuousUpdate(intervalLength: number) {
    if (!this.#main.selectedAccount.account) {
      console.error('No selected account to update pending state')
      return
    }

    if (this.#accountStatePendingInterval) clearTimeout(this.#accountStatePendingInterval)

    const networksToUpdate = this.#main.activity.broadcastedButNotConfirmed
      .map((op) => op.chainId)
      .filter((chainId, index, self) => self.indexOf(chainId) === index)
    await this.#main.accounts.updateAccountState(
      this.#main.selectedAccount.account.addr,
      'pending',
      networksToUpdate
    )

    const updateAccountState = async (chainIds: bigint[]) => {
      if (!this.#main.selectedAccount.account) {
        console.error('No selected account to update pending state')
        return
      }

      await this.#main.accounts.updateAccountState(
        this.#main.selectedAccount.account.addr,
        'pending',
        chainIds
      )

      // if there are no more broadcastedButNotConfirmed ops for the network, remove the timeout
      const networks = this.#main.activity.broadcastedButNotConfirmed
        .map((op) => op.chainId)
        .filter((chainId, index, self) => self.indexOf(chainId) === index)
      if (!networks.length) {
        clearTimeout(this.#accountStatePendingInterval)
      } else {
        // Schedule the next update
        const newestOpTimestamp = this.#main.activity.broadcastedButNotConfirmed.reduce(
          (newestTimestamp, accOp) => {
            return accOp.timestamp > newestTimestamp ? accOp.timestamp : newestTimestamp
          },
          0
        )
        const interval = getIntervalRefreshTime(intervalLength, newestOpTimestamp)
        this.#accountStatePendingInterval = setTimeout(() => updateAccountState(networks), interval)
      }
    }

    // Start the first update
    this.#accountStatePendingInterval = setTimeout(
      () => updateAccountState(networksToUpdate),
      intervalLength / 2
    )
  }

  /**
   * Update failed network states more often. If a network's first failed
   *  update is just now, retry in 8s. If it's a repeated failure, retry in 20s.
   */
  #setFrequentLatestAccountStateContinuousUpdate() {
    const isExtensionActive = this.#main.ui.views.length > 0

    if (this.#fastAccountStateReFetchTimeout) clearTimeout(this.#fastAccountStateReFetchTimeout)

    // If there are no open ports the account state will be updated
    // automatically when the extension is opened.
    if (!isExtensionActive) return

    const updateAccountState = async () => {
      const failedChainIds = getNetworksWithFailedRPC({
        providers: this.#main.providers.providers
      })

      if (!failedChainIds.length) return

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

      if (!failedChainIds.length) return

      this.#fastAccountStateReFetchTimeout = setTimeout(updateAccountState, updateTime)
    }

    this.#fastAccountStateReFetchTimeout = setTimeout(updateAccountState, 8000)
  }
}
