import {
  AbiCoder,
  formatEther,
  formatUnits,
  getAddress,
  Interface,
  toBeHex,
  ZeroAddress
} from 'ethers'

import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import ERC20 from '../../../contracts/compiled/IERC20.json'
import { FEE_COLLECTOR } from '../../consts/addresses'
import { BUNDLER } from '../../consts/bundlers'
import { SINGLETON } from '../../consts/deploy'
import gasTankFeeTokens from '../../consts/gasTankFeeTokens'
/* eslint-disable no-restricted-syntax */
import { ERRORS, RETRY_TO_INIT_ACCOUNT_OP_MSG } from '../../consts/signAccountOp/errorHandling'
import {
  GAS_TANK_TRANSFER_GAS_USED,
  SA_ERC20_TRANSFER_GAS_USED,
  SA_NATIVE_TRANSFER_GAS_USED
} from '../../consts/signAccountOp/gas'
import { Account } from '../../interfaces/account'
import { ExternalSignerControllers, Key } from '../../interfaces/keystore'
import { Network } from '../../interfaces/network'
import { Warning, TraceCallDiscoveryStatus } from '../../interfaces/signAccountOp'
import { isAmbireV1LinkedAccount, isSmartAccount } from '../../libs/account/account'
import { AccountOp, GasFeePayment, getSignableCalls } from '../../libs/accountOp/accountOp'
import { SubmittedAccountOp } from '../../libs/accountOp/submittedAccountOp'
import { PaymasterErrorReponse, PaymasterSuccessReponse, Sponsor } from '../../libs/erc7677/types'
import { getHumanReadableBroadcastError } from '../../libs/errorHumanizer'
import { Erc4337GasLimits, EstimateResult, FeePaymentOption } from '../../libs/estimate/interfaces'
import {
  Gas1559Recommendation,
  GasPriceRecommendation,
  GasRecommendation,
  getProbableCallData
} from '../../libs/gasPrice/gasPrice'
import { hasRelayerSupport } from '../../libs/networks/networks'
import { Price, TokenResult } from '../../libs/portfolio'
import { getExecuteSignature, getTypedData, wrapStandard } from '../../libs/signMessage/signMessage'
import { getGasUsed } from '../../libs/singleton/singleton'
import {
  getActivatorCall,
  getOneTimeNonce,
  getUserOperation,
  getUserOpHash,
  isErc4337Broadcast,
  shouldIncludeActivatorCall,
  shouldUseOneTimeNonce
} from '../../libs/userOperation/userOperation'
import { BundlerSwitcher } from '../../services/bundlers/bundlerSwitcher'
import { GasSpeeds } from '../../services/bundlers/types'
/* eslint-disable no-restricted-syntax */
import { AccountsController } from '../accounts/accounts'
import { AccountOpAction } from '../actions/actions'
import EventEmitter from '../eventEmitter/eventEmitter'
import { KeystoreController } from '../keystore/keystore'
import { PortfolioController } from '../portfolio/portfolio'
import {
  getFeeSpeedIdentifier,
  getFeeTokenPriceUnavailableWarning,
  getSignificantBalanceDecreaseWarning,
  getTokenUsdAmount
} from './helper'

export enum SigningStatus {
  EstimationError = 'estimation-error',
  UnableToSign = 'unable-to-sign',
  ReadyToSign = 'ready-to-sign',
  /**
   * Used to prevent state updates while the user is resolving warnings, connecting a hardware wallet, etc.
   * Signing is allowed in this state, but the state of the controller should not change.
   */
  UpdatesPaused = 'updates-paused',
  InProgress = 'in-progress',
  WaitingForPaymaster = 'waiting-for-paymaster-response',
  Done = 'done'
}

export type Status = {
  // @TODO: get rid of the object and just use the type
  type: SigningStatus
}

export enum FeeSpeed {
  Slow = 'slow',
  Medium = 'medium',
  Fast = 'fast',
  Ape = 'ape'
}

type SpeedCalc = {
  type: FeeSpeed
  amount: bigint
  simulatedGasLimit: bigint
  amountFormatted: string
  amountUsd: string
  gasPrice: bigint
  maxPriorityFeePerGas?: bigint
}

// declare the statuses we don't want state updates on
export const noStateUpdateStatuses = [
  SigningStatus.InProgress,
  SigningStatus.Done,
  SigningStatus.UpdatesPaused,
  SigningStatus.WaitingForPaymaster
]

export class SignAccountOpController extends EventEmitter {
  #accounts: AccountsController

  #keystore: KeystoreController

  #portfolio: PortfolioController

  #externalSignerControllers: ExternalSignerControllers

  account: Account

  #network: Network

  #blockGasLimit: bigint | undefined = undefined

  fromActionId: AccountOpAction['id']

  accountOp: AccountOp

  gasPrices: GasRecommendation[] | null = null

  bundlerGasPrices: GasSpeeds | null = null

  estimation: EstimateResult | null = null

  feeSpeeds: {
    [identifier: string]: SpeedCalc[]
  } = {}

  paidBy: string | null = null

  feeTokenResult: TokenResult | null = null

  selectedFeeSpeed: FeeSpeed = FeeSpeed.Fast

  selectedOption: FeePaymentOption | undefined = undefined

  status: Status | null = null

  gasUsedTooHigh: boolean

  gasUsedTooHighAgreed: boolean

  #reEstimate: Function

  #isSignRequestStillActive: Function

  rbfAccountOps: { [key: string]: SubmittedAccountOp | null }

  signedAccountOp: AccountOp | null

  replacementFeeLow: boolean

  warnings: Warning[] = []

  // indicates whether the transaction gas is sponsored or not
  isSponsored: boolean = false

  // the sponsor data to be displayed, if any
  sponsor: Sponsor | undefined = undefined

  bundlerSwitcher: BundlerSwitcher

  // We track the status of token discovery logic (main.traceCall)
  // to ensure the "SignificantBalanceDecrease" banner is displayed correctly.
  // The latest/pending portfolio balance is essential for calculating balance differences.
  // However, during a SWAP, the user may receive a new token that isn't yet included (discovered) in the portfolio.
  // If the discovery process is in-process, and we only rely on portfolio balance change,
  // the banner may be incorrectly triggered due to the perceived balance drop.
  // Once discovery completes and updates the portfolio, the banner will be hidden.
  traceCallDiscoveryStatus: TraceCallDiscoveryStatus = TraceCallDiscoveryStatus.NotStarted

