/* eslint-disable class-methods-use-this */
import ErrorHumanizerError from '../../classes/ErrorHumanizerError'
import { IAccountsController } from '../../interfaces/account'
import { IActivityController } from '../../interfaces/activity'
import { ErrorRef } from '../../interfaces/eventEmitter'
import { IKeystoreController } from '../../interfaces/keystore'
import { INetworksController } from '../../interfaces/network'
import { IPortfolioController } from '../../interfaces/portfolio'
import { RPCProvider } from '../../interfaces/provider'
import { SignAccountOpError, Warning } from '../../interfaces/signAccountOp'
import { BaseAccount } from '../../libs/account/BaseAccount'
import { getBaseAccount } from '../../libs/account/getBaseAccount'
import { AccountOp, AccountOpWithId } from '../../libs/accountOp/accountOp'
import { getEstimation, getEstimationSummary } from '../../libs/estimate/estimate'
import { FeePaymentOption, FullEstimationSummary } from '../../libs/estimate/interfaces'
import { isPortfolioGasTankResult } from '../../libs/portfolio/helpers'
import { BundlerSwitcher } from '../../services/bundlers/bundlerSwitcher'
import { getIsViewOnly } from '../../utils/accounts'
import EventEmitter from '../eventEmitter/eventEmitter'
import { EstimationStatus } from './types'

export class EstimationController extends EventEmitter {
  #keystore: IKeystoreController

  #accounts: IAccountsController

  #networks: INetworksController

  #provider: RPCProvider

  #portfolio: IPortfolioController

  status: EstimationStatus = EstimationStatus.Initial

  estimation: FullEstimationSummary | null = null

  error: Error | null = null

  /**
   * a boolean to understand if the estimation has been performed
   * at least one indicating clearly that all other are re-estimates
   */
  hasEstimated: boolean = false

  estimationRetryError: ErrorRef | null = null

  availableFeeOptions: FeePaymentOption[] = []

  #bundlerSwitcher: BundlerSwitcher

  #notFatalBundlerError?: Error

  #activity: IActivityController

  /**
   * Used to prevent slow estimations for a past accountOp overwriting
   * the latest estimation results
   */
  private lastAccountOpId: string | null = null

  constructor(
    keystore: IKeystoreController,
    accounts: IAccountsController,
    networks: INetworksController,
    provider: RPCProvider,
    portfolio: IPortfolioController,
    bundlerSwitcher: BundlerSwitcher,
    activity: IActivityController
  ) {
    super()
    this.#keystore = keystore
    this.#accounts = accounts
    this.#networks = networks
    this.#provider = provider
    this.#portfolio = portfolio
    this.#bundlerSwitcher = bundlerSwitcher
    this.#activity = activity
  }

  #getAvailableFeeOptions(baseAcc: BaseAccount, op: AccountOp): FeePaymentOption[] {
    const estimation = this.estimation as FullEstimationSummary

