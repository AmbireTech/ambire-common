import { ErrorRef } from '../../interfaces/eventEmitter'
import { IFeatureFlagsController } from '../../interfaces/featureFlags'
import { Network } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import { BaseAccount } from '../../libs/account/BaseAccount'
import { decodeError } from '../../libs/errorDecoder'
import { ErrorType } from '../../libs/errorDecoder/types'
import {
  GasRecommendation,
  gasPriceToBundlerFormat,
  getGasPriceRecommendations
} from '../../libs/gasPrice/gasPrice'
import { getAvailableBunlders } from '../../services/bundlers/getBundler'
import { GasSpeeds } from '../../services/bundlers/types'
import { EstimationController } from '../estimation/estimation'
import EventEmitter from '../eventEmitter/eventEmitter'

export class GasPriceController extends EventEmitter {
  #network: Network

  #provider: RPCProvider

  #baseAccount: BaseAccount

  #featureFlags: IFeatureFlagsController

  /**
   * The RPC gas price request that is still in flight. The timeout in #fetchRpcGasPrices
   * only stops waiting for it - the request itself keeps going until the provider gives up
   * (5 min by default). Later fetches wait for it instead of piling up new requests
   */
  #pendingRpcGasPriceRequest: Promise<{ gasPrice: GasRecommendation[] }> | null = null

  #getSignAccountOpState: () => {
    estimation: EstimationController
    readyToSign: boolean
    stopRefetching: boolean
  }

  /**
   * The gas prices for the account. With the `rpcWithBundlerFallback` strategy
   * (see BaseAccount.getGasPriceFetchStrategy), these mirror rpcGasPrices and
   * signAccountOp uses them only while there's no bundler estimation to take
   * the bundler gas prices from
   */
  gasPrices?: GasSpeeds

  /**
   * The gas prices for broadcasts outside the bundler. Set only with the
   * `rpcWithBundlerFallback` strategy (see BaseAccount.getGasPriceFetchStrategy).
   * Despite the name, they hold the bundler gas prices if the RPC has failed and
   * the bundler fallback has succeeded, so those broadcasts could still proceed
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
   * Accounts with the `rpcWithBundlerFallback` strategy still fetch their RPC
   * gas prices (see BaseAccount.getGasPriceFetchStrategy)
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
    // the strategy depends on the erc4337 feature flag, so wait for the flags to load
    await this.#featureFlags.initialLoadPromise

    const strategy = this.#baseAccount.getGasPriceFetchStrategy(
      this.#featureFlags.isFeatureEnabled('erc4337')
    )

    // the bundler estimation supplies the bundler gas prices, so when the account
    // relies on a single collection, there's nothing left to fetch here.
    // With rpcWithBundlerFallback, the RPC gas prices are still needed for the
    // broadcasts outside the bundler
    if (this.areGasPricesUsedFromBundlerEstimation && strategy !== 'rpcWithBundlerFallback') return

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
    const rpcGasPrices = await this.#fetchRpcGasPrices(10000)
    if (rpcGasPrices instanceof Error) this.#emitFetchError(rpcGasPrices, emitLevelOnFailure)
    else this.gasPrices = rpcGasPrices
    this.updatedAt = Date.now()

    this.emitUpdate()
  }

  /**
   * Fetches the RPC gas prices, falling back to the bundler ones if the RPC fails.
   * Bundler broadcasts don't use these as signAccountOp takes their gas prices
   * from the bundler estimation (see BaseAccount.shouldUseRpcGasPrices)
   */
  async #fetchRpcWithBundlerFallback(emitLevelOnFailure: ErrorRef['level']) {
    const rpcGasPrices = await this.#fetchRpcGasPrices(5000)

    // if there are rpcGasPrices, we save them and proceed. Bundler is the fallback
    if (!(rpcGasPrices instanceof Error)) {
      this.rpcGasPrices = rpcGasPrices
      // signAccountOp needs gasPrices when the estimation comes without bundler
      // gas prices (ERC-4337 transition, bundler failure), otherwise it never
      // calculates the fees. When it does have them, it ignores these
      this.gasPrices = rpcGasPrices
      this.updatedAt = Date.now()
      this.emitUpdate()
      return
    }

    // the RPC fetch was aborted because signAccountOp stopped refetching,
    // so there's no need for a fallback or an error
    if (this.#getSignAccountOpState().stopRefetching) return

    const bundlerGasPrices = await this.#fetchBundlerGasPrices()

    // if the bundler succeeds, we override both in this case. rpcGasPrices then
    // hold the bundler gas prices so broadcasts outside the bundler could still
    // proceed, even though the bundler ones may be higher than the RPC would return
    if (bundlerGasPrices) {
      this.rpcGasPrices = bundlerGasPrices
      this.gasPrices = bundlerGasPrices
    } else {
      // show the RPC failure only when the bundler fallback has failed as well,
      // otherwise the user would see an error while the fees load correctly
      this.#emitFetchError(rpcGasPrices, emitLevelOnFailure)
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

  /**
   * Fetches the gas prices from the RPC. Doesn't emit errors on failure,
   * returning them instead, so each caller could decide whether a fallback
   * is available before showing an error to the user
   */
  async #fetchRpcGasPrices(timeout: number): Promise<GasSpeeds | Error> {
    if (!this.#pendingRpcGasPriceRequest) {
      this.#pendingRpcGasPriceRequest = getGasPriceRecommendations(
        this.#provider,
        this.#network,
        -1,
        () => {
          return !this.#getSignAccountOpState().stopRefetching
        }
      ).finally(() => {
        this.#pendingRpcGasPriceRequest = null
      })
    }

    let timeoutId
    const gasPriceData = await Promise.race([
      this.#pendingRpcGasPriceRequest,
      // limit it by the passed timeout so a hanging RPC doesn't block the
      // gas price refetch, handling it as any other RPC failure. The request
      // stays pending and the next fetch races its own timeout against it
      new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error('rpc gas price fetch fail, request too slow')),
          timeout
        )
      })
    ]).catch((e) => (e instanceof Error ? e : new Error(String(e))))
    clearTimeout(timeoutId)

    if (gasPriceData instanceof Error) return gasPriceData
    if (!gasPriceData.gasPrice) return new Error('rpc gas price fetch returned no gas prices')

    return gasPriceToBundlerFormat(gasPriceData.gasPrice)
  }

  #emitFetchError(e: Error, emitLevelOnFailure: ErrorRef['level']) {
    const signAccountOpState = this.#getSignAccountOpState()
    // null because the estimation is destroyed with signAccountOp
    const estimation = signAccountOpState.estimation as EstimationController | null

    // if the gas price data has been fetched once successfully OR an estimation error
    // is currently being displayed, do not emit another error
    if (this.gasPrices || this.rpcGasPrices || !estimation || estimation.isRetryingFailure()) return

    const { type } = decodeError(e)

    let message = "We couldn't retrieve the latest network fee information."

    if (type === ErrorType.ConnectivityError) {
      message = 'Network connection issue prevented us from retrieving the current network fee.'
    }

    this.emitError({
      level: emitLevelOnFailure,
      message,
      error: new Error(`Failed to fetch gas price on ${this.#network.name}: ${e.message}`)
    })
  }

  destroy() {
    super.destroy()
  }
}
