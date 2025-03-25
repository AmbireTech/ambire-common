/* eslint-disable @typescript-eslint/no-floating-promises */
import { BUNDLER } from '../../consts/bundlers'
import { Network } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import { decodeError } from '../../libs/errorDecoder'
import { ErrorType } from '../../libs/errorDecoder/types'
import { GasRecommendation, getGasPriceRecommendations } from '../../libs/gasPrice/gasPrice'
import { BundlerSwitcher } from '../../services/bundlers/bundlerSwitcher'
import { GasSpeeds } from '../../services/bundlers/types'
import { createRecurringTimeout } from '../../utils/timeout'
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

  gasPriceTimeout?: { start: any; stop: any }

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

  async fetch(emitLevelOnFailure: ErrorRef['level'] = 'silent') {
    console.log('FETCHING GAS PRICE')

    const bundler = this.#bundlerSwitcher.getBundler()

    const [gasPriceData, bundlerGas] = await Promise.all([
      getGasPriceRecommendations(this.#provider, this.#network).catch((e) => {
        const signAccountOpState = this.#getSignAccountOpState()
        const estimation = signAccountOpState.estimation as EstimationController
        const readyToSign = signAccountOpState.readyToSign as boolean

        // Don't display additional errors if the estimation hasn't initially loaded
        // or there is an estimation error
        if (!estimation.isLoadingOrFailed() || estimation.estimationRetryError) return null

        const { type } = decodeError(e)

        let message = `We couldn't retrieve the latest network fee information.${
          // Display this part of the message only if the user can broadcast.
          readyToSign
            ? ' If you experience issues broadcasting please select a higher fee speed.'
            : ''
        }`

        if (type === ErrorType.ConnectivityError) {
          message = 'Network connection issue prevented us from retrieving the current network fee.'
        }

        this.emitError({
          level: emitLevelOnFailure,
          message,
          error: new Error(`Failed to fetch gas price on ${this.#network.id}: ${e?.message}`)
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
      if (gasPriceData.gasPrice) this.gasPrices[this.#network.id] = gasPriceData.gasPrice
      this.blockGasLimit = gasPriceData.blockGasLimit
    }
    if (bundlerGas)
      this.bundlerGasPrices[this.#network.id] = { speeds: bundlerGas, bundler: bundler.getName() }

    this.emitUpdate()

    if (!this.gasPriceTimeout)
      this.gasPriceTimeout = createRecurringTimeout(() => this.fetch('major'), 12000)
    this.gasPriceTimeout.stop()
    this.gasPriceTimeout.start()
  }

  reset() {
    if (this.gasPriceTimeout) this.gasPriceTimeout.stop()
  }
}
