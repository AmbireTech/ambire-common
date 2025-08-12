/* eslint-disable @typescript-eslint/no-floating-promises */
import {
  ACTIVE_EXTENSION_PORTFOLIO_UPDATE_INTERVAL,
  INACTIVE_EXTENSION_PORTFOLIO_UPDATE_INTERVAL
} from '../../consts/intervals'
import { IMainController } from '../../interfaces/main'
import EventEmitter from '../eventEmitter/eventEmitter'

export class ContinuousUpdatesController extends EventEmitter {
  #main: IMainController

  #updatePortfolioInterval?: NodeJS.Timeout

  #portfolioLastUpdatedByIntervalAt: number = Date.now()

  constructor({ main }: { main: IMainController }) {
    super()

    this.#main = main

    this.#initPortfolioContinuousUpdate() // init

    this.#main.windowManager.event.on('addView', this.#initPortfolioContinuousUpdate.bind(this))
    this.#main.windowManager.event.on('removeView', this.#initPortfolioContinuousUpdate.bind(this))
  }

  async #initPortfolioContinuousUpdate() {
    if (this.#updatePortfolioInterval) clearTimeout(this.#updatePortfolioInterval)

    const isExtensionActive = this.#main.windowManager.views.length > 0
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
}
