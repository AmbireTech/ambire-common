/* eslint-disable @typescript-eslint/no-floating-promises */
import { GAS_PRICE_UPDATE_INTERVAL } from '../../consts/intervals'
import { ErrorRef } from '../../interfaces/eventEmitter'
import { Network } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import { BaseAccount } from '../../libs/account/BaseAccount'
import { decodeError } from '../../libs/errorDecoder'
import { ErrorType } from '../../libs/errorDecoder/types'
import { gasPriceToBundlerFormat, getGasPriceRecommendations } from '../../libs/gasPrice/gasPrice'
import { getAvailableBunlders } from '../../services/bundlers/getBundler'
import { GasSpeeds } from '../../services/bundlers/types'
import wait from '../../utils/wait'
import { EstimationController } from '../estimation/estimation'
import { EstimationStatus } from '../estimation/types'
import EventEmitter from '../eventEmitter/eventEmitter'

export class GasPriceController extends EventEmitter {
  #network: Network

  #provider: RPCProvider

  #baseAccount: BaseAccount

  #getSignAccountOpState: () => {
    estimation: EstimationController
    readyToSign: boolean
  }

  gasPrices?: GasSpeeds

  /**
   * Timestamp of the last successful gas price update
   * TODO: Merge them into a single structure
   * {
   *  gasPrices: GasSpeeds
   *  updatedAt: number
   * }
   */
  updatedAt?: number

  /**
   * When the signAccountOp is not active we want to avoid
   * refetching the gas prices.
   */
  stopRefetching: boolean = false

  /**
   * If the bundler estimation succeeds successfully, we don't want
   * to use the estimation from the gas price controller unless
   * explicitly called from the signAccountOp.
   * */
  areGasPricesUsedFromBundlerEstimation: boolean = false

  constructor(
    network: Network,
    provider: RPCProvider,
    baseAccount: BaseAccount,
    getSignAccountOpState: () => {
      estimation: EstimationController
      readyToSign: boolean
    }
  ) {
    super()
    this.#network = network
    this.#provider = provider
    this.#baseAccount = baseAccount
    this.#getSignAccountOpState = getSignAccountOpState
  }

  // @TODO: Refactor this to use recurringTimeout in order
  // to safeguard it from piling up multiple concurrent calls
  async refetch() {
    console.log('Debug: GasPriceController refetching gas prices in 12s...')
    await wait(GAS_PRICE_UPDATE_INTERVAL)
    if (this.stopRefetching) return
    const signAccountOpState = this.#getSignAccountOpState()

    // no need to update the gas prices if the estimation status is Error
    // try again after 12s
    if (signAccountOpState.estimation.status === EstimationStatus.Error) {
      this.refetch()
      return
    }

    this.fetch('major')
  }

  async fetch(emitLevelOnFailure: ErrorRef['level'] = 'silent') {
    console.log('Debug: GasPriceController fetching gas prices...')
    // give priority to the bundler as it's faster and more accurate
    // we ask the bundler only when the estimation is not supported by the account
    // it is counter intuitive but the logic if the account supports the bundler
    // estimate, it would fetch the gas price from the bundler estimation itself,
    // therefore not being required here
    const availableBundlers = getAvailableBunlders(this.#network)
    if (availableBundlers.length && !this.#baseAccount.supportsBundlerEstimation()) {
      let timeoutId
      const bundlerGasPrices = await Promise.race([
        // Promise.any because we want the first success, ignoring errors
        // basically, call all the available bundlers on the network for
        // gas prices and take the results from the quickest one.
        // Also, limit it to 6s - if slower than that, we should fallback
        // to our own mechanism
        Promise.any(availableBundlers.map((bundler) => bundler.fetchGasPrices(this.#network))),
        new Promise((_resolve, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error('bundler gas price fetch fail, request too slow')),
            6000
          )
        })
      ]).catch(() => {
        console.error('Failed fetching bundler gas prices from the gasPrice lib')
        return null
      })
      clearTimeout(timeoutId)
      if (bundlerGasPrices) {
        this.gasPrices = bundlerGasPrices as GasSpeeds
        this.updatedAt = Date.now()

        this.emitUpdate()
        this.refetch()
        return
      }
    }

    // fallback to our gas price fetch if:
    // * all bundlers on the networks are not working or there are no bundlers
    // * we're doing a bundler estimate so we'd have a fallback option
    const gasPriceData = await getGasPriceRecommendations(this.#provider, this.#network, -1, () => {
      return !this.stopRefetching
    }).catch((e) => {
      const signAccountOpState = this.#getSignAccountOpState()
      // null because the estimation is destroyed with signAccountOp
      const estimation = signAccountOpState.estimation as EstimationController | null

      // if the gas price data has been fetched once successfully OR an estimation error
      // is currently being displayed, do not emit another error
      if (this.gasPrices || !estimation || estimation.estimationRetryError) return

      const { type } = decodeError(e)

      let message = "We couldn't retrieve the latest network fee information."

      if (type === ErrorType.ConnectivityError) {
        message = 'Network connection issue prevented us from retrieving the current network fee.'
      }

      this.emitError({
        level: emitLevelOnFailure,
        message,
        error: new Error(`Failed to fetch gas price on ${this.#network.name}: ${e?.message}`)
      })
      return null
    })

    if (gasPriceData && gasPriceData.gasPrice)
      this.gasPrices = gasPriceToBundlerFormat(gasPriceData.gasPrice)
    this.updatedAt = Date.now()

    this.emitUpdate()
    this.refetch()
  }

  destroy() {
    super.destroy()
    this.pauseRefetching()
  }

  pauseRefetching(areGasPricesUsedFromBundlerEstimation?: boolean) {
    this.stopRefetching = true

    if (areGasPricesUsedFromBundlerEstimation) this.areGasPricesUsedFromBundlerEstimation = true
  }

  /**
   * Resumes the refetching of gas prices if it was paused.
   * Does nothing if there is a successful bundler estimation as the gas prices
   * are used directly from there.
   */
  resumeRefetching(
    areGasPricesUsedFromBundlerEstimation = this.areGasPricesUsedFromBundlerEstimation
  ) {
    if (!this.stopRefetching || areGasPricesUsedFromBundlerEstimation) return

    this.areGasPricesUsedFromBundlerEstimation = false
    this.stopRefetching = false

    if (!this.updatedAt || Date.now() - this.updatedAt > GAS_PRICE_UPDATE_INTERVAL) {
      this.fetch()
    }
  }
}