  constructor(
    accounts: AccountsController,
    keystore: KeystoreController,
    portfolio: PortfolioController,
    externalSignerControllers: ExternalSignerControllers,
    account: Account,
    network: Network,
    fromActionId: AccountOpAction['id'],
    accountOp: AccountOp,
    reEstimate: Function,
    isSignRequestStillActive: Function
  ) {
    super()

    this.#accounts = accounts
    this.#keystore = keystore
    this.#portfolio = portfolio
    this.#externalSignerControllers = externalSignerControllers
    this.account = account
    this.#network = network
    this.fromActionId = fromActionId
    this.accountOp = structuredClone(accountOp)
    this.#reEstimate = reEstimate
    this.#isSignRequestStillActive = isSignRequestStillActive

    this.gasUsedTooHigh = false
    this.gasUsedTooHighAgreed = false
    this.rbfAccountOps = {}
    this.signedAccountOp = null
    this.replacementFeeLow = false
    this.bundlerSwitcher = new BundlerSwitcher(
      network,
      () => {
        return this.status ? this.status.type : null
      },
      noStateUpdateStatuses
    )
  }

  get isInitialized(): boolean {
    return !!this.estimation
  }

  #setDefaults() {
    // Set the first signer as the default one.
    // If there are more available signers, the user will be able to select a different signer from the application.
    // The main benefit of having a default signer
    // is that it drastically simplifies the logic of determining whether the account is ready for signing.
    // For example, in the `sign` method and on the application screen, we can simply rely on the `this.readyToSign` flag.
    // Otherwise, if we don't have a default value, then `this.readyToSign` will always be false unless we set a signer.
    // In that case, on the application, we want the "Sign" button to be clickable/enabled,
    // and we have to check and expose the `SignAccountOp` controller's inner state to make this check possible.
    if (
      this.accountKeyStoreKeys.length &&
      (!this.accountOp.signingKeyAddr || !this.accountOp.signingKeyType)
    ) {
      this.accountOp.signingKeyAddr = this.accountKeyStoreKeys[0].addr
      this.accountOp.signingKeyType = this.accountKeyStoreKeys[0].type
    }
  }

  #setGasFeePayment() {
    if (this.isInitialized && this.paidBy && this.selectedFeeSpeed && this.feeTokenResult) {
      this.accountOp.gasFeePayment = this.#getGasFeePayment()
    }
  }

  // check if speeds are set for the given identifier
  hasSpeeds(identifier: string) {
    return this.feeSpeeds[identifier] !== undefined && this.feeSpeeds[identifier].length
  }

  getCallDataAdditionalByNetwork(): bigint {
    // no additional call data is required for arbitrum as the bytes are already
    // added in the calculation for the L1 fee
    if (this.#network.id === 'arbitrum' || !isSmartAccount(this.account)) return 0n

    const estimationCallData = getProbableCallData(
      this.account,
      this.accountOp,
      this.#accounts.accountStates[this.accountOp.accountAddr][this.accountOp.networkId],
      this.#network
    )
    const FIXED_OVERHEAD = 21000n
    const bytes = Buffer.from(estimationCallData.substring(2))
    const nonZeroBytes = BigInt(bytes.filter((b) => b).length)
    const zeroBytes = BigInt(BigInt(bytes.length) - nonZeroBytes)
    const txDataGas = zeroBytes * 4n + nonZeroBytes * 16n
    return txDataGas + FIXED_OVERHEAD
  }

  get errors(): string[] {
    const errors: string[] = []

    if (!this.isInitialized) return errors

    const isAmbireV1 = isAmbireV1LinkedAccount(this.account?.creation?.factoryAddr)
    const isAmbireV1AndNetworkNotSupported = isAmbireV1 && !hasRelayerSupport(this.#network)

    // This must be the first error check!
    if (isAmbireV1AndNetworkNotSupported) {
      errors.push(
        'Ambire v1 accounts are not supported on this network. To interact with this network, please use an Ambire v2 Smart Account or a Basic Account. You can still use v1 accounts on any network that is natively integrated with the Ambire web and mobile wallets.'
      )

      // Don't show any other errors
      return errors
    }

    // if there's an estimation error, show it
    if (this.estimation?.error) {
      errors.push(this.estimation.error.message)
    }

    if (
      this.estimation?.gasUsed &&
      this.#blockGasLimit &&
      this.estimation?.gasUsed > this.#blockGasLimit
    ) {
      errors.push('Transaction reverted with estimation too high: above block limit')
    }

    if (
      this.#network.predefined &&
      this.estimation?.gasUsed &&
      this.estimation?.gasUsed > 500000000n
    ) {
      errors.push('Unreasonably high estimation. This transaction will probably fail')
    }

    // this error should never happen as availableFeeOptions should always have the native option
    if (!this.isSponsored && !this.availableFeeOptions.length)
      errors.push(ERRORS.eoaInsufficientFunds)

    // This error should not happen, as in the update method we are always setting a default signer.
    // It may occur, only if there are no available signer.
    if (!this.accountOp.signingKeyType || !this.accountOp.signingKeyAddr)
      errors.push('Please select a signer to sign the transaction.')

    const currentPortfolio = this.#portfolio.getLatestPortfolioState(this.accountOp.accountAddr)
    const currentPortfolioNetwork = currentPortfolio[this.accountOp.networkId]

    const currentPortfolioNetworkNative = currentPortfolioNetwork?.result?.tokens.find(
      (token) => token.address === '0x0000000000000000000000000000000000000000'
    )
    if (!this.isSponsored && !currentPortfolioNetworkNative)
      errors.push(
        'Unable to estimate the transaction fee as fetching the latest price update for the network native token failed. Please try again later.'
      )

    // if there's no gasFeePayment calculate but there is: 1) feeTokenResult
    // 2) selectedOption and 3) gasSpeeds for selectedOption => return an error
    if (
      !this.isSponsored &&
      !this.accountOp.gasFeePayment &&
      this.feeTokenResult &&
      this.selectedOption
    ) {
      const identifier = getFeeSpeedIdentifier(
        this.selectedOption,
        this.accountOp.accountAddr,
        this.rbfAccountOps[this.selectedOption.paidBy]
      )
      if (this.hasSpeeds(identifier))
        errors.push('Please select a token and an account for paying the gas fee.')
    }

    if (
      !this.isSponsored &&
      this.selectedOption &&
      this.accountOp.gasFeePayment &&
      this.selectedOption.availableAmount < this.accountOp.gasFeePayment.amount
    ) {
      const speedCoverage = []
      const identifier = getFeeSpeedIdentifier(
        this.selectedOption,
        this.accountOp.accountAddr,
        this.rbfAccountOps[this.selectedOption.paidBy]
      )

      if (this.feeSpeeds[identifier]) {
        this.feeSpeeds[identifier].forEach((speed) => {
          if (this.selectedOption && this.selectedOption.availableAmount >= speed.amount)
            speedCoverage.push(speed.type)
        })
      }

      if (speedCoverage.length === 0) {
        const isSA = isSmartAccount(this.account)
        const isUnableToCoverWithAllOtherTokens = this.availableFeeOptions.every((option) => {
          if (option === this.selectedOption) return true
          const optionIdentifier = getFeeSpeedIdentifier(
            option,
            this.accountOp.accountAddr,
            this.rbfAccountOps[option.paidBy]
          )

          const speedsThatCanCover = this.feeSpeeds[optionIdentifier]?.filter(
            (speed) => speed.amount <= option.availableAmount
          )

          return !speedsThatCanCover?.length
        })
        if (isUnableToCoverWithAllOtherTokens) {
          let skippedTokensCount = 0
          const gasTokenNames = gasTankFeeTokens
            .filter(({ networkId, hiddenOnError }) => {
              if (networkId !== this.accountOp.networkId) return false

              if (hiddenOnError) {
                skippedTokensCount++
                return false
              }

              return true
            })
            .map(({ symbol }) => symbol.toUpperCase())
            .join(', ')

          errors.push(
            `${ERRORS.eoaInsufficientFunds}${
              isSA
                ? ` Available fee options: USDC in Gas Tank, ${gasTokenNames}${
                    skippedTokensCount ? ' and others' : ''
                  }`
                : ''
            }`
          )
        } else {
          errors.push(
            isSA
              ? "Signing is not possible with the selected account's token as it doesn't have sufficient funds to cover the gas payment fee."
              : ERRORS.eoaInsufficientFunds
          )
        }
      } else {
        errors.push(
          'The selected speed is not available due to insufficient funds. Please select a slower speed.'
        )
      }
    }

    // The signing might fail, tell the user why but allow the user to retry signing,
    // @ts-ignore fix TODO: type mismatch
    if (this.status?.type === SigningStatus.ReadyToSign && !!this.status.error) {
      // @ts-ignore typescript complains, but the error being present gets checked above
      errors.push(this.status.error)
    }

    if (!this.isSponsored && !this.#feeSpeedsLoading && this.selectedOption) {
      const identifier = getFeeSpeedIdentifier(
        this.selectedOption,
        this.accountOp.accountAddr,
        this.rbfAccountOps[this.selectedOption.paidBy]
      )
      if (!this.hasSpeeds(identifier)) {
        if (!this.feeTokenResult?.priceIn.length) {
          errors.push(
            `Currently, ${this.feeTokenResult?.symbol} is unavailable as a fee token as we're experiencing troubles fetching its price. Please select another or contact support`
          )
        } else {
          errors.push(
            'Unable to estimate the transaction fee. Please try changing the fee token or contact support.'
          )
        }
      }
    }

    // if the gasFeePayment is gas tank but the user doesn't have funds, disable it
    let balance = 0
    Object.keys(currentPortfolio).forEach((networkName) => {
      const networkPortfolio = currentPortfolio[networkName]
      if (!networkPortfolio?.result?.total?.usd) return

      balance += networkPortfolio.result.total.usd
    })
    if (balance < 10 && this.accountOp.gasFeePayment && this.accountOp.gasFeePayment.isGasTank) {
      errors.push(
        'Your account must have a minimum overall balance of $10 to pay for gas via the Gas Tank. Please add funds to your account or choose another fee payment option.'
      )
    }

    return errors
  }

  get readyToSign() {
    return (
      !!this.status &&
      (this.status?.type === SigningStatus.ReadyToSign ||
        this.status?.type === SigningStatus.UpdatesPaused)
    )
  }

  calculateWarnings() {
    const warnings: Warning[] = []

    const latestState = this.#portfolio.getLatestPortfolioState(this.accountOp.accountAddr)
    const pendingState = this.#portfolio.getPendingPortfolioState(this.accountOp.accountAddr)

    const significantBalanceDecreaseWarning = getSignificantBalanceDecreaseWarning(
      latestState,
      pendingState,
      this.accountOp.networkId,
      this.traceCallDiscoveryStatus
    )

    if (this.selectedOption) {
      const identifier = getFeeSpeedIdentifier(
        this.selectedOption,
        this.accountOp.accountAddr,
        this.rbfAccountOps[this.selectedOption.paidBy]
      )
      const feeTokenHasPrice = this.feeSpeeds[identifier]?.every((speed) => !!speed.amountUsd)
      const feeTokenPriceUnavailableWarning = getFeeTokenPriceUnavailableWarning(
        !!this.hasSpeeds(identifier),
        feeTokenHasPrice
      )

      // push the warning only if the txn is not sponsored
      if (!this.isSponsored && feeTokenPriceUnavailableWarning)
        warnings.push(feeTokenPriceUnavailableWarning)
    }

    if (significantBalanceDecreaseWarning) warnings.push(significantBalanceDecreaseWarning)

    this.warnings = warnings

    this.emitUpdate()
  }

  update({
    gasPrices,
    estimation,
    feeToken,
    paidBy,
    speed,
    signingKeyAddr,
    signingKeyType,
    calls,
    gasUsedTooHighAgreed,
    rbfAccountOps,
    bundlerGasPrices,
    blockGasLimit
  }: {
    gasPrices?: GasRecommendation[]
    estimation?: EstimateResult | null
    feeToken?: TokenResult
    paidBy?: string
    speed?: FeeSpeed
    signingKeyAddr?: Key['addr']
    signingKeyType?: Key['type']
    calls?: AccountOp['calls']
    gasUsedTooHighAgreed?: boolean
    rbfAccountOps?: { [key: string]: SubmittedAccountOp | null }
    bundlerGasPrices?: { speeds: GasSpeeds; bundler: BUNDLER }
    blockGasLimit?: bigint
  }) {
    // once the user commits to the things he sees on his screen,
    // we need to be sure nothing changes afterwards.
    // For example, signing can be slow if it's done by a hardware wallet.
    // The estimation gets refreshed on the other hand each 12 seconds (6 on optimism)
    // If we allow the estimation to affect the controller state during sign,
    // there could be discrepancy between what the user has agreed upon and what
    // we broadcast in the end
    if (this.status?.type && noStateUpdateStatuses.indexOf(this.status?.type) !== -1) {
      return
    }

    if (Array.isArray(calls)) this.accountOp.calls = calls

    if (blockGasLimit) this.#blockGasLimit = blockGasLimit

    if (gasPrices) this.gasPrices = gasPrices

    if (estimation) {
      this.gasUsedTooHigh = !!(this.#blockGasLimit && estimation.gasUsed > this.#blockGasLimit / 4n)
      this.estimation = estimation
      // on each estimation update, set the newest account nonce
      this.accountOp.nonce = BigInt(estimation.currentAccountNonce)
    }

    // if estimation is undefined, do not clear the estimation.
    // We do this only if strictly specified as null
    if (estimation === null) this.estimation = null

    if (feeToken && paidBy) {
      this.paidBy = paidBy
      this.feeTokenResult = feeToken
    }

    if (speed && this.isInitialized) {
      this.selectedFeeSpeed = speed
    }

    if (signingKeyAddr && signingKeyType && this.isInitialized) {
      this.accountOp.signingKeyAddr = signingKeyAddr
      this.accountOp.signingKeyType = signingKeyType
    }

    if (gasUsedTooHighAgreed !== undefined) this.gasUsedTooHighAgreed = gasUsedTooHighAgreed

    // set the rbf is != undefined
    if (rbfAccountOps) this.rbfAccountOps = rbfAccountOps

    // Set defaults, if some of the optional params are omitted
    this.#setDefaults()

    if (this.estimation && this.paidBy && this.feeTokenResult) {
      this.selectedOption = this.availableFeeOptions.find(
        (option) =>
          option.paidBy === this.paidBy &&
          option.token.address === this.feeTokenResult!.address &&
          option.token.symbol.toLocaleLowerCase() ===
            this.feeTokenResult!.symbol.toLocaleLowerCase() &&
          option.token.flags.onGasTank === this.feeTokenResult!.flags.onGasTank
      )
    }

    // update the bundler gas prices if the bundlers match
    if (
      this.estimation?.erc4337GasLimits &&
      bundlerGasPrices &&
      bundlerGasPrices.bundler === this.bundlerSwitcher.getBundler().getName()
    ) {
      this.estimation.erc4337GasLimits.gasPrice = bundlerGasPrices.speeds
    }

    if (
      this.estimation &&
      this.estimation.erc4337GasLimits &&
      this.estimation.erc4337GasLimits.paymaster
    ) {
      // if it was sponsored but it no longer is (fallback case),
      // reset the selectedOption option as we use native for the sponsorship
      // but the user might not actually have any native
      const isSponsorshipFallback =
        this.isSponsored && !this.estimation.erc4337GasLimits.paymaster.isSponsored()

      this.isSponsored = this.estimation.erc4337GasLimits.paymaster.isSponsored()
      this.sponsor = this.estimation.erc4337GasLimits.paymaster.getEstimationData()?.sponsor

      if (isSponsorshipFallback) {
        this.selectedOption = this.availableFeeOptions.length
          ? this.availableFeeOptions[0]
          : undefined
      }
    }

    // calculate the fee speeds if either there are no feeSpeeds
    // or any of properties for update is requested
    if (!Object.keys(this.feeSpeeds).length || Array.isArray(calls) || gasPrices || estimation) {
      this.#updateFeeSpeeds()
    }

    // Here, we expect to have most of the fields set, so we can safely set GasFeePayment
    this.#setGasFeePayment()
    this.updateStatus()
    this.calculateWarnings()
  }

  updateStatus(forceStatusChange?: SigningStatus, replacementFeeLow = false) {
    // use this to go back to ReadyToSign when a broadcasting error is emitted
    if (forceStatusChange) {
      this.status = { type: forceStatusChange }
      this.emitUpdate()
      return
    }

    // no status updates on these two
    const isInTheMiddleOfSigning =
      this.status?.type === SigningStatus.InProgress ||
      this.status?.type === SigningStatus.WaitingForPaymaster
    const isDone = this.status?.type === SigningStatus.Done
    if (isInTheMiddleOfSigning || isDone) return

    // if we have an estimation error, set the state so and return
    if (this.estimation?.error) {
      this.status = { type: SigningStatus.EstimationError }
      this.emitUpdate()
      return
    }

    if (this.errors.length) {
      this.status = { type: SigningStatus.UnableToSign }
      this.emitUpdate()
      return
    }

    if (
      this.isInitialized &&
      this.estimation &&
      this.accountOp?.signingKeyAddr &&
      this.accountOp?.signingKeyType &&
      this.accountOp?.gasFeePayment &&
      // if the gas used is too high, do not allow the user to sign
      // until he explicitly agrees to the risks
      (!this.gasUsedTooHigh || this.gasUsedTooHighAgreed)
    ) {
      this.status = { type: SigningStatus.ReadyToSign }

      // do not reset this once triggered
      if (replacementFeeLow) this.replacementFeeLow = replacementFeeLow
      this.emitUpdate()
      return
    }

    // reset the status if a valid state was not found
    this.status = null
    this.emitUpdate()
  }

  reset() {
    this.gasPrices = null
    this.estimation = null
    this.selectedFeeSpeed = FeeSpeed.Fast
    this.paidBy = null
    this.feeTokenResult = null
    this.status = null
    this.emitUpdate()
  }

  resetStatus() {
    this.status = null
    this.emitUpdate()
  }

  /**
   * Obtain the native token ratio in relation to a fee token.
   *
   * By knowing the USD value of the tokens in the portfolio,
   * we can calculate the ratio between a native token and a fee token.
   *
   * For example, 1 ETH = 8 BNB (ratio: 8).
   *
   * We require the ratio to be in a BigInt format since all the application values,
   * such as amount, gasLimit, etc., are also represented as BigInt numbers.
   */
  #getNativeToFeeTokenRatio(feeToken: TokenResult): bigint | null {
    const native = this.#portfolio
      .getLatestPortfolioState(this.accountOp.accountAddr)
      [this.accountOp.networkId]?.result?.tokens.find(
        (token) => token.address === '0x0000000000000000000000000000000000000000'
      )
    if (!native) return null

    // In case the fee token is the native token we don't want to depend to priceIn, as it might not be available.
    if (native.address === feeToken.address && native.networkId === feeToken.networkId)
      return BigInt(1 * 1e18)

    const isUsd = (price: Price) => price.baseCurrency === 'usd'

    const nativePrice = native.priceIn.find(isUsd)?.price
    const feeTokenPrice = feeToken.priceIn.find(isUsd)?.price

    if (!nativePrice || !feeTokenPrice) return null

    const ratio = nativePrice / feeTokenPrice

    // Here we multiply it by 1e18, in order to keep the decimal precision.
    // Otherwise, passing the ratio to the BigInt constructor, we will lose the numbers after the decimal point.
    // Later, once we need to normalize this ratio, we should not forget to divide it by 1e18.
    const ratio1e18 = ratio * 1e18
    const toBigInt = ratio1e18 % 1 === 0 ? ratio1e18 : ratio1e18.toFixed(0)
    return BigInt(toBigInt)
  }

  static getAmountAfterFeeTokenConvert(
    simulatedGasLimit: bigint,
    gasPrice: bigint,
    nativeRatio: bigint,
    feeTokenDecimals: number,
    addedNative: bigint
  ) {
    const amountInWei = simulatedGasLimit * gasPrice + addedNative

    // Let's break down the process of converting the amount into FeeToken:
    // 1. Initially, we multiply the amount in wei by the native to fee token ratio.
    // 2. Next, we address the decimal places:
    // 2.1. First, we convert wei to native by dividing by 10^18 (representing the decimals).
    // 2.2. Now, with the amount in the native token, we incorporate nativeRatio decimals into the calculation (18 + 18) to standardize the amount.
    // 2.3. At this point, we precisely determine the number of fee tokens. For instance, if the amount is 3 USDC, we must convert it to a BigInt value, while also considering feeToken.decimals.
    const extraDecimals = BigInt(10 ** 18)
    const feeTokenExtraDecimals = BigInt(10 ** (18 - feeTokenDecimals))
    const pow = extraDecimals * feeTokenExtraDecimals
    return (amountInWei * nativeRatio) / pow
  }

  /**
   * Increase the fee we send to the feeCollector according to the specified
   * options in the network tab
   */
  #increaseFee(amount: bigint): bigint {
    if (!this.#network.feeOptions.feeIncrease) {
      return amount
    }

    return amount + (amount * this.#network.feeOptions.feeIncrease) / 100n
  }

  /**
   * If the nonce of the current account op and the last account op are the same,
   * do an RBF increase or otherwise the user cannot broadcast the txn
   *
   * calculatedGas: it should be either the whole gasPrice if the network doesn't
   * support EIP-1559 OR it should the maxPriorityFeePerGas if the network
   * supports EIP-1559
   *
   * gasPropertyName: pass gasPrice if no EIP-1559; otherwise: maxPriorityFeePerGas
   */
  #rbfIncrease(
    accId: string,
    calculatedGas: bigint,
    gasPropertyName: 'gasPrice' | 'maxPriorityFeePerGas',
    prevSpeed: SpeedCalc | null
  ): bigint {
    // ape speed gets 50% increase
    const divider = prevSpeed && prevSpeed.type === FeeSpeed.Fast ? 2n : 8n

    // when doing an RBF, make sure the min gas for the current speed
    // is at least 12% bigger than the previous speed
    const prevSpeedGas = prevSpeed ? prevSpeed[gasPropertyName] : undefined
    const prevSpeedGasIncreased = prevSpeedGas ? prevSpeedGas + prevSpeedGas / divider : 0n
    const min = prevSpeedGasIncreased > calculatedGas ? prevSpeedGasIncreased : calculatedGas

    // if there was an error on the signed account op with a
    // replacement fee too low, we increase by 13% the signed account op
    // IF the new estimation is not actually higher
    if (this.replacementFeeLow && this.signedAccountOp && this.signedAccountOp.gasFeePayment) {
      const prevGas = this.signedAccountOp.gasFeePayment[gasPropertyName] ?? undefined
      const bumpFees = prevGas ? prevGas + prevGas / divider + prevGas / 100n : 0n
      return min > bumpFees ? min : bumpFees
    }

    // if no RBF option for this paidBy option, return the amount
    const rbfOp = this.rbfAccountOps[accId]
    if (!rbfOp || !rbfOp.gasFeePayment || !rbfOp.gasFeePayment[gasPropertyName])
      return calculatedGas

    // increase by a minimum of 13% the last broadcast txn and use that
    // or use the current gas estimation if it's more
    const rbfGas = rbfOp.gasFeePayment[gasPropertyName] ?? 0n
    const lastTxnGasPriceIncreased = rbfGas + rbfGas / divider + rbfGas / 100n
    return min > lastTxnGasPriceIncreased ? min : lastTxnGasPriceIncreased
  }

  get #feeSpeedsLoading() {
    return !this.isInitialized || !this.gasPrices
  }

  #updateFeeSpeeds() {
    if (this.#feeSpeedsLoading) return

    // reset the fee speeds at the beginning to avoid duplications
    this.feeSpeeds = {}

    const gasUsed = this.estimation!.gasUsed

    this.availableFeeOptions.forEach((option) => {
      // if a calculation has been made, do not make it again
      // EOA pays for SA is the most common case for this scenario
      //
      // addition: make sure there's no rbfAccountOps as well
      const identifier = getFeeSpeedIdentifier(
        option,
        this.accountOp.accountAddr,
        this.rbfAccountOps[option.paidBy]
      )
      if (this.hasSpeeds(identifier)) {
        return
      }

      const nativeRatio = this.#getNativeToFeeTokenRatio(option.token)
      if (!nativeRatio) {
        this.feeSpeeds[identifier] = []
        return
      }

      const erc4337GasLimits = this.estimation?.erc4337GasLimits
      if (erc4337GasLimits) {
        const speeds: SpeedCalc[] = []
        const usesPaymaster = !!this.estimation?.erc4337GasLimits?.paymaster.isUsable()

        for (const [speed, speedValue] of Object.entries(erc4337GasLimits.gasPrice)) {
          const simulatedGasLimit =
            BigInt(erc4337GasLimits.callGasLimit) +
            BigInt(erc4337GasLimits.preVerificationGas) +
            BigInt(option.gasUsed ?? 0)
          const gasPrice = BigInt(speedValue.maxFeePerGas)
          let amount = SignAccountOpController.getAmountAfterFeeTokenConvert(
            simulatedGasLimit,
            gasPrice,
            nativeRatio,
            option.token.decimals,
            0n
          )
          if (usesPaymaster) amount = this.#increaseFee(amount)

          speeds.push({
            type: speed as FeeSpeed,
            simulatedGasLimit,
            amount,
            amountFormatted: formatUnits(amount, Number(option.token.decimals)),
            amountUsd: getTokenUsdAmount(option.token, amount),
            gasPrice,
            maxPriorityFeePerGas: BigInt(speedValue.maxPriorityFeePerGas)
          })
        }

        if (this.feeSpeeds[identifier] === undefined) this.feeSpeeds[identifier] = []
        this.feeSpeeds[identifier] = speeds
        return
      }

      ;(this.gasPrices || []).forEach((gasRecommendation, i) => {
        let amount
        let simulatedGasLimit
        const prevSpeed =
          this.feeSpeeds[identifier] && this.feeSpeeds[identifier].length
            ? this.feeSpeeds[identifier][i - 1]
            : null

        // gasRecommendation can come as GasPriceRecommendation or Gas1559Recommendation
        // depending whether the network supports EIP-1559 and is it enabled on our side.
        // To check, we use maxPriorityFeePerGas. If it's set => EIP-1559.
        // After, we call #rbfIncrease on maxPriorityFeePerGas if set which either returns
        // the maxPriorityFeePerGas without doing anything (most cases) or if there's a
        // pending txn in the mempool, it bumps maxPriorityFeePerGas by 12.5% to enable RBF.
        // Finally, we calculate the gasPrice:
        // - EIP-1559: baseFeePerGas + maxPriorityFeePerGas
        // - Normal: gasRecommendation.gasPrice #rbfIncreased (same logic as for maxPriorityFeePerGas RBF)
        const maxPriorityFeePerGas =
          'maxPriorityFeePerGas' in gasRecommendation
            ? this.#rbfIncrease(
                option.paidBy,
                gasRecommendation.maxPriorityFeePerGas,
                'maxPriorityFeePerGas',
                prevSpeed
              )
            : undefined

        const gasPrice =
          'maxPriorityFeePerGas' in gasRecommendation
            ? (gasRecommendation as Gas1559Recommendation).baseFeePerGas + maxPriorityFeePerGas!
            : this.#rbfIncrease(
                option.paidBy,
                (gasRecommendation as GasPriceRecommendation).gasPrice,
                'gasPrice',
                prevSpeed
              )

        // EOA
        if (!isSmartAccount(this.account)) {
          simulatedGasLimit = gasUsed

          if (this.accountOp.calls[0].to && getAddress(this.accountOp.calls[0].to) === SINGLETON) {
            simulatedGasLimit = getGasUsed(simulatedGasLimit)
          }

          amount = simulatedGasLimit * gasPrice + option.addedNative
        } else if (option.paidBy !== this.accountOp.accountAddr) {
          // Smart account, but EOA pays the fee
          simulatedGasLimit = gasUsed + this.getCallDataAdditionalByNetwork()
          amount = simulatedGasLimit * gasPrice + option.addedNative
        } else {
          // Relayer
          simulatedGasLimit = gasUsed + this.getCallDataAdditionalByNetwork() + option.gasUsed!
          amount = SignAccountOpController.getAmountAfterFeeTokenConvert(
            simulatedGasLimit,
            gasPrice,
            nativeRatio,
            option.token.decimals,
            option.addedNative
          )
          amount = this.#increaseFee(amount)
        }

        const feeSpeed: SpeedCalc = {
          type: gasRecommendation.name as FeeSpeed,
          simulatedGasLimit,
          amount,
          amountFormatted: formatUnits(amount, Number(option.token.decimals)),
          amountUsd: getTokenUsdAmount(option.token, amount),
          gasPrice,
          maxPriorityFeePerGas
        }
        if (this.feeSpeeds[identifier] === undefined) this.feeSpeeds[identifier] = []
        this.feeSpeeds[identifier].push(feeSpeed)
      })
    })
  }

  #getGasFeePayment(): GasFeePayment | null {
    if (!this.isInitialized) {
      this.emitError({
        level: 'major',
        message:
          'Something went wrong while setting up the gas fee payment account and token. Please try again, selecting the account and token option. If the problem persists, contact support.',
        error: new Error(
          'SignAccountOpController: The controller is not initialized while we are trying to build GasFeePayment.'
        )
      })

      return null
    }
    if (!this.paidBy) {
      this.emitError({
        level: 'silent',
        message: '',
        error: new Error('SignAccountOpController: paying account not selected')
      })

      return null
    }
    if (!this.feeTokenResult) {
      this.emitError({
        level: 'silent',
        message: '',
        error: new Error('SignAccountOpController: fee token not selected')
      })

      return null
    }

    // if there are no availableFeeOptions, we don't have a gasFee
    // this is normal though as there are such cases:
    // - EOA paying in native but doesn't have any native
    // so no error should pop out because of this
    if (!this.availableFeeOptions.length) {
      return null
    }

    if (!this.selectedOption) {
      this.emitError({
        level: 'silent',
        message: '',
        error: new Error('SignAccountOpController: paying option not found')
      })

      return null
    }

    // if there are no fee speeds available for the option, it means
    // the nativeRatio could not be calculated. In that case, we do not
    // emit an error here but proceed and show an explanation to the user
    // in get errors()
    // check test: Signing [Relayer]: ... priceIn | native/Ratio
    const identifier = getFeeSpeedIdentifier(
      this.selectedOption,
      this.accountOp.accountAddr,
      this.rbfAccountOps[this.selectedOption.paidBy]
    )
    if (!this.feeSpeeds[identifier].length) {
      return null
    }

    const chosenSpeed = this.feeSpeeds[identifier].find(
      (speed) => speed.type === this.selectedFeeSpeed
    )
    if (!chosenSpeed) {
      this.emitError({
        level: 'silent',
        message: '',
        error: new Error('SignAccountOpController: fee speed not selected')
      })

      return null
    }

    const accountState =
      this.#accounts.accountStates[this.accountOp.accountAddr][this.accountOp.networkId]
    return {
      paidBy: this.paidBy,
      // we're allowing EOAs to broadcast on 4337 networks as well
      // in that case, we don't do user operations
      isERC4337:
        this.paidBy === this.accountOp.accountAddr &&
        isErc4337Broadcast(this.account, this.#network, accountState),
      isGasTank: this.feeTokenResult.flags.onGasTank,
      inToken: this.feeTokenResult.address,
      feeTokenNetworkId: this.feeTokenResult.networkId,
      amount: chosenSpeed.amount,
      simulatedGasLimit: chosenSpeed.simulatedGasLimit,
      gasPrice: chosenSpeed.gasPrice,
      maxPriorityFeePerGas:
        'maxPriorityFeePerGas' in chosenSpeed ? chosenSpeed.maxPriorityFeePerGas : undefined
    }
  }

  get feeToken(): string | null {
    return this.accountOp?.gasFeePayment?.inToken || null
  }

  get feePaidBy(): string | null {
    return this.accountOp?.gasFeePayment?.paidBy || null
  }

  get availableFeeOptions(): EstimateResult['feePaymentOptions'] {
    if (!this.estimation) return []

    // if the txn is sponsored, return the native option only
    // even if it's balance is 0
    if (this.isSponsored) {
      const native = this.estimation.feePaymentOptions.find(
        (feeOption) => feeOption.token.address === ZeroAddress
      )
      return native ? [native] : []
    }

    // FeeOptions having amount
    const withAmounts = this.estimation.feePaymentOptions.filter(
      (feeOption) => feeOption.availableAmount
    )
    if (withAmounts.length) return withAmounts

    // if there are no fee options with amounts, return the native option
    const native = this.estimation.feePaymentOptions.find(
      (feeOption) => feeOption.token.address === ZeroAddress
    )
    return native ? [native] : []
  }

  get accountKeyStoreKeys(): Key[] {
    return this.#keystore.keys.filter((key) => this.account.associatedKeys.includes(key.addr))
  }

  // eslint-disable-next-line class-methods-use-this
  get speedOptions() {
    return Object.values(FeeSpeed) as string[]
  }

  get gasSavedUSD(): number | null {
    if (!this.selectedOption?.token.flags.onGasTank) return null

    const identifier = getFeeSpeedIdentifier(
      this.selectedOption,
      this.accountOp.accountAddr,
      this.rbfAccountOps[this.selectedOption.paidBy]
    )
    const selectedFeeSpeedData = this.feeSpeeds[identifier].find(
      (speed) => speed.type === this.selectedFeeSpeed
    )
    const gasPrice = selectedFeeSpeedData?.gasPrice
    if (!gasPrice) return null

    // get the native token from the portfolio to calculate prices
    const native = this.#portfolio
      .getLatestPortfolioState(this.accountOp.accountAddr)
      [this.accountOp.networkId]?.result?.tokens.find(
        (token) => token.address === '0x0000000000000000000000000000000000000000'
      )
    if (!native) return null
    const nativePrice = native.priceIn.find((price) => price.baseCurrency === 'usd')?.price
    if (!nativePrice) return null

    // 4337 gasUsed is set to 0 in the estimation as we rely
    // on the bundler for the estimation entirely => use hardcode value
    const gasUsedSelectedOption =
      this.selectedOption.gasUsed && this.selectedOption.gasUsed > 0n
        ? this.selectedOption.gasUsed
        : GAS_TANK_TRANSFER_GAS_USED
    const isNativeSelected = this.selectedOption.token.address === ZeroAddress
    const gasUsedNative =
      this.availableFeeOptions.find(
        (option) => option.token.address === ZeroAddress && !option.token.flags.onGasTank
      )?.gasUsed || SA_NATIVE_TRANSFER_GAS_USED
    const gasUsedERC20 =
      this.availableFeeOptions.find(
        (option) => option.token.address !== ZeroAddress && !option.token.flags.onGasTank
      )?.gasUsed || SA_ERC20_TRANSFER_GAS_USED

    const gasUsedWithoutGasTank = isNativeSelected ? gasUsedNative : gasUsedERC20
    const gasSavedInNative = formatEther((gasUsedWithoutGasTank - gasUsedSelectedOption) * gasPrice)

    return Number(gasSavedInNative) * nativePrice
  }

  #emitSigningErrorAndResetToReadyToSign(error: string) {
    this.emitError({ level: 'major', message: error, error: new Error(error) })
    this.status = { type: SigningStatus.ReadyToSign }

    this.emitUpdate()
  }

  #addFeePayment() {
    // In case of gas tank token fee payment, we need to include one more call to account op
    const abiCoder = new AbiCoder()

    if (this.isSponsored) {
      this.accountOp.feeCall = {
        to: FEE_COLLECTOR,
        value: 0n,
        data: abiCoder.encode(['string', 'uint256', 'string'], ['gasTank', 0n, 'USDC'])
      }

      return
    }

    if (this.accountOp.gasFeePayment!.isGasTank) {
      this.accountOp.feeCall = {
        to: FEE_COLLECTOR,
        value: 0n,
        data: abiCoder.encode(
          ['string', 'uint256', 'string'],
          ['gasTank', this.accountOp.gasFeePayment!.amount, this.feeTokenResult?.symbol]
        )
      }

      return
    }

    if (this.accountOp.gasFeePayment!.inToken === '0x0000000000000000000000000000000000000000') {
      // native payment
      this.accountOp.feeCall = {
        to: FEE_COLLECTOR,
        value: this.accountOp.gasFeePayment!.amount,
        data: '0x'
      }
    } else {
      // token payment
      const ERC20Interface = new Interface(ERC20.abi)
      this.accountOp.feeCall = {
        to: this.accountOp.gasFeePayment!.inToken,
        value: 0n,
        data: ERC20Interface.encodeFunctionData('transfer', [
          FEE_COLLECTOR,
          this.accountOp.gasFeePayment!.amount
        ])
      }
    }
  }

  async sign() {
    if (!this.readyToSign) {
      const message = `Unable to sign the transaction. During the preparation step, the necessary transaction data was not received. ${RETRY_TO_INIT_ACCOUNT_OP_MSG}`
      return this.#emitSigningErrorAndResetToReadyToSign(message)
    }

    // when signing begings, we stop immediatelly state updates on the controller
    // by changing the status to InProgress. Check update() for more info
    this.status = { type: SigningStatus.InProgress }

    if (!this.accountOp?.signingKeyAddr || !this.accountOp?.signingKeyType) {
      const message = `Unable to sign the transaction. During the preparation step, required signing key information was found missing. ${RETRY_TO_INIT_ACCOUNT_OP_MSG}`
      return this.#emitSigningErrorAndResetToReadyToSign(message)
    }

    if (!this.accountOp?.gasFeePayment || !this.selectedOption) {
      const message = `Unable to sign the transaction. During the preparation step, required information about paying the gas fee was found missing. ${RETRY_TO_INIT_ACCOUNT_OP_MSG}`
      return this.#emitSigningErrorAndResetToReadyToSign(message)
    }

    const signer = await this.#keystore.getSigner(
      this.accountOp.signingKeyAddr,
      this.accountOp.signingKeyType
    )
    if (!signer) {
      const message = `Unable to sign the transaction. During the preparation step, required account key information was found missing. ${RETRY_TO_INIT_ACCOUNT_OP_MSG}`
      return this.#emitSigningErrorAndResetToReadyToSign(message)
    }

    const accountState =
      this.#accounts.accountStates[this.accountOp.accountAddr][this.accountOp.networkId]
    const isUsingPaymaster = !!this.estimation?.erc4337GasLimits?.paymaster.isUsable()
    const usesOneTimeNonce = shouldUseOneTimeNonce(accountState)
    if (this.accountOp.gasFeePayment.isERC4337 && isUsingPaymaster && !usesOneTimeNonce) {
      this.status = { type: SigningStatus.WaitingForPaymaster }
    } else {
      this.status = { type: SigningStatus.InProgress }
    }

    // we update the FE with the changed status (in progress) only after the checks
    // above confirm everything is okay to prevent two different state updates
    this.emitUpdate()

    const gasFeePayment = this.accountOp.gasFeePayment

    if (signer.init) signer.init(this.#externalSignerControllers[this.accountOp.signingKeyType])

    // just in-case: before signing begins, we delete the feeCall;
    // if there's a need for it, it will be added later on in the code.
    // We need this precaution because this could happen:
    // - try to broadcast with the relayer
    // - the feel call gets added
    // - the relayer broadcast fails
    // - the user does another broadcast, this time with EOA pays for SA
    // - the fee call stays, causing a low gas limit revert
    delete this.accountOp.feeCall

    // delete the activatorCall as a precaution that it won't be added twice
    delete this.accountOp.activatorCall

    // @EntryPoint activation
    // if we broadcast by an EOA, this is the only way to include
    // the entry point as a signer
    if (
      shouldIncludeActivatorCall(
        this.#network,
        this.account,
        accountState,
        this.accountOp.gasFeePayment.isERC4337
      )
    ) {
      this.accountOp.activatorCall = getActivatorCall(this.accountOp.accountAddr)
    }

    try {
      // In case of EOA account
      if (!isSmartAccount(this.account)) {
        if (this.accountOp.calls.length !== 1) {
          const callCount = this.accountOp.calls.length > 1 ? 'multiple' : 'zero'
          const message = `Unable to sign the transaction because it has ${callCount} calls. ${RETRY_TO_INIT_ACCOUNT_OP_MSG}`
          return this.#emitSigningErrorAndResetToReadyToSign(message)
        }

        // In legacy mode, we sign the transaction directly.
        // that means the signing will happen on broadcast and here
        // checking whether the call is 1 and 1 only is enough
        this.accountOp.signature = '0x'
      } else if (this.accountOp.gasFeePayment.paidBy !== this.account.addr) {
        // Smart account, but EOA pays the fee
        // EOA pays for execute() - relayerless

        this.accountOp.signature = await getExecuteSignature(
          this.#network,
          this.accountOp,
          accountState,
          signer
        )
      } else if (this.accountOp.gasFeePayment.isERC4337) {
        // if there's no entryPointAuthorization, the txn will fail
        if (
          !accountState.isDeployed &&
          (!this.accountOp.meta || !this.accountOp.meta.entryPointAuthorization)
        )
          return this.#emitSigningErrorAndResetToReadyToSign(
            `Unable to sign the transaction because entry point privileges were not granted. ${RETRY_TO_INIT_ACCOUNT_OP_MSG}`
          )

        const erc4337Estimation = this.estimation!.erc4337GasLimits as Erc4337GasLimits

        const userOperation = getUserOperation(
          this.account,
          accountState,
          this.accountOp,
          this.bundlerSwitcher.getBundler().getName(),
          !accountState.isDeployed ? this.accountOp.meta!.entryPointAuthorization : undefined
        )
        userOperation.preVerificationGas = erc4337Estimation.preVerificationGas
        userOperation.callGasLimit = toBeHex(
          BigInt(erc4337Estimation.callGasLimit) + (this.selectedOption.gasUsed ?? 0n)
        )
        userOperation.verificationGasLimit = erc4337Estimation.verificationGasLimit
        userOperation.paymasterVerificationGasLimit =
          erc4337Estimation.paymasterVerificationGasLimit
        userOperation.paymasterPostOpGasLimit = erc4337Estimation.paymasterPostOpGasLimit
        userOperation.maxFeePerGas = toBeHex(gasFeePayment.gasPrice)
        userOperation.maxPriorityFeePerGas = toBeHex(gasFeePayment.maxPriorityFeePerGas!)

        const paymaster = erc4337Estimation.paymaster
        if (paymaster.shouldIncludePayment()) this.#addFeePayment()

        const ambireAccount = new Interface(AmbireAccount.abi)
        if (usesOneTimeNonce) {
          const signature = await getExecuteSignature(
            this.#network,
            this.accountOp,
            accountState,
            signer
          )

          // after signing has completed, we wait for the paymaster response
          // so we tell the user
          this.status = { type: SigningStatus.WaitingForPaymaster }
          this.emitUpdate()

          userOperation.callData = ambireAccount.encodeFunctionData('executeMultiple', [
            [[getSignableCalls(this.accountOp), signature]]
          ])
          this.accountOp.signature = signature
        } else {
          userOperation.callData = ambireAccount.encodeFunctionData('executeBySender', [
            getSignableCalls(this.accountOp)
          ])
        }

        if (paymaster.isUsable()) {
          const response = await paymaster.call(
            this.account,
            this.accountOp,
            userOperation,
            this.#network
          )

          if (response.success) {
            const paymasterData = response as PaymasterSuccessReponse
            this.status = { type: SigningStatus.InProgress }
            this.emitUpdate()

            userOperation.paymaster = paymasterData.paymaster
            userOperation.paymasterData = paymasterData.paymasterData
            if (usesOneTimeNonce) userOperation.nonce = getOneTimeNonce(userOperation)
            this.accountOp.gasFeePayment.isSponsored = paymaster.isSponsored()
          } else {
            const errorResponse = response as PaymasterErrorReponse
            this.emitError({
              level: 'major',
              message: errorResponse.message,
              error: errorResponse.error
            })
            this.status = { type: SigningStatus.ReadyToSign }
            this.emitUpdate()
            this.#reEstimate()
            return
          }
        }

        // query the application state from memory to understand if the user
        // hasn't actually rejected the request while waiting for the
        // paymaster to respond
        if (!this.#isSignRequestStillActive()) return

        if (userOperation.requestType === 'standard') {
          const typedData = getTypedData(
            this.#network.chainId,
            this.accountOp.accountAddr,
            getUserOpHash(userOperation, this.#network.chainId)
          )
          const signature = wrapStandard(await signer.signTypedData(typedData))
          userOperation.signature = signature
          this.accountOp.signature = signature
        }
        this.accountOp.asUserOperation = userOperation
      } else {
        // Relayer
        this.#addFeePayment()

        this.accountOp.signature = await getExecuteSignature(
          this.#network,
          this.accountOp,
          accountState,
          signer
        )
      }

      this.status = { type: SigningStatus.Done }
      this.signedAccountOp = structuredClone(this.accountOp)
      this.emitUpdate()
      return this.signedAccountOp
    } catch (error: any) {
      const { message } = getHumanReadableBroadcastError(error)

      this.#emitSigningErrorAndResetToReadyToSign(message)
    }
  }

  toJSON() {
    return {
      ...this,
      isInitialized: this.isInitialized,
      readyToSign: this.readyToSign,
      availableFeeOptions: this.availableFeeOptions,
      accountKeyStoreKeys: this.accountKeyStoreKeys,
      feeToken: this.feeToken,
      feePaidBy: this.feePaidBy,
      speedOptions: this.speedOptions,
      selectedOption: this.selectedOption,
      account: this.account,
      errors: this.errors,
      gasSavedUSD: this.gasSavedUSD
    }
  }
}
