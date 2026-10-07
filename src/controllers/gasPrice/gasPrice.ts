import { ErrorRef } from '../../interfaces/eventEmitter'
import { IFeatureFlagsController } from '../../interfaces/featureFlags'
import { Network } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import { BaseAccount } from '../../libs/account/BaseAccount'
import { decodeError } from '../../libs/errorDecoder'
import { ErrorType } from '../../libs/errorDecoder/types'
import { gasPriceToBundlerFormat, getGasPriceRecommendations } from '../../libs/gasPrice/gasPrice'
import { getAvailableBunlders } from '../../services/bundlers/getBundler'
import { GasSpeeds } from '../../services/bundlers/types'
import { EstimationController } from '../estimation/estimation'
import EventEmitter from '../eventEmitter/eventEmitter'

export class GasPriceController extends EventEmitter {
  #network: Network

  #provider: RPCProvider

  #baseAccount: BaseAccount

  #featureFlags: IFeatureFlagsController

  #getSignAccountOpState: () => {
    estimation: EstimationController
    readyToSign: boolean
    stopRefetching: boolean
  }

  /**
   * The gas prices for the account. When the account receives both collections
   * (see BaseAccount.getGasPriceFetchStrategy), these are the bundler ones,
   * falling back to the RPC ones if the bundler is not working
   */
  gasPrices?: GasSpeeds

  /**
   * The RPC gas prices. Set only when the account receives both collections
   * (see BaseAccount.getGasPriceFetchStrategy)
   */
  rpcGasPrices?: GasSpeeds

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
   * If the bundler estimation succeeds successfully, we don't want
   * to use the estimation from the gas price controller unless
   * explicitly called from the signAccountOp.
   * Accounts that receive both collections still fetch the RPC gas prices
   * (see BaseAccount.getGasPriceFetchStrategy)
   * */
  areGasPricesUsedFromBundlerEstimation: boolean = false

  constructor(
    network: Network,
    provider: RPCProvider,
    baseAccount: BaseAccount,
    getSignAccountOpState: () => {
      estimation: EstimationController
      readyToSign: boolean
      stopRefetching: boolean
    },
    featureFlags: IFeatureFlagsController
  ) {
    super()
    this.#network = network
    this.#provider = provider
    this.#baseAccount = baseAccount
    this.#getSignAccountOpState = getSignAccountOpState
    this.#featureFlags = featureFlags
  }

  setBaseAccount(baseAccount: BaseAccount) {
    this.#baseAccount = baseAccount
  }

  async fetch(emitLevelOnFailure: ErrorRef['level'] = 'silent') {
    const strategy = this.#baseAccount.getGasPriceFetchStrategy()

    // the bundler estimation supplies the bundler gas prices, so when the account
    // relies on a single collection, there's nothing left to fetch here
    if (this.areGasPricesUsedFromBundlerEstimation) return

    await this.#featureFlags.initialLoadPromise

    if (strategy === 'rpcWithBundlerFallback') {
      await this.#fetchRpcWithBundlerFallback(emitLevelOnFailure)
      return
    }

    // give priority to the bundler as it's faster and more accurate
    // we ask the bundler only when the estimation is not supported by the account
    // it is counter intuitive but the logic if the account supports the bundler
    // estimate, it would fetch the gas price from the bundler estimation itself,
    // therefore not being required here
    if (strategy === 'bundlerWithRpcFallback' && !this.#baseAccount.supportsBundlerEstimation()) {
      const bundlerGasPrices = await this.#fetchBundlerGasPrices()
      if (bundlerGasPrices) {
        this.gasPrices = bundlerGasPrices
        this.updatedAt = Date.now()

        this.emitUpdate()
        return
      }
    }

    // fallback to our gas price fetch if:
    // * all bundlers on the networks are not working or there are no bundlers
    // * we're doing a bundler estimate so we'd have a fallback option
    // * ERC-4337 is disabled
    // * the account relies on the RPC only (see BaseAccount.getGasPriceFetchStrategy)
    const rpcGasPrices = await this.#fetchRpcGasPrices(emitLevelOnFailure, 10000)
    if (rpcGasPrices) this.gasPrices = rpcGasPrices
    this.updatedAt = Date.now()

    this.emitUpdate()
  }

  /**
   * Fetches the RPC and the bundler collections separately, so that
   * signAccountOp could pick the correct one for each broadcast option
   */
  async #fetchRpcWithBundlerFallback(emitLevelOnFailure: ErrorRef['level']) {
    const rpcGasPrices = await this.#fetchRpcGasPrices(emitLevelOnFailure, 5000)

    // if there are rpcGasPrices, we save them and proceed. Bundler is the fallback
    if (rpcGasPrices) {
      this.rpcGasPrices = rpcGasPrices
      this.updatedAt = Date.now()
      this.emitUpdate()
      return
    }

    const bundlerGasPrices = await this.#fetchBundlerGasPrices()

    // if the bundler succeeds, we override both in this case
    if (bundlerGasPrices) {
      this.rpcGasPrices = bundlerGasPrices
      this.gasPrices = bundlerGasPrices
    }

    this.updatedAt = Date.now()

    this.emitUpdate()
  }

  /**
   * Calls all the available bundlers on the network and returns the gas prices
   * of the quickest one. Returns null if there are no bundlers or all of them fail
   */
  async #fetchBundlerGasPrices(): Promise<GasSpeeds | null> {
    const availableBundlers = this.#featureFlags.isFeatureEnabled('erc4337')
      ? getAvailableBunlders(this.#network)
      : []
    if (!availableBundlers.length) return null

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

    return bundlerGasPrices as GasSpeeds | null
  }

  async #fetchRpcGasPrices(
    emitLevelOnFailure: ErrorRef['level'],
    timeout: number
  ): Promise<GasSpeeds | null> {
    let timeoutId
    const gasPriceData = await Promise.race([
      getGasPriceRecommendations(this.#provider, this.#network, -1, () => {
        return !this.#getSignAccountOpState().stopRefetching
      }),
      // limit it to 10s so a hanging RPC doesn't block the gas price
      // refetch, handling it as any other RPC failure
      new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error('rpc gas price fetch fail, request too slow')),
          timeout
        )
      })
    ]).catch((e) => {
      const signAccountOpState = this.#getSignAccountOpState()
      // null because the estimation is destroyed with signAccountOp
      const estimation = signAccountOpState.estimation as EstimationController | null

      // if the gas price data has been fetched once successfully OR an estimation error
      // is currently being displayed, do not emit another error
      if (this.gasPrices || this.rpcGasPrices || !estimation || estimation.isRetryingFailure())
        return null

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
    clearTimeout(timeoutId)

    if (!gasPriceData || !gasPriceData.gasPrice) return null

    return gasPriceToBundlerFormat(gasPriceData.gasPrice)
  }

  destroy() {
    super.destroy()
  }
}
