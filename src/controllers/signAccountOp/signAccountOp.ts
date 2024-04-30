/* eslint-disable no-restricted-syntax */
import { AbiCoder, Contract, formatUnits, getAddress, Interface, toBeHex } from 'ethers'

import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import EntryPointAbi from '../../../contracts/compiled/EntryPoint.json'
import ERC20 from '../../../contracts/compiled/IERC20.json'
import { FEE_COLLECTOR } from '../../consts/addresses'
import { AMBIRE_PAYMASTER, ERC_4337_ENTRYPOINT, SINGLETON } from '../../consts/deploy'
import { Account, AccountStates } from '../../interfaces/account'
import { ExternalSignerControllers, Key } from '../../interfaces/keystore'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { Storage } from '../../interfaces/storage'
import { isSmartAccount } from '../../libs/account/account'
import { AccountOp, GasFeePayment, getSignableCalls } from '../../libs/accountOp/accountOp'
import { EstimateResult, FeePaymentOption } from '../../libs/estimate/interfaces'
import { GasRecommendation, getCallDataAdditionalByNetwork } from '../../libs/gasPrice/gasPrice'
import { callsHumanizer } from '../../libs/humanizer'
import { IrCall } from '../../libs/humanizer/interfaces'
import { Price, TokenResult } from '../../libs/portfolio'
import { getExecuteSignature, getTypedData, wrapStandard } from '../../libs/signMessage/signMessage'
import { getGasUsed } from '../../libs/singleton/singleton'
import {
  getActivatorCall,
  getDummyEntryPointSig,
  getOneTimeNonce,
  getUserOperation,
  isErc4337Broadcast,
  shouldIncludeActivatorCall,
  shouldUseOneTimeNonce,
  shouldUsePaymaster
} from '../../libs/userOperation/userOperation'
import EventEmitter from '../eventEmitter/eventEmitter'
import { KeystoreController } from '../keystore/keystore'
import { PortfolioController } from '../portfolio/portfolio'
import { SettingsController } from '../settings/settings'
import { getFeeSpeedIdentifier, getTokenUsdAmount } from './helper'

export enum SigningStatus {
  EstimationError = 'estimation-error',
  UnableToSign = 'unable-to-sign',
  ReadyToSign = 'ready-to-sign',
  InProgress = 'in-progress',
  Done = 'done'
}

type UnableToSignStatus = {
  type: SigningStatus.UnableToSign
  error: string
}