    return baseAcc.getAvailableFeeOptions(
      estimation,
      // eslint-disable-next-line no-nested-ternary
      estimation.ambireEstimation
        ? estimation.ambireEstimation.feePaymentOptions
        : estimation.providerEstimation
          ? estimation.providerEstimation.feePaymentOptions
          : [],
      op
    )
  }

  async estimate(op: AccountOpWithId) {
    this.status = EstimationStatus.Loading
    this.emitUpdate()

    const account = this.#accounts.accounts.find((acc) => acc.addr === op.accountAddr)!
    const network = this.#networks.networks.find((net) => net.chainId === op.chainId)!
    const accountState = await this.#accounts.getOrFetchAccountOnChainState(
      op.accountAddr,
      op.chainId
    )
    if (!accountState) {
      this.error = new Error(
        'During the preparation step, required transaction information was found missing (account state). Please try again later or contact support.'
      )
      this.status = EstimationStatus.Error
      this.hasEstimated = true
      this.emitUpdate()
      return
    }

    const baseAcc = getBaseAccount(account, accountState, network)

    // Take the fee tokens from two places: the user's tokens and his gasTank
    // The gasTank tokens participate on each network as they belong everywhere
    // NOTE: at some point we should check all the "?" signs below and if
    // an error pops out, we should notify the user about it
    let networkFeeTokens =
      this.#portfolio.getAccountPortfolioState(op.accountAddr)?.[op.chainId.toString()]?.result
        ?.feeTokens ?? []

    // This could happen only in a race when a NOT currently selected account is
    // requested, switched to and immediately fired a txn request for. In that situation,
    // the portfolio would not be fetched and the estimation would be fired without tokens,
    // resulting in a "nothing to pay the fee with" error which is absolutely wrong
    if (networkFeeTokens.length === 0) {
      await this.#portfolio.updateSelectedAccount(op.accountAddr, [network])
      networkFeeTokens =
        this.#portfolio.getAccountPortfolioState(op.accountAddr)?.[op.chainId.toString()]?.result
          ?.feeTokens ?? []
    }

    const gasTankResult = this.#portfolio.getAccountPortfolioState(op.accountAddr)?.gasTank?.result
    const gasTankFeeTokens = isPortfolioGasTankResult(gasTankResult)
      ? gasTankResult.gasTankTokens
      : []
    const feeTokens =
      [...networkFeeTokens, ...gasTankFeeTokens].filter((t) => t.flags.isFeeToken) || []

    // Here, we list EOA accounts for which you can also obtain an estimation of the AccountOp payment.
    // In the case of operating with a smart account (an account with creation code), all other EOAs can pay the fee.
    //
    // If the current account is an EOA, only this account can pay the fee,
    // and there's no need for checking other EOA accounts native balances.
    // This is already handled and estimated as a fee option in the estimate library, which is why we pass an empty array here.
    //
    // we're excluding the view only accounts from the natives to check
    // in all cases EXCEPT the case where we're making an estimation for
    // the view only account itself. In all other, view only accounts options
    // should not be present as the user cannot pay the fee with them (no key)
    const nativeToCheck = baseAcc.canBroadcastByOtherEOA()
      ? this.#accounts.accounts
          .filter(
            (acc) =>
              !acc.creation &&
              !acc.safeCreation &&
              (acc.addr === op.accountAddr ||
                !getIsViewOnly(this.#keystore.keys, acc.associatedKeys))
          )
          .map((acc) => acc.addr)
      : []

    this.lastAccountOpId = op.id

    const estimation = await getEstimation(
      baseAcc,
      accountState,
      op,
      network,
      this.#provider,
      feeTokens,
      nativeToCheck,
      this.#bundlerSwitcher,
      (this.#activity.broadcastedButNotConfirmed[account.addr] || []).find(
        (accOp) => accOp.chainId === network.chainId && !!accOp.asUserOperation
      )
    ).catch((e) => {
      console.error(e)
      return e
    })

    // Done to prevent race conditions
    if (op.id !== this.lastAccountOpId) {
      const error = new Error(
        `Estimation race condition prevented. Op id: ${op.id}. Expected: ${this.lastAccountOpId}`
      )

      this.emitError({
        message: 'Estimation race condition prevented',
        error,
        level: 'silent'
      })
      return
    }

    const isSuccess = !(estimation instanceof Error) && !estimation.criticalError
    if (isSuccess) {
      this.estimation = getEstimationSummary(estimation)
      this.error = null
      this.status = EstimationStatus.Success
      this.estimationRetryError = null
      this.availableFeeOptions = this.#getAvailableFeeOptions(baseAcc, op)
      this.#notFatalBundlerError =
        estimation.bundler instanceof Error ? estimation.bundler : undefined
    } else {
      this.estimation = null
      this.error = estimation instanceof Error ? estimation : estimation.criticalError
      this.status = EstimationStatus.Error
      this.availableFeeOptions = []
    }

    // estimation.flags.hasNonceDiscrepancy is a signal from the estimation
    // that the account state is not the latest and needs to be updated
    if (
      this.estimation &&
      (this.estimation.flags.hasNonceDiscrepancy || this.estimation.flags.has4337NonceDiscrepancy)
    ) {
      // continue on error here as the flags are more like app helpers
      this.#accounts
        .updateAccountState(op.accountAddr, 'pending', [op.chainId])
        // eslint-disable-next-line no-console
        .catch((e) => console.error(e))
    }

    this.hasEstimated = true
    this.emitUpdate()
  }

  /**
   * it's initialized if it has estimated at least once
   */
  isInitialized() {
    return this.hasEstimated
  }

  /**
   * has it estimated at least once without a failure
   */
  isLoadingOrFailed(): boolean {
    return this.status === EstimationStatus.Loading || this.error instanceof Error
  }

  calculateWarnings() {
    const warnings: Warning[] = []

    if (this.estimationRetryError && this.status === EstimationStatus.Success) {
      warnings.push({
        id: 'estimation-retry',
        title: this.estimationRetryError.message,
        text: 'You can proceed, but fee estimation is outdated - consider waiting for an updated estimation for a more optimal fee.'
      })
    }

    if (this.#notFatalBundlerError?.cause === '4337_ESTIMATION') {
      warnings.push({
        id: 'bundler-failure',
        title:
          'You can proceed safely, but fee payment options are limited due to temporary provider issues'
      })
    }

    if (this.#notFatalBundlerError?.cause === '4337_INVALID_NONCE') {
      warnings.push({
        id: 'bundler-nonce-discrepancy',
        title:
          'You can proceed safely, but fee payment options are limited due to a pending transaction'
      })
    }

    return warnings
  }

  get errors(): SignAccountOpError[] {
    const errors: SignAccountOpError[] = []

    if (this.isLoadingOrFailed() && this.estimationRetryError) {
      // If there is a successful estimation we should show this as a warning
      // as the user can use the old estimation to broadcast
      errors.push({
        title: `${this.estimationRetryError.message} ${
          this.error
            ? 'We will continue retrying, but please check your internet connection.'
            : 'Automatically retrying in a few seconds. Please wait...'
        }`
      })

      return errors
    }

    if (!this.isInitialized()) return []

    if (this.error) {
      let code = ''

      if (this.error instanceof ErrorHumanizerError && this.error.isFallbackMessage) {
        code =
          typeof this.error.cause === 'string' && !!this.error.cause
            ? this.error.cause
            : 'ESTIMATION_ERROR'
      }

      errors.push({
        title: this.error.message,
        code
      })
    }

    return errors
  }
}
