/* eslint-disable @typescript-eslint/no-floating-promises */
import { BUNDLER } from '../../consts/bundlers'
import { Network } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import { decodeError } from '../../libs/errorDecoder'
import { ErrorType } from '../../libs/errorDecoder/types'
import { GasRecommendation, getGasPriceRecommendations } from '../../libs/gasPrice/gasPrice'
import { BundlerSwitcher } from '../../services/bundlers/bundlerSwitcher'
import { GasSpeeds } from '../../services/bundlers/types'
import wait from '../../utils/wait'
import { EstimationController } from '../estimation/estimation'
import EventEmitter, { ErrorRef } from '../eventEmitter/eventEmitter'

export class GasPriceController extends EventEmitter {
  #network: Network

  #provider: RPCProvider

  #bundlerSwitcher: BundlerSwitcher

  #getSignAccountOpState: Function

  // network => GasRecommendation[]
  gasPrices: { [key: string]: GasRecommendation[] } = {}

  // network => BundlerGasPrice
  bundlerGasPrices: { [key: string]: { speeds: GasSpeeds; bundler: BUNDLER } } = {}

  blockGasLimit: bigint | undefined = undefined

  stopRefetching: boolean = false

  constructor(
    network: Network,
    provider: RPCProvider,
    bundlerSwitcher: BundlerSwitcher,
    getSignAccountOpState: Function
  ) {
    super()
    this.#network = network
    this.#provider = provider
    this.#bundlerSwitcher = bundlerSwitcher
    this.#getSignAccountOpState = getSignAccountOpState
  }

  async refetch() {
    await wait(12000)
    if (this.stopRefetching) return
    const signAccountOpState = this.#getSignAccountOpState()
    if (!signAccountOpState.isSignRequestStillActive()) return
    this.fetch('major')
  }

  async fetch(emitLevelOnFailure: ErrorRef['level'] = 'silent') {
    const bundler = this.#bundlerSwitcher.getBundler()

    const [gasPriceData, bundlerGas] = await Promise.all([
      getGasPriceRecommendations(this.#provider, this.#network).catch((e) => {
        const signAccountOpState = this.#getSignAccountOpState()
        const estimation = signAccountOpState.estimation as EstimationController

        // if the gas price data has been fetched once successfully OR an estimation error
        // is currently being displayed, do not emit another error
        if (this.gasPrices[this.#network.chainId.toString()] || estimation.estimationRetryError)
          return

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
      }),
      bundler
        // no error emits here as most of the time estimation/signing
        // will work even if this fails
        .fetchGasPrices(this.#network, () => {})
        .catch((e) => {
          this.emitError({
            level: 'silent',
            message: "Failed to fetch the bundler's gas price",
            error: e
          })
        })
    ])

    if (gasPriceData) {
      if (gasPriceData.gasPrice)
        this.gasPrices[this.#network.chainId.toString()] = gasPriceData.gasPrice
      this.blockGasLimit = gasPriceData.blockGasLimit
    }
    if (bundlerGas)
      this.bundlerGasPrices[this.#network.chainId.toString()] = {
        speeds: bundlerGas,
        bundler: bundler.getName()
      }

    this.emitUpdate()

    this.refetch()
  }

  reset() {
    this.stopRefetching = true
  }
}