export type Status =
  | UnableToSignStatus
  | {
      type: Exclude<SigningStatus, SigningStatus.UnableToSign>
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
const noStateUpdateStatuses = [SigningStatus.InProgress, SigningStatus.Done]

const NON_CRITICAL_ERRORS = {
  feeUsdEstimation: 'Unable to estimate the transaction fee in USD.'
}
const CRITICAL_ERRORS = {
  eoaInsufficientFunds: 'Insufficient funds to cover the fee.'
}

export class SignAccountOpController extends EventEmitter {
  #keystore: KeystoreController

  #portfolio: PortfolioController

  #settings: SettingsController

  #externalSignerControllers: ExternalSignerControllers

  #storage: Storage

  #fetch: Function

  account: Account

  #accountStates: AccountStates

  #network: NetworkDescriptor

  accountOp: AccountOp

  gasPrices: GasRecommendation[] | null = null

  #estimation: EstimateResult | null = null

  feeSpeeds: {
    [identifier: string]: SpeedCalc[]
  } = {}

  paidBy: string | null = null

  feeTokenResult: TokenResult | null = null

  selectedFeeSpeed: FeeSpeed = FeeSpeed.Fast

  selectedOption: FeePaymentOption | undefined = undefined

  humanReadable: IrCall[] = []

  status: Status | null = null

  gasUsedTooHigh: boolean

  gasUsedTooHighAgreed: boolean

  #callRelayer: Function

  constructor(
    keystore: KeystoreController,
    portfolio: PortfolioController,
    settings: SettingsController,
    externalSignerControllers: ExternalSignerControllers,
    account: Account,
    accountStates: AccountStates,
    network: NetworkDescriptor,
    accountOp: AccountOp,
    storage: Storage,
    fetch: Function,
    callRelayer: Function
  ) {
    super()
    this.#keystore = keystore
    this.#portfolio = portfolio
    this.#settings = settings
    this.#externalSignerControllers = externalSignerControllers
    this.account = account
    this.#accountStates = accountStates
    this.#network = network
    this.accountOp = structuredClone(accountOp)
    this.#storage = storage
    this.#fetch = fetch
    this.#callRelayer = callRelayer

    this.#humanizeAccountOp()
    this.gasUsedTooHigh = false
    this.gasUsedTooHighAgreed = false
  }

  get isInitialized(): boolean {
    return !!this.#estimation
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
      this.accountOp!.gasFeePayment = this.#getGasFeePayment()
    }
  }

  // check if speeds are set for the given identifier
  hasSpeeds(identifier: string) {
    return this.feeSpeeds[identifier] !== undefined && this.feeSpeeds[identifier].length
  }

  #humanizeAccountOp() {
    callsHumanizer(
      this.accountOp,
      this.#storage,
      this.#fetch,
      (humanizedCalls) => {
        this.humanReadable = humanizedCalls
        this.emitUpdate()
      },
      (err) => this.emitError(err)
    ).catch((err) => this.emitError(err))
  }

  get errors(): string[] {
    const errors: string[] = []

    if (!this.isInitialized) return errors

    // if there's an estimation error, show it
    if (this.#estimation?.error) {
      errors.push(this.#estimation.error.message)
    }

    const availableFeeOptions = this.availableFeeOptions
    if (!availableFeeOptions.length) errors.push(CRITICAL_ERRORS.eoaInsufficientFunds)

    // This error should not happen, as in the update method we are always setting a default signer.
    // It may occur, only if there are no available signer.
    if (!this.accountOp.signingKeyType || !this.accountOp.signingKeyAddr)
      errors.push('Please select a signer to sign the transaction.')

    const currentPortfolioNetwork =
      this.#portfolio.latest[this.accountOp.accountAddr][this.accountOp.networkId]
    const currentPortfolioNetworkNative = currentPortfolioNetwork?.result?.tokens.find(
      (token) => token.address === '0x0000000000000000000000000000000000000000'
    )
    if (!currentPortfolioNetworkNative)
      errors.push(
        'Unable to estimate the transaction fee as fetching the latest price update for the network native token failed. Please try again later.'
      )

    // if there's no gasFeePayment calculate but there is: 1) feeTokenResult
    // 2) selectedOption and 3) gasSpeeds for selectedOption => return an error
    if (!this.accountOp.gasFeePayment && this.feeTokenResult && this.selectedOption) {
      const identifier = getFeeSpeedIdentifier(this.selectedOption, this.accountOp.accountAddr)
      if (this.hasSpeeds(identifier))
        errors.push('Please select a token and an account for paying the gas fee.')
    }

    if (
      this.selectedOption &&
      this.accountOp.gasFeePayment &&
      this.selectedOption.availableAmount < this.accountOp.gasFeePayment.amount
    ) {
      // show a different error message depending on whether SA/EOA
      errors.push(
        isSmartAccount(this.account)
          ? "Signing is not possible with the selected account's token as it doesn't have sufficient funds to cover the gas payment fee."
          : CRITICAL_ERRORS.eoaInsufficientFunds
      )
    }

    // If signing fails, we know the exact error and aim to forward it to the remaining errors,
    // as the application will exclusively render `signAccountOp.errors`.
    if (this.status?.type === SigningStatus.UnableToSign) {
      errors.push(this.status.error)
    }

    // The signing might fail, tell the user why but allow the user to retry signing,
    // @ts-ignore fix TODO: type mismatch
    if (this.status?.type === SigningStatus.ReadyToSign && !!this.status.error) {
      // @ts-ignore typescript complains, but the error being present gets checked above
      errors.push(this.status.error)
    }

    if (!this.#feeSpeedsLoading && this.selectedOption) {
      const identifier = getFeeSpeedIdentifier(this.selectedOption, this.accountOp.accountAddr)
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

    if (this.selectedOption) {
      const identifier = getFeeSpeedIdentifier(this.selectedOption, this.accountOp.accountAddr)
      if (
        this.hasSpeeds(identifier) &&
        this.feeSpeeds[identifier].some((speed) => speed.amountUsd === null)
      ) {
        errors.push(NON_CRITICAL_ERRORS.feeUsdEstimation)
      }
    }

    return errors
  }

  get readyToSign() {
    return !!this.status && this.status?.type === SigningStatus.ReadyToSign
  }

  update({
    gasPrices,
    estimation,
    feeToken,
    paidBy,
    speed,
    signingKeyAddr,
    signingKeyType,
    accountOp,
    gasUsedTooHighAgreed
  }: {
    accountOp?: AccountOp
    gasPrices?: GasRecommendation[]
    estimation?: EstimateResult | null
    feeToken?: TokenResult
    paidBy?: string
    speed?: FeeSpeed
    signingKeyAddr?: Key['addr']
    signingKeyType?: Key['type']
    gasUsedTooHighAgreed?: boolean
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

    if (accountOp) {
      this.accountOp = structuredClone(accountOp)
      this.#humanizeAccountOp()
    }

    if (gasPrices) this.gasPrices = gasPrices

    if (estimation) {
      this.gasUsedTooHigh = estimation.gasUsed > 10000000n
      this.#estimation = estimation
      // on each estimation update, set the newest account nonce
      this.accountOp.nonce = BigInt(estimation.currentAccountNonce)
    }

    // if estimation is undefined, do not clear the estimation.
    // We do this only if strictly specified as null
    if (estimation === null) this.#estimation = null

    if (this.#estimation?.error) {
      this.status = { type: SigningStatus.EstimationError }
    }

    if (feeToken && paidBy) {
      this.paidBy = paidBy
      this.feeTokenResult = feeToken
    }

    if (speed && this.isInitialized) {
      this.selectedFeeSpeed = speed
    }

    if (signingKeyAddr && signingKeyType && this.isInitialized) {
      this.accountOp!.signingKeyAddr = signingKeyAddr
      this.accountOp!.signingKeyType = signingKeyType
    }

    if (gasUsedTooHighAgreed !== undefined) this.gasUsedTooHighAgreed = gasUsedTooHighAgreed

    // Set defaults, if some of the optional params are omitted
    this.#setDefaults()

    if (this.#estimation && this.paidBy && this.feeTokenResult) {
      this.selectedOption = this.availableFeeOptions.find(
        (option) =>
          option.paidBy === this.paidBy &&
          option.token.address === this.feeTokenResult!.address &&
          option.token.symbol.toLocaleLowerCase() ===
            this.feeTokenResult!.symbol.toLocaleLowerCase() &&
          option.token.flags.onGasTank === this.feeTokenResult!.flags.onGasTank
      )
    }

    // calculate the fee speeds if either there are no feeSpeeds
    // or any of properties for update is requested
    if (!Object.keys(this.feeSpeeds).length || accountOp || gasPrices || estimation) {
      this.#updateFeeSpeeds()
    }

    // Here, we expect to have most of the fields set, so we can safely set GasFeePayment
    this.#setGasFeePayment()
    this.updateStatusToReadyToSign()
  }

  updateStatusToReadyToSign() {
    const isInTheMiddleOfSigning = this.status?.type === SigningStatus.InProgress

    const criticalErrors = this.errors.filter(
      (error) => !Object.values(NON_CRITICAL_ERRORS).includes(error)
    )

    if (
      this.isInitialized &&
      this.#estimation &&
      this.accountOp?.signingKeyAddr &&
      this.accountOp?.signingKeyType &&
      this.accountOp?.gasFeePayment &&
      !criticalErrors.length &&
      // Update if status is NOT already set (that's the initial state update)
      // or in general if the user is not in the middle of signing (otherwise
      // it resets the loading state back to ready to sign)
      (!this.status || !isInTheMiddleOfSigning) &&
      // if the gas used is too high, do not allow the user to sign
      // until he explicitly agrees to the risks
      (!this.gasUsedTooHigh || this.gasUsedTooHighAgreed)
    ) {
      this.status = { type: SigningStatus.ReadyToSign }
    } else {
      this.status = null
    }
    this.emitUpdate()
  }

  reset() {
    this.gasPrices = null
    this.#estimation = null
    this.selectedFeeSpeed = FeeSpeed.Fast
    this.paidBy = null
    this.feeTokenResult = null
    this.status = null
    this.humanReadable = []
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
    const native = this.#portfolio.latest[this.accountOp.accountAddr][
      this.accountOp.networkId
    ]?.result?.tokens.find(
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

  get #feeSpeedsLoading() {
    return !this.isInitialized || !this.gasPrices
  }

  #updateFeeSpeeds() {
    if (this.#feeSpeedsLoading) return

    // reset the fee speeds at the beginning to avoid duplications
    this.feeSpeeds = {}

    const gasUsed = this.#estimation!.gasUsed
    const callDataAdditionalGasCost = getCallDataAdditionalByNetwork(
      this.accountOp!,
      this.#network,
      this.#accountStates![this.accountOp!.accountAddr][this.accountOp!.networkId]
    )

    this.availableFeeOptions.forEach((option) => {
      // if a calculation has been made, do not make it again
      // EOA pays for SA is the most common case for this scenario
      const identifier = getFeeSpeedIdentifier(option, this.accountOp.accountAddr)
      if (this.hasSpeeds(identifier)) {
        return
      }

      const nativeRatio = this.#getNativeToFeeTokenRatio(option.token)
      if (!nativeRatio) {
        this.feeSpeeds[identifier] = []
        return
      }

      const erc4337GasLimits = this.#estimation?.erc4337GasLimits
      if (erc4337GasLimits) {
        const speeds: SpeedCalc[] = []
        const usesPaymaster = shouldUsePaymaster(this.#network)

        for (const [speed, speedValue] of Object.entries(erc4337GasLimits.gasPrice)) {
          const simulatedGasLimit =
            BigInt(erc4337GasLimits.callGasLimit) + BigInt(erc4337GasLimits.preVerificationGas)
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

      ;(this.gasPrices || []).forEach((gasRecommendation) => {
        let amount
        let simulatedGasLimit

        let gasPrice = 0n
        // As GasRecommendation type is a result of the union between GasPriceRecommendation and Gas1559Recommendation,
        // then the both types don't have the same interface/props.
        // Therefore, we need to check for a prop existence, before accessing it.
        // GasPriceRecommendation
        if ('gasPrice' in gasRecommendation) gasPrice = gasRecommendation.gasPrice
        // Gas1559Recommendation
        if ('baseFeePerGas' in gasRecommendation)
          gasPrice = gasRecommendation.baseFeePerGas + gasRecommendation.maxPriorityFeePerGas

        // EOA
        if (!isSmartAccount(this.account)) {
          simulatedGasLimit = gasUsed

          if (getAddress(this.accountOp.calls[0].to) === SINGLETON) {
            simulatedGasLimit = getGasUsed(simulatedGasLimit)
          }

          amount = simulatedGasLimit * gasPrice + option.addedNative
        } else if (option.paidBy !== this.accountOp!.accountAddr) {
          // Smart account, but EOA pays the fee
          simulatedGasLimit = gasUsed + callDataAdditionalGasCost
          amount = simulatedGasLimit * gasPrice + option.addedNative
        } else {
          // Relayer
          simulatedGasLimit = gasUsed + callDataAdditionalGasCost + option.gasUsed!
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
          maxPriorityFeePerGas:
            'maxPriorityFeePerGas' in gasRecommendation
              ? gasRecommendation.maxPriorityFeePerGas
              : undefined
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
    const identifier = getFeeSpeedIdentifier(this.selectedOption, this.accountOp.accountAddr)
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

    const accountState = this.#accountStates[this.accountOp.accountAddr][this.accountOp.networkId]
    return {
      paidBy: this.paidBy,
      isERC4337: isErc4337Broadcast(this.#network, accountState),
      isGasTank: this.feeTokenResult.flags.onGasTank,
      inToken: this.feeTokenResult.address,
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
    if (!this.isInitialized) return []

    // FeeOptions having amount
    return this.#estimation!.feePaymentOptions.filter((feeOption) => feeOption.availableAmount)
  }

  get accountKeyStoreKeys(): Key[] {
    return this.#keystore.keys.filter((key) => this.account.associatedKeys.includes(key.addr))
  }

  // eslint-disable-next-line class-methods-use-this
  get speedOptions() {
    return Object.values(FeeSpeed) as string[]
  }

  #setSigningError(error: string, type = SigningStatus.UnableToSign) {
    this.status = { type, error }
    this.emitUpdate()
  }

  #addFeePayment() {
    // In case of gas tank token fee payment, we need to include one more call to account op
    const abiCoder = new AbiCoder()

    if (this.accountOp!.gasFeePayment!.isGasTank) {
      this.accountOp!.feeCall = {
        to: FEE_COLLECTOR,
        value: 0n,
        data: abiCoder.encode(
          ['string', 'uint256', 'string'],
          ['gasTank', this.accountOp!.gasFeePayment!.amount, this.feeTokenResult?.symbol]
        )
      }

      return
    }

    if (this.accountOp!.gasFeePayment!.inToken === '0x0000000000000000000000000000000000000000') {
      // native payment
      this.accountOp!.feeCall = {
        to: FEE_COLLECTOR,
        value: this.accountOp!.gasFeePayment!.amount,
        data: '0x'
      }
    } else {
      // token payment
      const ERC20Interface = new Interface(ERC20.abi)
      this.accountOp!.feeCall = {
        to: this.accountOp!.gasFeePayment!.inToken,
        value: 0n,
        data: ERC20Interface.encodeFunctionData('transfer', [
          FEE_COLLECTOR,
          this.accountOp!.gasFeePayment!.amount
        ])
      }
    }
  }

  async sign() {
    if (!this.readyToSign)
      return this.#setSigningError(
        'We are unable to sign your transaction as some of the mandatory signing fields have not been set.'
      )

    // when signing begings, we stop immediatelly state updates on the controller
    // by changing the status to InProgress. Check update() for more info
    this.status = { type: SigningStatus.InProgress }

    if (!this.accountOp?.signingKeyAddr || !this.accountOp?.signingKeyType)
      return this.#setSigningError('We cannot sign your transaction. Please choose a signer key.')

    if (!this.accountOp?.gasFeePayment)
      return this.#setSigningError('Please select a token and an account for paying the gas fee.')

    const signer = await this.#keystore.getSigner(
      this.accountOp.signingKeyAddr,
      this.accountOp.signingKeyType
    )
    if (!signer) return this.#setSigningError('no available signer')

    // we update the FE with the changed status (in progress) only after the checks
    // above confirm everything is okay to prevent two different state updates
    this.emitUpdate()

    const gasFeePayment = this.accountOp.gasFeePayment

    if (signer.init) signer.init(this.#externalSignerControllers[this.accountOp.signingKeyType])
    const accountState =
      this.#accountStates![this.accountOp!.accountAddr][this.accountOp!.networkId]

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
    // if the account is v2 without the entry point signer being a signer
    // and the network is 4337 but doesn't have a paymaster, we should activate
    // the entry point and therefore do so here
    if (shouldIncludeActivatorCall(this.#network, accountState)) {
      this.accountOp.activatorCall = getActivatorCall(this.accountOp.accountAddr)
    }

    try {
      // In case of EOA account
      if (!this.account.creation) {
        if (this.accountOp.calls.length !== 1)
          return this.#setSigningError(
            'Tried to sign an EOA transaction with multiple or zero calls.'
          )

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
        const userOperation = getUserOperation(
          this.account,
          accountState,
          this.accountOp,
          await getDummyEntryPointSig(this.accountOp.accountAddr, this.#network.chainId, signer)
        )
        userOperation.preVerificationGas = this.#estimation!.erc4337GasLimits!.preVerificationGas
        userOperation.callGasLimit = this.#estimation!.erc4337GasLimits!.callGasLimit
        userOperation.verificationGasLimit =
          this.#estimation!.erc4337GasLimits!.verificationGasLimit
        userOperation.maxFeePerGas = toBeHex(gasFeePayment.gasPrice)
        userOperation.maxPriorityFeePerGas = toBeHex(gasFeePayment.maxPriorityFeePerGas!)
        const usesOneTimeNonce = shouldUseOneTimeNonce(userOperation)
        const usesPaymaster = shouldUsePaymaster(this.#network)

        if (usesPaymaster) {
          this.#addFeePayment()
        }

        const ambireAccount = new Interface(AmbireAccount.abi)
        if (usesOneTimeNonce) {
          const signature = await getExecuteSignature(
            this.#network,
            this.accountOp,
            accountState,
            signer
          )
          userOperation.callData = ambireAccount.encodeFunctionData('executeMultiple', [
            [[getSignableCalls(this.accountOp), signature]]
          ])
          this.accountOp.signature = signature
        } else {
          userOperation.callData = ambireAccount.encodeFunctionData('executeBySender', [
            getSignableCalls(this.accountOp)
          ])
        }

        if (usesPaymaster) {
          try {
            const response = await this.#callRelayer(
              `/v2/paymaster/${this.accountOp.networkId}/sign`,
              'POST',
              {
                // send without the requestType prop
                userOperation: (({ requestType, activatorCall, ...o }) => o)(userOperation),
                paymaster: AMBIRE_PAYMASTER
              }
            )
            userOperation.paymaster = response.data.paymaster
            userOperation.paymasterData = response.data.paymasterData
            if (usesOneTimeNonce) {
              userOperation.nonce = getOneTimeNonce(userOperation)
            }
          } catch (e: any) {
            return this.#setSigningError(e.message)
          }
        }

        if (userOperation.requestType === 'standard') {
          const provider = this.#settings.providers[this.accountOp.networkId]
          const entryPoint = new Contract(ERC_4337_ENTRYPOINT, EntryPointAbi, provider)
          const typedData = getTypedData(
            this.#network.chainId,
            this.accountOp.accountAddr,
            await entryPoint.getUserOpHash(userOperation)
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
      this.emitUpdate()
    } catch (error: any) {
      this.#setSigningError(error?.message, SigningStatus.ReadyToSign)
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
      errors: this.errors
    }
  }
}
