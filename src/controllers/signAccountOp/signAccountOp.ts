/* eslint-disable no-continue */
/* eslint-disable no-restricted-syntax */
/* eslint-disable @typescript-eslint/brace-style */
/* eslint-disable no-await-in-loop */
/* eslint-disable class-methods-use-this */
import {
  AbiCoder,
  formatEther,
  formatUnits,
  getAddress,
  Interface,
  isAddress,
  isBytesLike,
  toBeHex,
  ZeroAddress
} from 'ethers'

import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import ERC20 from '../../../contracts/compiled/IERC20.json'
/* eslint-disable @typescript-eslint/no-floating-promises */
import EmittableError from '../../classes/EmittableError'
import ExternalSignerError from '../../classes/ExternalSignerError'
import { EIP7702Auth } from '../../consts/7702'
import { FEE_COLLECTOR } from '../../consts/addresses'
import {
  EIP_7702_AMBIRE_ACCOUNT,
  EIP_7702_GRID_PLUS,
  EIP_7702_KATANA,
  SINGLETON
} from '../../consts/deploy'
import gasTankFeeTokens from '../../consts/gasTankFeeTokens'
import { ESTIMATE_UPDATE_INTERVAL } from '../../consts/intervals'
import {
  ERRORS,
  RETRY_TO_INIT_ACCOUNT_OP_MSG,
  WARNINGS
} from '../../consts/signAccountOp/errorHandling'
import {
  GAS_TANK_TRANSFER_GAS_USED,
  SA_ERC20_TRANSFER_GAS_USED,
  SA_NATIVE_TRANSFER_GAS_USED
} from '../../consts/signAccountOp/gas'
import { Account, AccountOnchainState, IAccountsController } from '../../interfaces/account'
import { AccountOpAction } from '../../interfaces/actions'
import { IActivityController } from '../../interfaces/activity'
import { Price } from '../../interfaces/assets'
import { ErrorRef } from '../../interfaces/eventEmitter'
import { Hex } from '../../interfaces/hex'
import {
  ExternalKey,
  ExternalSignerControllers,
  IKeystoreController,
  InternalKey,
  Key
} from '../../interfaces/keystore'
import { INetworksController, Network } from '../../interfaces/network'
import { IPhishingController } from '../../interfaces/phishing'
import { IPortfolioController } from '../../interfaces/portfolio'
import { RPCProvider } from '../../interfaces/provider'
import {
  ISignAccountOpController,
  SignAccountOpBanner,
  SignAccountOpError,
  TraceCallDiscoveryStatus,
  Warning
} from '../../interfaces/signAccountOp'
import { getContractImplementation } from '../../libs/7702/7702'
import { isAmbireV1LinkedAccount, isSmartAccount } from '../../libs/account/account'
import { BaseAccount } from '../../libs/account/BaseAccount'
import { getBaseAccount } from '../../libs/account/getBaseAccount'
import {
  AccountOp,
  AccountOpWithId,
  GasFeePayment,
  getSignableCalls
} from '../../libs/accountOp/accountOp'
import { AccountOpIdentifiedBy, SubmittedAccountOp } from '../../libs/accountOp/submittedAccountOp'
import { AccountOpStatus } from '../../libs/accountOp/types'
import { getScamDetectedText } from '../../libs/banners/banners'
import { BROADCAST_OPTIONS, buildRawTransaction } from '../../libs/broadcast/broadcast'
import { PaymasterErrorReponse, PaymasterSuccessReponse, Sponsor } from '../../libs/erc7677/types'
import { getHumanReadableBroadcastError } from '../../libs/errorHumanizer'
import { insufficientPaymasterFunds } from '../../libs/errorHumanizer/errors'
import { bundlerEstimate, fetchBundlerGasPrice } from '../../libs/estimate/estimateBundler'
import {
  Erc4337GasLimits,
  FeePaymentOption,
  FullEstimationSummary
} from '../../libs/estimate/interfaces'
import { humanizeAccountOp } from '../../libs/humanizer'
import { HumanizerWarning, IrCall } from '../../libs/humanizer/interfaces'
import { hasRelayerSupport, relayerAdditionalNetworks } from '../../libs/networks/networks'
import { AbstractPaymaster } from '../../libs/paymaster/abstractPaymaster'
import { GetOptions, TokenResult } from '../../libs/portfolio'
import {
  adjustEntryPointAuthorization,
  get7702Sig,
  get7702UserOpTypedData,
  getEIP712Signature,
  getEntryPointAuthorization,
  getExecuteSignature,
  getTypedData,
  wrapStandard,
  wrapUnprotected
} from '../../libs/signMessage/signMessage'
import { getGasUsed } from '../../libs/singleton/singleton'
import { UserOperation } from '../../libs/userOperation/types'
import {
  getActivatorCall,
  getPackedUserOp,
  getUserOperation,
  getUserOpHash
} from '../../libs/userOperation/userOperation'
import { BundlerSwitcher } from '../../services/bundlers/bundlerSwitcher'
import { GasSpeeds } from '../../services/bundlers/types'
import { failedPaymasters } from '../../services/paymaster/FailedPaymasters'
import shortenAddress from '../../utils/shortenAddress'
import { generateUuid } from '../../utils/uuid'
import wait from '../../utils/wait'
import { EstimationController } from '../estimation/estimation'
import { EstimationStatus } from '../estimation/types'
import EventEmitter from '../eventEmitter/eventEmitter'
import { GasPriceController } from '../gasPrice/gasPrice'
import {
  getFeeSpeedIdentifier,
  getFeeTokenPriceUnavailableWarning,
  getSignificantBalanceDecreaseWarning,
  getTokenUsdAmount,
  getUnknownTokenWarning,
  SignAccountOpType
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

export type SpeedCalc = {
  type: FeeSpeed
  amount: bigint
  simulatedGasLimit: bigint
  amountFormatted: string
  amountUsd: string
  gasPrice: bigint
  disabled: boolean
  maxPriorityFeePerGas?: bigint
}

// declare the statuses we don't want state updates on
export const noStateUpdateStatuses = [
  SigningStatus.InProgress,
  SigningStatus.Done,
  SigningStatus.UpdatesPaused,
  SigningStatus.WaitingForPaymaster
]

export type SignAccountOpUpdateProps = {
  gasPrices?: GasSpeeds
  feeToken?: TokenResult
  paidBy?: string
  paidByKeyType?: Key['type']
  speed?: FeeSpeed
  signingKeyAddr?: Key['addr']
  signingKeyType?: InternalKey['type'] | ExternalKey['type']
  signedTransactionsCount?: number | null
  hasNewEstimation?: boolean
  accountOpData?: Partial<AccountOp>
}

export type OnboardingSuccessProps = {
  submittedAccountOp: SubmittedAccountOp
  accountOp: AccountOp
  type: SignAccountOpType
  fromActionId: string | number
}

export type OnBroadcastSuccess = (props: OnboardingSuccessProps) => Promise<void>

export type OnBroadcastFailed = (accountOp: AccountOp) => void

export class SignAccountOpController extends EventEmitter implements ISignAccountOpController {
  #type: SignAccountOpType

  #callRelayer: Function

  #accounts: IAccountsController

  #keystore: IKeystoreController

  #portfolio: IPortfolioController

  #externalSignerControllers: ExternalSignerControllers

  account: Account

  baseAccount: BaseAccount

  #network: Network

  #phishing: IPhishingController

  // this is not used in the controller directly but it's being read outside
  fromActionId: AccountOpAction['id']

  /**
   * Never modify this directly, use #updateAccountOp instead.
   * Otherwise the accountOp will be out of sync with the one stored
   * in requests/actions.
   */
  #accountOp: AccountOpWithId

  gasPrices?: GasSpeeds

  feeSpeeds: {
    [identifier: string]: SpeedCalc[]
  } = {}

  #paidBy: string | null = null

  feeTokenResult: TokenResult | null = null

  selectedFeeSpeed: FeeSpeed | null = FeeSpeed.Fast

  selectedOption: FeePaymentOption | undefined = undefined

  status: Status | null = null

  broadcastStatus: 'INITIAL' | 'LOADING' | 'SUCCESS' | 'ERROR' = 'INITIAL'

  #isSignRequestStillActive: Function

  signedAccountOp: AccountOp | null

  replacementFeeLow: boolean

  warnings: Warning[] = []

  // indicates whether the transaction gas is sponsored or not
  isSponsored: boolean = false

  // the sponsor data to be displayed, if any
  sponsor: Sponsor | undefined = undefined

  bundlerSwitcher: BundlerSwitcher

  signedTransactionsCount: number | null = null

  // We track the status of token discovery logic (main.traceCall)
  // to ensure the "SignificantBalanceDecrease" banner is displayed correctly.
  // The latest/pending portfolio balance is essential for calculating balance differences.
  // However, during a SWAP, the user may receive a new token that isn't yet included (discovered) in the portfolio.
  // If the discovery process is in-process, and we only rely on portfolio balance change,
  // the banner may be incorrectly triggered due to the perceived balance drop.
  // Once discovery completes and updates the portfolio, the banner will be hidden.
  traceCallDiscoveryStatus: TraceCallDiscoveryStatus = TraceCallDiscoveryStatus.NotStarted

  // the calculated gas used for the transaction estimation
  // it now depends on a variety of options and hence the need to move it
  // as its own property
  gasUsed: bigint = 0n

  provider: RPCProvider

  estimation: EstimationController

  humanization: IrCall[] = []

  humanizationId: number | null = null

  gasPrice: GasPriceController

  #onAccountOpUpdate: (updatedAccountOp: AccountOp) => void

  #traceCall: Function

  shouldSignAuth: {
    type: 'V2Deploy' | '7702'
    text: string
  } | null = null

  /**
   * Should this signAccountOp instance simulate the accountOp it's
   * preparing as well as estimate. Simulaton is required in the
   * original signAccountOp but should be avoided in swap&bridge
   */
  #shouldSimulate: boolean

  #reestimateCounter: number = 0

  #stopRefetching: boolean = false

  #activity: IActivityController

  #onBroadcastSuccess: OnBroadcastSuccess

  #onBroadcastFailed?: OnBroadcastFailed

  #updateBlacklistedStatusPromise: Promise<void> | undefined

  signPromise: Promise<void> | undefined

  broadcastPromise: Promise<void> | undefined

  signAndBroadcastPromise: Promise<void> | undefined

  constructor({
    type,
    callRelayer,
    accounts,
    networks,
    keystore,
    portfolio,
    externalSignerControllers,
    account,
    network,
    activity,
    provider,
    phishing,
    fromActionId,
    accountOp,
    isSignRequestStillActive,
    shouldSimulate,
    onAccountOpUpdate,
    traceCall,
    onBroadcastSuccess,
    onBroadcastFailed
  }: {
    type?: SignAccountOpType
    callRelayer: Function
    accounts: IAccountsController
    networks: INetworksController
    keystore: IKeystoreController
    portfolio: IPortfolioController
    externalSignerControllers: ExternalSignerControllers
    account: Account
    network: Network
    activity: IActivityController
    provider: RPCProvider
    phishing: IPhishingController
    fromActionId: AccountOpAction['id']
    accountOp: AccountOp
    isSignRequestStillActive: Function
    shouldSimulate: boolean
    onAccountOpUpdate?: (updatedAccountOp: AccountOp) => void
    traceCall?: Function
    onBroadcastSuccess: OnBroadcastSuccess
    onBroadcastFailed?: OnBroadcastFailed
  }) {
    super()

    this.#type = type || 'default'
    this.#callRelayer = callRelayer
    this.#accounts = accounts
    this.#keystore = keystore
    this.#portfolio = portfolio
    this.#externalSignerControllers = externalSignerControllers
    this.account = account
    this.baseAccount = getBaseAccount(
      account,
      accounts.accountStates[account.addr]![network.chainId.toString()]!, // ! is safe as otherwise, nothing will work
      keystore.keys.filter((key) => account.associatedKeys.includes(key.addr)),
      network
    )
    this.#network = network
    this.#activity = activity
    this.#phishing = phishing
    this.fromActionId = fromActionId
    this.#accountOp = { ...structuredClone(accountOp), id: generateUuid() }
    this.#isSignRequestStillActive = isSignRequestStillActive

    this.signedAccountOp = null
    this.replacementFeeLow = false
    this.bundlerSwitcher = new BundlerSwitcher(
      network,
      () => {
        return this.status ? noStateUpdateStatuses.indexOf(this.status.type) !== -1 : false
      },
      { canDelegate: this.baseAccount.shouldSignAuthorization(BROADCAST_OPTIONS.byBundler) }
    )
    this.provider = provider
    this.estimation = new EstimationController(
      keystore,
      accounts,
      networks,
      provider,
      portfolio,
      this.bundlerSwitcher,
      this.#activity
    )
    const emptyFunc = () => {}
    this.#traceCall = traceCall ?? emptyFunc
    this.#onAccountOpUpdate = onAccountOpUpdate ?? emptyFunc
    this.gasPrice = new GasPriceController(network, provider, this.baseAccount, () => ({
      estimation: this.estimation,
      readyToSign: this.readyToSign,
      isSignRequestStillActive
    }))
    this.#shouldSimulate = shouldSimulate

    this.#onBroadcastSuccess = onBroadcastSuccess
    if (onBroadcastFailed) this.#onBroadcastFailed = onBroadcastFailed

    this.#load(shouldSimulate)
  }

  get safetyChecksLoading() {
    return !!this.#updateBlacklistedStatusPromise
  }

  get accountOp(): Readonly<AccountOpWithId> {
    return this.#accountOp
  }

  #updateAccountOp(accountOp: Partial<AccountOp>) {
    if (!Object.keys(accountOp).length) return

    const hasUpdatedCalls = !!accountOp.calls

    this.#accountOp = {
      ...this.#accountOp,
      ...accountOp,
      id: hasUpdatedCalls ? generateUuid() : this.#accountOp.id
    }

    this.#onAccountOpUpdate(this.#accountOp)
  }

  #validateAccountOp(): SignAccountOpError | null {
    const invalidAccountOpError =
      'The transaction is missing essential data. Please contact support.'
    if (!this.accountOp.accountAddr || !isAddress(this.accountOp.accountAddr)) {
      return { title: invalidAccountOpError, code: 'INVALID_ACCOUNT_ADDRESS' }
    }
    if (!this.accountOp.chainId || typeof this.accountOp.chainId !== 'bigint') {
      return { title: invalidAccountOpError, code: 'INVALID_CHAIN_ID' }
    }
    if (!this.accountOp.calls || !this.accountOp.calls.length) {
      return { title: invalidAccountOpError, code: 'NO_CALLS' }
    }

    if (
      this.accountOp.calls.some(
        (c) => isAddress(c.to) && getAddress(c.to) === getAddress(this.accountOp.accountAddr)
      )
    )
      return {
        title: 'A malicious transaction found in this batch.',
        code: 'CALL_TO_SELF'
      }
    const warnings: HumanizerWarning[] = this.humanization
      .map((h) => h.warnings)
      .filter((w): w is HumanizerWarning[] => !!w)
      .flat()
    if (warnings.length)
      return {
        title: 'A malicious transaction found in this batch.',
        code: warnings.map((w) => w.code).join(', ')
      }

    let callError: SignAccountOpError | null = null

    for (let index = 0; index < this.accountOp.calls.length; index++) {
      const call = this.accountOp.calls[index]!

      if (!!call.data && !isBytesLike(call.data)) {
        callError = {
          title: 'Invalid bytes-like string in call data.',
          text: 'Please remove all invalid calls if you want to proceed.'
        }
        call.validationError = 'Invalid bytes-like string in call data'

        // Stop after the first invalid call
        break
      } else if (call.to && !isAddress(call.to)) {
        callError = {
          title: 'Invalid to address in call.',
          text: 'Please remove all invalid calls if you want to proceed.'
        }
        call.validationError = 'Invalid to address in call.'

        // Stop after the first invalid call
        break
      }
    }

    return callError
  }

  async #reestimate() {
    if (
      this.#stopRefetching ||
      this.estimation.status === EstimationStatus.Initial ||
      this.estimation.status === EstimationStatus.Loading
    )
      return

    // stop the interval reestimate if the user has done it at least 20 times
    if (this.#reestimateCounter >= 20) this.#stopRefetching = true

    this.#reestimateCounter += 1

    // the first 10 times, reestimate once every 30s; then, slow down
    // the time as the user might just have closed the popup of the extension
    // in a ready-to-estimate state, resulting in meaningless requests
    const waitTime =
      this.#reestimateCounter < 10 ? ESTIMATE_UPDATE_INTERVAL : 10000 * this.#reestimateCounter
    await wait(waitTime)

    if (this.#stopRefetching || !this.#isSignRequestStillActive()) return

    this.#shouldSimulate ? this.simulate(true) : this.estimate()
  }

  #load(shouldSimulate: boolean) {
    this.humanize()
    this.learnTokens()

    this.estimation.onUpdate(() => {
      this.update({ hasNewEstimation: true })
      this.#reestimate()
    })

    this.gasPrice.onUpdate(() => {
      // if gas prices are not set OR there's no bundler estimation,
      // use the gas prices from the controller.
      // otherwise, we're good as gas price also come from the bundlerEstimation
      if (!this.gasPrices || !this.estimation.estimation?.bundlerEstimation) {
        this.update({
          gasPrices: this.gasPrice.gasPrices
        })
      }
    })

    this.gasPrice.onError((error: ErrorRef) => {
      this.emitError(error)
    })

    shouldSimulate ? this.simulate(true) : this.estimate()
    this.gasPrice.fetch()
  }

  humanize() {
    this.humanization = humanizeAccountOp(this.accountOp)
    const currentHumanizationId = Date.now()
    this.humanizationId = currentHumanizationId
    if (this.humanization.length) {
      this.#updateBlacklistedStatusPromise = this.#phishing
        .updateAddressesBlacklistedStatus(
          this.humanization
            .flatMap((call) =>
              (call.fullVisualization ?? [])
                .filter((v) => v.type === 'token' || v.type === 'address')
                .map((v) => v.address)
            )
            .filter((addr): addr is string => Boolean(addr)),
          (addressesStatus) => {
            if (this.humanizationId !== currentHumanizationId) return

            for (const call of this.humanization) {
              if (!call.fullVisualization) continue

              for (const vis of call.fullVisualization) {
                if (
                  (vis.type === 'token' || vis.type === 'address') &&
                  vis.address &&
                  addressesStatus[vis.address]
                ) {
                  vis.verification = addressesStatus[vis.address]
                }
              }
            }
            this.emitUpdate()
          }
        )
        .finally(() => {
          this.#updateBlacklistedStatusPromise = undefined
          this.updateStatus()
        })
    }
    this.emitUpdate()
  }

  learnTokens() {
    const additionalHints: GetOptions['additionalErc20Hints'] = this.humanization
      .map((call: any) =>
        !call.fullVisualization
          ? []
          : call.fullVisualization.map((vis: any) =>
              vis.address && isAddress(vis.address) ? getAddress(vis.address) : ''
            )
      )
      .flat()
      .filter((x: any) => isAddress(x))
    this.#portfolio.addTokensToBeLearned(additionalHints, this.#network.chainId)
  }

  get isInitialized(): boolean {
    return this.estimation.isInitialized()
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
      this.#updateAccountOp({
        signingKeyAddr: this.accountKeyStoreKeys[0]!.addr,
        signingKeyType: this.accountKeyStoreKeys[0]!.type
      })
    }
    // we can set a default paidBy and feeToken here if they aren't any set
  }

  #setGasFeePayment(paidByKeyType?: Key['type']) {
    if (
      this.isInitialized &&
      this.#paidBy &&
      this.selectedFeeSpeed &&
      this.feeTokenResult &&
      this.selectedOption
    ) {
      this.#updateAccountOp({
        gasFeePayment: this.#getGasFeePayment(paidByKeyType)
      })
    }
  }

  // check if speeds are set for the given identifier
  hasSpeeds(identifier: string) {
    return this.feeSpeeds[identifier] !== undefined && this.feeSpeeds[identifier].length
  }

  get errors(): SignAccountOpError[] {
    const accountOpValidationError = this.#validateAccountOp()

    if (accountOpValidationError) return [accountOpValidationError]

    const errors: SignAccountOpError[] = []

    const estimationErrors = this.estimation.errors
    if (estimationErrors.length) return estimationErrors

    const isAmbireV1 = isAmbireV1LinkedAccount(this.account?.creation?.factoryAddr)
    const isAmbireV1AndNetworkNotSupported = isAmbireV1 && !hasRelayerSupport(this.#network)

    // This must be the first error check!
    if (isAmbireV1AndNetworkNotSupported) {
      errors.push({
        title:
          'Ambire v1 accounts are not supported on this network. To interact with this network, please use an Ambire Smart Account or an EOA account. You can still use v1 accounts on any network that is natively integrated with the Ambire web and mobile wallets.'
      })

      // Don't show any other errors
      return errors
    }

    /**
     * A big block for logic separation
     * The above errors (estimation & ambireV1) are okay to be shown
     * even if isInitialized hasn't completed. Otherwise, do not load
     * any errors
     */
    if (!this.isInitialized) return []

    const areGasPricesLoading = typeof this.gasPrices === 'undefined'

    if (!areGasPricesLoading && !this.gasPrices) {
      errors.push({
        title:
          'Gas price information is currently unavailable. This may be due to network congestion or connectivity issues. Please try again in a few moments or check your internet connection.'
      })
    }

    // this error should never happen as availableFeeOptions should always have the native option
    if (!this.isSponsored && !this.estimation.availableFeeOptions.length)
      errors.push({
        title: 'Insufficient funds to cover the fee.'
      })

    // It may occur, only if there are no available signer.
    if (!this.accountOp.signingKeyType || !this.accountOp.signingKeyAddr)
      errors.push({
        title: 'No keys available to sign this transaction.',
        code: 'NO_KEYS_AVAILABLE'
      })

    const currentPortfolio = this.#portfolio.getAccountPortfolioState(this.accountOp.accountAddr)
    const currentPortfolioNetwork = currentPortfolio[this.accountOp.chainId.toString()]

    const currentPortfolioNetworkNative = currentPortfolioNetwork?.result?.tokens.find(
      (token) => token.address === '0x0000000000000000000000000000000000000000'
    )
    if (!this.isSponsored && !currentPortfolioNetworkNative)
      errors.push({
        title:
          'Unable to estimate the transaction fee as fetching the latest price update for the network native token failed. Please try again later.'
      })

    // if there's no gasFeePayment calculate but there is: 1) feeTokenResult
    // 2) selectedOption and 3) gasSpeeds for selectedOption => return an error
    if (
      !this.isSponsored &&
      !this.accountOp.gasFeePayment &&
      this.feeTokenResult &&
      this.selectedOption
    ) {
      const identifier = getFeeSpeedIdentifier(this.selectedOption, this.accountOp.accountAddr)
      if (this.hasSpeeds(identifier))
        errors.push({
          title: 'Please select a token and an account for paying the gas fee.'
        })
    }

    if (
      !this.isSponsored &&
      this.selectedOption &&
      this.accountOp.gasFeePayment &&
      this.selectedOption.availableAmount < this.accountOp.gasFeePayment.amount
    ) {
      const speedCoverage = []
      const identifier = getFeeSpeedIdentifier(this.selectedOption, this.accountOp.accountAddr)

      if (this.feeSpeeds[identifier]) {
        this.feeSpeeds[identifier].forEach((speed) => {
          if (this.selectedOption && this.selectedOption.availableAmount >= speed.amount)
            speedCoverage.push(speed.type)
        })
      }

      if (speedCoverage.length === 0) {
        const isSA = isSmartAccount(this.account)
        const isUnableToCoverWithAllOtherTokens = this.estimation.availableFeeOptions.every(
          (option) => {
            if (option === this.selectedOption) return true
            const optionIdentifier = getFeeSpeedIdentifier(option, this.accountOp.accountAddr)

            const speedsThatCanCover = this.feeSpeeds[optionIdentifier]?.filter(
              (speed) => speed.amount <= option.availableAmount
            )

            return !speedsThatCanCover?.length
          }
        )
        if (isUnableToCoverWithAllOtherTokens) {
          let skippedTokensCount = 0
          const gasTokenNames = gasTankFeeTokens
            .filter(({ chainId, hiddenOnError }) => {
              if (chainId !== this.accountOp.chainId) return false

              if (hiddenOnError) {
                skippedTokensCount++
                return false
              }

              return true
            })
            .map(({ symbol }) => symbol.toUpperCase())
            .join(', ')

          errors.push({
            title: `${ERRORS.eoaInsufficientFunds}${
              isSA
                ? ` Available fee options: USDC in Gas Tank, ${gasTokenNames}${
                    skippedTokensCount ? ' and others' : ''
                  }`
                : ''
            }`
          })
        } else {
          errors.push({
            title: isSA
              ? "Signing is not possible with the selected account's token as it doesn't have sufficient funds to cover the gas payment fee."
              : ERRORS.eoaInsufficientFunds
          })
        }
      } else {
        errors.push({
          title:
            'The selected speed is not available due to insufficient funds. Please select a slower speed.'
        })
      }
    }

    // The signing might fail, tell the user why but allow the user to retry signing,
    // @ts-ignore fix TODO: type mismatch
    if (this.status?.type === SigningStatus.ReadyToSign && !!this.status.error) {
      // @ts-ignore typescript complains, but the error being present gets checked above
      errors.push(this.status.error)
    }

    if (!this.isSponsored && !this.#feeSpeedsLoading && this.selectedOption) {
      const identifier = getFeeSpeedIdentifier(this.selectedOption, this.accountOp.accountAddr)
      if (!this.hasSpeeds(identifier)) {
        if (!this.feeTokenResult?.priceIn.length) {
          errors.push({
            title: `Currently, ${this.feeTokenResult?.symbol} is unavailable as a fee token as we're experiencing troubles fetching its price. Please select another or contact support`
          })
        } else {
          errors.push({
            title:
              'Unable to estimate the transaction fee. Please try changing the fee token or contact support.'
          })
        }
      }
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

    const state = this.#portfolio.getAccountPortfolioState(this.accountOp.accountAddr)

    const significantBalanceDecreaseWarning = getSignificantBalanceDecreaseWarning(
      state,
      this.accountOp.chainId,
      this.traceCallDiscoveryStatus
    )

    const unknownTokenWarnings = getUnknownTokenWarning(state, this.accountOp.chainId)

    if (this.selectedOption) {
      const identifier = getFeeSpeedIdentifier(this.selectedOption, this.accountOp.accountAddr)
      const feeTokenHasPrice = this.feeSpeeds[identifier]?.every((speed) => !!speed.amountUsd)
      const feeTokenPriceUnavailableWarning = getFeeTokenPriceUnavailableWarning(
        !!this.hasSpeeds(identifier),
        !!feeTokenHasPrice
      )

      // push the warning only if the txn is not sponsored
      if (!this.isSponsored && feeTokenPriceUnavailableWarning)
        warnings.push(feeTokenPriceUnavailableWarning)
    }

    if (significantBalanceDecreaseWarning) warnings.push(significantBalanceDecreaseWarning)
    if (unknownTokenWarnings) warnings.push(unknownTokenWarnings)

    // if 7702 EOA that is not ambire
    // and another delegation is there, show the warning
    const broadcastOption = this.selectedOption
      ? this.baseAccount.getBroadcastOption(this.selectedOption, {
          op: this.accountOp,
          isSponsored: this.isSponsored
        })
      : null
    if (
      'is7702' in this.baseAccount &&
      this.baseAccount.is7702 &&
      this.delegatedContract &&
      this.delegatedContract !== ZeroAddress &&
      this.delegatedContract?.toLowerCase() !== EIP_7702_AMBIRE_ACCOUNT.toLowerCase() &&
      this.delegatedContract?.toLowerCase() !== EIP_7702_GRID_PLUS.toLowerCase() &&
      this.delegatedContract?.toLowerCase() !== EIP_7702_KATANA.toLowerCase() &&
      (!this.accountOp.meta || this.accountOp.meta.setDelegation === undefined) &&
      (broadcastOption === BROADCAST_OPTIONS.byBundler ||
        broadcastOption === BROADCAST_OPTIONS.delegation) &&
      WARNINGS.delegationDetected
    ) {
      warnings.push(WARNINGS.delegationDetected)
    }

    const estimationWarnings = this.estimation.calculateWarnings()

    this.warnings = warnings.concat(estimationWarnings)

    this.emitUpdate()
  }

  async simulate(shouldTraceCall: boolean = false) {
    // no simulation / estimation if we're in a signing state
    if (!this.canUpdate()) return

    if (shouldTraceCall) this.#traceCall(this)

    await Promise.all([
      this.#portfolio.simulateAccountOp(this.accountOp),
      this.estimation.estimate(this.accountOp).catch((e) => e)
    ])

    // calculate the warnings after the portfolio is fetched
    this.calculateWarnings()

    const estimation = this.estimation.estimation

    // estimation.flags.hasNonceDiscrepancy is a signal from the estimation
    // that we should update the portfolio to get a correct simulation
    if (estimation && estimation.ambireEstimation && estimation.flags.hasNonceDiscrepancy) {
      this.#updateAccountOp({
        nonce: BigInt(estimation.ambireEstimation.ambireAccountNonce)
      })
      await this.#portfolio.simulateAccountOp(this.accountOp)
    }

    // if the portfolio detects a nonce discrepancy and the estimation is a Success,
    // refetch the account state, resimulate and put the correct nonce in accountOp
    const portfolioState = this.#portfolio.getAccountPortfolioState(this.accountOp.accountAddr)
    const pendingPortfolioState = portfolioState
      ? portfolioState[this.accountOp.chainId.toString()]
      : null
    if (
      this.estimation.status === EstimationStatus.Success &&
      pendingPortfolioState &&
      pendingPortfolioState.criticalError?.simulationErrorMsg &&
      pendingPortfolioState.criticalError?.simulationErrorMsg.indexOf('nonce did not increment') !==
        -1
    ) {
      const pendingAccountState = await this.#accounts.forceFetchPendingState(
        this.accountOp.accountAddr,
        this.accountOp.chainId
      )
      this.#updateAccountOp({
        nonce: pendingAccountState.nonce
      })
      await this.#portfolio.simulateAccountOp(this.accountOp)
    }

    // if there's an estimation error, override the pending results
    if (this.estimation.status === EstimationStatus.Error) {
      this.#portfolio.overrideSimulationResults(this.accountOp)
    }
  }

  async estimate() {
    await this.estimation.estimate(this.accountOp)
  }

  async retry(method: 'simulate' | 'estimate') {
    this.bundlerSwitcher.cleanUp()
    return this[method]()
  }

  update({
    gasPrices,
    feeToken,
    paidBy,
    speed,
    signingKeyAddr,
    signingKeyType,
    signedTransactionsCount,
    hasNewEstimation,
    paidByKeyType,
    accountOpData
  }: SignAccountOpUpdateProps) {
    if (!this.#isSignRequestStillActive()) return

    try {
      // This must be at the top, otherwise it won't be updated because
      // most updates are frozen during the signing process
      if (typeof signedTransactionsCount !== 'undefined') {
        this.signedTransactionsCount = signedTransactionsCount
        // If we add other exclusions we should figure out a way to emitUpdate only once
        this.emitUpdate()
        return
      }

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

      if (this.estimation.status === EstimationStatus.Success) {
        const estimation = this.estimation.estimation as FullEstimationSummary
        if (estimation.ambireEstimation) {
          this.#updateAccountOp({
            nonce: BigInt(estimation.ambireEstimation.ambireAccountNonce)
          })
        }
      }
      // if there's a bundler estimation and the gasPrice for it has resolved, update the UI
      if (this.estimation.estimation && this.estimation.estimation.bundlerGasPrices) {
        // by transforming and setting the bundler gas prices as this.gasPrices, we accomplish two things:
        // 1. we no longer need to wait for the gasPrice controller to complete in order to refresh the UI
        // 2. we make sure we give priority to the bundler prices as they are generally better
        this.gasPrices = this.estimation.estimation.bundlerGasPrices
        // and we're stopping the gas price controller updates as
        // the bundler will provide them
        this.gasPrice.stopRefetching = true
      }

      if (accountOpData) {
        const { calls, ...rest } = accountOpData

        // update all properties except calls
        // calls are handled separately below
        this.#updateAccountOp(rest)

        if (Array.isArray(calls)) {
          // we should update if the arrays are with diff length
          let shouldUpdate = this.accountOp.calls.length !== calls.length

          if (!shouldUpdate) {
            // if they are with the same length, check if some of
            // their properties differ. If they do, we should update
            this.accountOp.calls.forEach((call, i) => {
              const newCall = calls[i]
              if (
                call.to !== newCall?.to ||
                call.data !== newCall?.data ||
                call.value !== newCall?.value ||
                call.fromUserRequestId !== newCall?.fromUserRequestId
              )
                shouldUpdate = true
            })
          }

          // update only if there are differences in the calls array
          // we do this to prevent double estimation problems
          if (shouldUpdate) {
            this.#updateAccountOp({ calls })
            this.humanize()

            const hasNewCalls = this.accountOp.calls.length < calls.length
            if (hasNewCalls) this.learnTokens()
            this.#shouldSimulate ? this.simulate(hasNewCalls) : this.estimate()

            this.#reestimateCounter = 0
          }
        }
      }

      if (gasPrices) this.gasPrices = gasPrices

      if (feeToken && paidBy) {
        this.#paidBy = paidBy
        this.feeTokenResult = feeToken

        if (this.accountOp.gasFeePayment && this.accountOp.gasFeePayment.paidBy !== paidBy) {
          // Reset paidByKeyType if the payer has changed
          // A default value will be set in #setGasFeePayment
          this.accountOp.gasFeePayment.paidByKeyType = null
        }
      }

      if (speed && this.isInitialized) {
        this.selectedFeeSpeed = speed
      }

      if (signingKeyAddr && signingKeyType && this.isInitialized) {
        this.#updateAccountOp({
          signingKeyAddr,
          signingKeyType
        })

        // If the fee is paid by the signer, then we should set the fee payer
        // key type to the signing key type (so the user doesn't have to select
        // the same key type twice)
        if (this.accountOp.gasFeePayment?.paidBy === signingKeyAddr) {
          this.accountOp.gasFeePayment.paidByKeyType = signingKeyType
        }
      }

      // Set defaults, if some of the optional params are omitted
      this.#setDefaults()

      if (
        this.estimation.status === EstimationStatus.Success &&
        this.#paidBy &&
        this.feeTokenResult
      ) {
        const selectedOption = this.estimation.availableFeeOptions.find(
          (option) =>
            option.paidBy === this.#paidBy &&
            option.token.address === this.feeTokenResult!.address &&
            option.token.symbol.toLocaleLowerCase() ===
              this.feeTokenResult!.symbol.toLocaleLowerCase() &&
            option.token.flags.onGasTank === this.feeTokenResult!.flags.onGasTank
        )
        // <Bobby>: trigger setting the real default speed just before
        // setting the first selectedOption. This way we know all the
        // necessary information like available amount for the selected
        // option so we could calculate the fee speed if he doesn't have
        // enough for fast but has enough for slow/medium
        if (selectedOption) this.#setDefaultFeeSpeed(selectedOption)
        this.selectedOption = selectedOption
      }

      if (
        this.estimation.estimation &&
        this.estimation.estimation.bundlerEstimation &&
        this.estimation.estimation.bundlerEstimation.paymaster
      ) {
        // if it was sponsored but it no longer is (fallback case),
        // reset the selectedOption option as we use native for the sponsorship
        // but the user might not actually have any native
        const isSponsorshipFallback =
          this.isSponsored && !this.estimation.estimation.bundlerEstimation.paymaster.isSponsored()

        this.isSponsored = this.estimation.estimation.bundlerEstimation.paymaster.isSponsored()
        this.sponsor =
          this.estimation.estimation.bundlerEstimation.paymaster.getEstimationData()?.sponsor

        if (isSponsorshipFallback) {
          this.selectedOption = this.estimation.availableFeeOptions.length
            ? this.estimation.availableFeeOptions[0]
            : undefined
        }
      }

      // calculate the fee speeds if either there are no feeSpeeds
      // or any of properties for update is requested
      if (
        !Object.keys(this.feeSpeeds).length ||
        Array.isArray(accountOpData?.calls) ||
        gasPrices ||
        this.#paidBy ||
        this.feeTokenResult ||
        hasNewEstimation
      ) {
        this.#updateFeeSpeeds()
      }

      // Here, we expect to have most of the fields set, so we can safely set GasFeePayment
      this.#setGasFeePayment(paidByKeyType)
      this.updateStatus()
      this.calculateWarnings()
    } catch (e: any) {
      this.emitError({
        message: 'Error updating the SignAccountOpController',
        error: e,
        level: 'silent'
      })
    }
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
    if (this.estimation.error) {
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
      this.accountOp.signingKeyAddr &&
      this.accountOp.signingKeyType &&
      this.accountOp.gasFeePayment
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

  destroy() {
    super.destroy()
    this.estimation.destroy()
    this.gasPrice.destroy()
    this.gasPrices = undefined
    this.selectedFeeSpeed = FeeSpeed.Fast
    this.#paidBy = null
    this.feeTokenResult = null
    this.status = null
    this.signedTransactionsCount = null
    this.#stopRefetching = true
    this.gasPrice = null as any
    this.estimation = null as any
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
      .getAccountPortfolioState(this.accountOp.accountAddr)
      [this.accountOp.chainId.toString()]?.result?.tokens.find(
        (token) => token.address === '0x0000000000000000000000000000000000000000'
      )
    if (!native) return null

    // In case the fee token is the native token we don't want to depend to priceIn, as it might not be available.
    if (native.address === feeToken.address && native.chainId === feeToken.chainId)
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
    const result = (amountInWei * nativeRatio) / pow

    // Fixes the edge case where the fee in wei is not zero
    // but the decimals of the token we are converting to
    // cannot represent the amount in wei. Example: 0.(6zeros)1 USDC
    // We are returning 1n which is the smallest possible amount
    // to be represented in USDC
    if (result === 0n && amountInWei !== 0n) {
      return 1n
    }

    return result
  }

  /**
   * Increase the paymaster fee by 10%, the relayer by 5%.
   * This is required because even now, we are broadcasting at a loss
   */
  #increaseFee(amount: bigint, broadcaster: string = 'relayer'): bigint {
    if (broadcaster === 'paymaster') return amount + amount / 10n
    return amount + amount / 20n
  }

  #addExtra(gasInWei: bigint, percentageIncrease: bigint): Hex {
    const percent = 100n / percentageIncrease
    return toBeHex(gasInWei + gasInWei / percent) as Hex
  }

  /**
   * What is a good UX?
   * In the 4337 broadcast model, fee speeds don't make sense. That is
   * because it doesn't matter if you choose slow or fast, if the bundler
   * accepts the userOp, he is obliged to broadcast it as soon as possible.
   * Also, some bundlers return a single value for gas prices, meaning all
   * speed options should have the same cost
   *
   * But Ethereum UX doesn't work liket this.
   * Users expect to see a broadcast speed in the wallet itself and if
   * it's not present, they will find it strange.
   *
   * The soluiton here is to create the illusion of speeds in the 4337
   * broadcast model by increasing them only for the user payment but
   * using the original, bundler provided ones for broadcast.
   * That way we get a better bundler userOp acceptance rate and a
   * normal, intuitive UX
   */
  #getIncreasedPrices(): GasSpeeds | null {
    if (!this.gasPrices) return null

    return {
      slow: {
        maxFeePerGas: this.#addExtra(BigInt(this.gasPrices.slow.maxFeePerGas), 5n),
        maxPriorityFeePerGas: this.#addExtra(BigInt(this.gasPrices.slow.maxPriorityFeePerGas), 5n)
      },
      medium: {
        maxFeePerGas: this.#addExtra(BigInt(this.gasPrices.medium.maxFeePerGas), 7n),
        maxPriorityFeePerGas: this.#addExtra(BigInt(this.gasPrices.medium.maxPriorityFeePerGas), 7n)
      },
      fast: {
        maxFeePerGas: this.#addExtra(BigInt(this.gasPrices.fast.maxFeePerGas), 10n),
        maxPriorityFeePerGas: this.#addExtra(BigInt(this.gasPrices.fast.maxPriorityFeePerGas), 10n)
      },
      ape: {
        maxFeePerGas: this.#addExtra(BigInt(this.gasPrices.ape.maxFeePerGas), 20n),
        maxPriorityFeePerGas: this.#addExtra(BigInt(this.gasPrices.ape.maxPriorityFeePerGas), 20n)
      }
    }
  }

  get #feeSpeedsLoading() {
    return !this.isInitialized || !this.gasPrices
  }

  #setDefaultFeeSpeed(feePaymentOption: FeePaymentOption) {
    // don't update if an option is already set
    if (this.selectedOption) return

    const identifier = getFeeSpeedIdentifier(feePaymentOption, this.account.addr)
    const speeds = this.feeSpeeds[identifier]
    if (!speeds) return

    // set fast if available
    if (speeds.find(({ type, disabled }) => type === FeeSpeed.Fast && !disabled)) {
      this.selectedFeeSpeed = FeeSpeed.Fast
      return
    }

    // set at least slow
    const fastestEnabledSpeed = [...speeds].reverse().find(({ disabled }) => !disabled)
    this.selectedFeeSpeed = fastestEnabledSpeed?.type || FeeSpeed.Slow
  }

  #updateFeeSpeeds() {
    if (this.estimation.status !== EstimationStatus.Success || !this.gasPrices) return

    const estimation = this.estimation.estimation as FullEstimationSummary

    // reset the fee speeds at the beginning to avoid duplications
    this.feeSpeeds = {}

    this.estimation.availableFeeOptions.forEach((option) => {
      // if a calculation has been made, do not make it again
      // EOA pays for SA is the most common case for this scenario
      const identifier = getFeeSpeedIdentifier(option, this.accountOp.accountAddr)
      if (this.hasSpeeds(identifier)) {
        return
      }

      const nativeRatio = this.#getNativeToFeeTokenRatio(option.token)
      const increasedGasPrices = this.#getIncreasedPrices()
      if (!nativeRatio || !this.gasPrices || !increasedGasPrices) {
        this.feeSpeeds[identifier] = []
        return
      }

      // get the gas used for each payment option
      const gasUsed = this.baseAccount.getGasUsed(estimation, {
        feeToken: option.token,
        op: this.accountOp
      })

      // each available fee option should declare it's estimation method
      const broadcastOption = this.baseAccount.getBroadcastOption(option, {
        op: this.accountOp,
        isSponsored: this.isSponsored
      })

      const speeds = ['slow', 'medium', 'fast', 'ape']
      for (let i = 0; i < speeds.length; i++) {
        // we have two prices:
        // receivedPrices, from old lib/bundler
        // and increasedPrices, which we use for the fee only
        const speed = speeds[i] as FeeSpeed
        const receivedPrices = this.gasPrices[speed]
        const increasedPrices = increasedGasPrices[speed]

        let amount
        let simulatedGasLimit: bigint
        let gasPrice
        let maxPriorityFeePerGas

        if (broadcastOption === BROADCAST_OPTIONS.byBundler) {
          if (!estimation.bundlerEstimation) return

          const usesPaymaster = estimation.bundlerEstimation?.paymaster.isUsable()
          simulatedGasLimit =
            BigInt(gasUsed) +
            BigInt(estimation.bundlerEstimation.preVerificationGas) +
            BigInt(option.gasUsed)
          amount = SignAccountOpController.getAmountAfterFeeTokenConvert(
            simulatedGasLimit,
            BigInt(increasedPrices.maxFeePerGas),
            nativeRatio,
            option.token.decimals,
            0n
          )
          if (usesPaymaster) amount = this.#increaseFee(amount, 'paymaster')
          gasPrice = BigInt(receivedPrices.maxFeePerGas)
          maxPriorityFeePerGas = BigInt(receivedPrices.maxPriorityFeePerGas)
        } else if (
          // EOA OR 7702: pays with native by itself
          broadcastOption === BROADCAST_OPTIONS.bySelf ||
          broadcastOption === BROADCAST_OPTIONS.bySelf7702
        ) {
          simulatedGasLimit = gasUsed
          gasPrice = BigInt(increasedPrices.maxFeePerGas)
          maxPriorityFeePerGas = BigInt(increasedPrices.maxPriorityFeePerGas)

          this.accountOp.calls.forEach((call) => {
            if (call.to && getAddress(call.to) === SINGLETON) {
              simulatedGasLimit = getGasUsed(simulatedGasLimit)
            }
          })

          amount = simulatedGasLimit * BigInt(receivedPrices.maxFeePerGas) + option.addedNative
        } else if (broadcastOption === BROADCAST_OPTIONS.byOtherEOA) {
          // Smart account, but EOA pays the fee
          // 7702, and it pays for the fee by itself
          simulatedGasLimit = gasUsed
          amount = simulatedGasLimit * BigInt(receivedPrices.maxFeePerGas) + option.addedNative
          gasPrice = BigInt(increasedPrices.maxFeePerGas)
          maxPriorityFeePerGas = BigInt(increasedPrices.maxPriorityFeePerGas)
        } else {
          // Relayer
          simulatedGasLimit = gasUsed + option.gasUsed
          amount = SignAccountOpController.getAmountAfterFeeTokenConvert(
            simulatedGasLimit,
            BigInt(increasedPrices.maxFeePerGas),
            nativeRatio,
            option.token.decimals,
            option.addedNative
          )
          amount = this.#increaseFee(amount)
          gasPrice = BigInt(increasedPrices.maxFeePerGas)
          maxPriorityFeePerGas = BigInt(increasedPrices.maxPriorityFeePerGas)
        }

        const feeSpeed: SpeedCalc = {
          type: speed,
          simulatedGasLimit,
          amount,
          amountFormatted: formatUnits(amount, Number(option.token.decimals)),
          amountUsd: getTokenUsdAmount(option.token, amount),
          gasPrice,
          // undefined will switch the broadcast type to 0, legacy
          maxPriorityFeePerGas: maxPriorityFeePerGas > 0n ? maxPriorityFeePerGas : undefined,
          disabled: option.availableAmount < amount
        }
        if (this.feeSpeeds[identifier] === undefined) this.feeSpeeds[identifier] = []
        this.feeSpeeds[identifier].push(feeSpeed)
      }
    })
  }

  #getGasFeePayment(paidByKeyType?: Key['type']): GasFeePayment | null {
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
    if (!this.#paidBy) {
      this.emitError({
        level: 'silent',
        message: '',
        error: new Error('SignAccountOpController: paying account not selected')
      })

      return null
    }

    let updatedPaidByKeyType = this.accountOp.gasFeePayment?.paidByKeyType || null

    // Update only if it's not set or it's passed as an argument
    if (paidByKeyType || !updatedPaidByKeyType) {
      const key = this.#keystore.getFeePayerKey(
        this.accountOp.accountAddr,
        this.#paidBy,
        paidByKeyType
      )

      // If paidBy is not an EOA then there will be an error here, because
      // the key of SAs is not the same as the address of the account.
      // We don't care about this here, as the validation is done during broadcast
      if (key instanceof Error) {
        updatedPaidByKeyType = null
      } else {
        updatedPaidByKeyType = key.type
      }
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
    if (!this.estimation.availableFeeOptions.length) {
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
    if (!this.feeSpeeds[identifier] || !this.feeSpeeds[identifier].length) {
      return null
    }

    const chosenSpeed = this.feeSpeeds[identifier]?.find(
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

    return {
      paidBy: this.#paidBy,
      paidByKeyType: updatedPaidByKeyType,
      isGasTank: this.feeTokenResult.flags.onGasTank,
      inToken: this.feeTokenResult.address,
      feeTokenChainId: this.feeTokenResult.chainId,
      amount: chosenSpeed.amount,
      simulatedGasLimit: chosenSpeed.simulatedGasLimit,
      gasPrice: chosenSpeed.gasPrice,
      maxPriorityFeePerGas:
        'maxPriorityFeePerGas' in chosenSpeed ? chosenSpeed.maxPriorityFeePerGas : undefined,
      broadcastOption: this.baseAccount.getBroadcastOption(this.selectedOption, {
        op: this.accountOp,
        isSponsored: this.isSponsored
      })
    }
  }

  get feeToken(): string | null {
    return this.accountOp.gasFeePayment?.inToken || null
  }

  get accountKeyStoreKeys(): Key[] {
    return this.#keystore.keys.filter((key) => this.account.associatedKeys.includes(key.addr))
  }

  get feePayerKeyStoreKeys(): Key[] {
    const feePayer = this.#accounts.accounts.find(
      ({ addr }) => addr === this.accountOp.gasFeePayment?.paidBy
    )

    if (!feePayer) return []

    return this.#keystore.getAccountKeys(feePayer)
  }

  // eslint-disable-next-line class-methods-use-this
  get speedOptions() {
    return Object.values(FeeSpeed) as string[]
  }

  get gasSavedUSD(): number | null {
    if (!this.selectedOption?.token.flags.onGasTank) return null

    const identifier = getFeeSpeedIdentifier(this.selectedOption, this.accountOp.accountAddr)
    const selectedFeeSpeedData = this.feeSpeeds[identifier]?.find(
      (speed) => speed.type === this.selectedFeeSpeed
    )
    const gasPrice = selectedFeeSpeedData?.gasPrice
    if (!gasPrice) return null

    // get the native token from the portfolio to calculate prices
    const native = this.#portfolio
      .getAccountPortfolioState(this.accountOp.accountAddr)
      [this.accountOp.chainId.toString()]?.result?.tokens.find(
        (token) => token.address === '0x0000000000000000000000000000000000000000'
      )
    if (!native) return null
    const nativePrice = native.priceIn.find((price) => price.baseCurrency === 'usd')?.price
    if (!nativePrice) return null

    // 4337 gasUsed is set to 0 in the estimation as we rely
    // on the bundler for the estimation entirely => use hardcode value
    const gasUsedSelectedOption =
      this.selectedOption.gasUsed > 0n ? this.selectedOption.gasUsed : GAS_TANK_TRANSFER_GAS_USED
    const isNativeSelected = this.selectedOption.token.address === ZeroAddress
    const gasUsedNative =
      this.estimation.availableFeeOptions.find(
        (option) => option.token.address === ZeroAddress && !option.token.flags.onGasTank
      )?.gasUsed || SA_NATIVE_TRANSFER_GAS_USED
    const gasUsedERC20 =
      this.estimation.availableFeeOptions.find(
        (option) => option.token.address !== ZeroAddress && !option.token.flags.onGasTank
      )?.gasUsed || SA_ERC20_TRANSFER_GAS_USED

    const gasUsedWithoutGasTank = isNativeSelected ? gasUsedNative : gasUsedERC20
    const gasSavedInNative = formatEther((gasUsedWithoutGasTank - gasUsedSelectedOption) * gasPrice)

    return Number(gasSavedInNative) * nativePrice
  }

  #emitSigningErrorAndResetToReadyToSign(error: string, sendCrashReport?: boolean) {
    this.emitError({ level: 'major', message: error, error: new Error(error), sendCrashReport })
    this.status = { type: SigningStatus.ReadyToSign }

    this.emitUpdate()
  }

  #addFeePayment() {
    // In case of gas tank token fee payment, we need to include one more call to account op
    const abiCoder = new AbiCoder()

    if (this.isSponsored) {
      this.#updateAccountOp({
        feeCall: {
          to: FEE_COLLECTOR,
          value: 0n,
          data: abiCoder.encode(['string', 'uint256', 'string'], ['gasTank', 0n, 'USDC'])
        }
      })

      return
    }

    if (this.accountOp.gasFeePayment!.isGasTank) {
      this.#updateAccountOp({
        feeCall: {
          to: FEE_COLLECTOR,
          value: 0n,
          data: abiCoder.encode(
            ['string', 'uint256', 'string'],
            ['gasTank', this.accountOp.gasFeePayment!.amount, this.feeTokenResult?.symbol]
          )
        }
      })

      return
    }

    if (this.accountOp.gasFeePayment!.inToken === '0x0000000000000000000000000000000000000000') {
      // native payment
      this.#updateAccountOp({
        feeCall: {
          to: FEE_COLLECTOR,
          value: this.accountOp.gasFeePayment!.amount,
          data: '0x'
        }
      })
    } else {
      // token payment
      const ERC20Interface = new Interface(ERC20.abi)
      this.#updateAccountOp({
        feeCall: {
          to: this.accountOp.gasFeePayment!.inToken,
          value: 0n,
          data: ERC20Interface.encodeFunctionData('transfer', [
            FEE_COLLECTOR,
            this.accountOp.gasFeePayment!.amount
          ])
        }
      })
    }
  }

  async #getInitialUserOp(
    shouldReestimate: boolean,
    eip7702Auth?: EIP7702Auth
  ): Promise<UserOperation> {
    const gasFeePayment = this.accountOp.gasFeePayment!
    let erc4337Estimation = this.estimation.estimation!.bundlerEstimation as Erc4337GasLimits
    const accountState = await this.#accounts.getOrFetchAccountOnChainState(
      this.accountOp.accountAddr,
      this.accountOp.chainId
    )

    if (!accountState) {
      throw new EmittableError({
        message: `Missing mandatory transaction data (account state). ${RETRY_TO_INIT_ACCOUNT_OP_MSG}`,
        level: 'major'
      })
    }
    if (!this.gasPrices) {
      throw new EmittableError({
        message: `Missing mandatory transaction data (gas prices). ${RETRY_TO_INIT_ACCOUNT_OP_MSG}`,
        level: 'major'
      })
    }

    if (shouldReestimate) {
      const latestGasPricesResponse = await fetchBundlerGasPrice(
        this.baseAccount,
        this.#network,
        this.bundlerSwitcher
      )
      const latestGasPrices =
        latestGasPricesResponse instanceof Error ? this.gasPrices : latestGasPricesResponse
      const newEstimate = await bundlerEstimate(
        this.baseAccount,
        accountState,
        this.accountOp,
        this.#network,
        [this.selectedOption!.token],
        this.provider,
        latestGasPrices,
        this.bundlerSwitcher,
        eip7702Auth
      )

      if (!(newEstimate instanceof Error)) {
        erc4337Estimation = newEstimate as Erc4337GasLimits
        this.gasPrices = erc4337Estimation.gasPrice

        gasFeePayment.gasPrice = BigInt(this.gasPrices[this.selectedFeeSpeed!].maxFeePerGas)
        gasFeePayment.maxPriorityFeePerGas = BigInt(
          this.gasPrices[this.selectedFeeSpeed!].maxPriorityFeePerGas
        )
      }
    }

    const userOperation = getUserOperation({
      account: this.account,
      accountState,
      accountOp: this.accountOp,
      bundler: this.bundlerSwitcher.getBundler().getName(),
      entryPointSig: this.accountOp.meta?.entryPointAuthorization,
      eip7702Auth,
      hasPendingUserOp: !!(this.#activity.broadcastedButNotConfirmed[this.account.addr] || []).find(
        (accOp) =>
          accOp.accountAddr === this.account.addr &&
          accOp.chainId === this.#network.chainId &&
          !!accOp.asUserOperation
      )
    })

    userOperation.preVerificationGas = erc4337Estimation.preVerificationGas
    userOperation.callGasLimit = toBeHex(
      BigInt(erc4337Estimation.callGasLimit) + this.selectedOption!.gasUsed
    )
    userOperation.verificationGasLimit = erc4337Estimation.verificationGasLimit
    userOperation.maxFeePerGas = toBeHex(gasFeePayment.gasPrice)
    userOperation.maxPriorityFeePerGas = toBeHex(gasFeePayment.maxPriorityFeePerGas!)

    const ambireAccount = new Interface(AmbireAccount.abi)
    userOperation.callData = ambireAccount.encodeFunctionData('executeBySender', [
      getSignableCalls(this.accountOp)
    ])

    return userOperation
  }

  async #getPaymasterUserOp(
    originalUserOp: UserOperation,
    paymaster: AbstractPaymaster,
    eip7702Auth?: EIP7702Auth,
    counter = 0
  ): Promise<{
    required: boolean
    success?: boolean
    userOp?: UserOperation
    errorResponse?: PaymasterErrorReponse
  }> {
    if (!paymaster.isUsable()) return { required: false }

    const localOp = { ...originalUserOp }

    // set the paymaster properties
    const erc4337Estimation = this.estimation.estimation!.bundlerEstimation as Erc4337GasLimits
    localOp.paymasterVerificationGasLimit = erc4337Estimation.paymasterVerificationGasLimit
    localOp.paymasterPostOpGasLimit = erc4337Estimation.paymasterPostOpGasLimit

    // some bundlers (etherspot) don't return values for paymaster gas limits
    // so we need to set them manually
    // other (gelato) may return below the min
    if (paymaster.isEstimateBelowMin(localOp)) {
      const estimationData = paymaster.getEstimationData()!
      localOp.paymasterVerificationGasLimit = estimationData.paymasterVerificationGasLimit
      localOp.paymasterPostOpGasLimit = estimationData.paymasterPostOpGasLimit
    }

    // persist the paymaster properties from the pm_stubData request if any
    if (paymaster.isSponsored() && paymaster.sponsorDataEstimation) {
      if (paymaster.sponsorDataEstimation.paymasterVerificationGasLimit) {
        localOp.paymasterVerificationGasLimit =
          paymaster.sponsorDataEstimation.paymasterVerificationGasLimit
      }
      if (paymaster.sponsorDataEstimation.paymasterPostOpGasLimit) {
        localOp.paymasterPostOpGasLimit = paymaster.sponsorDataEstimation.paymasterPostOpGasLimit
      }
    }
    const response = await paymaster.call(this.account, this.accountOp, localOp, this.#network)

    if (response.success) {
      const paymasterData = response as PaymasterSuccessReponse
      localOp.paymaster = paymasterData.paymaster
      localOp.paymasterData = paymasterData.paymasterData
      return {
        userOp: localOp,
        required: true,
        success: true
      }
    }

    const errorResponse = response as PaymasterErrorReponse
    if (errorResponse.message.indexOf('invalid account nonce') !== -1) {
      // continue on error as this is an attempt for an UX improvement
      await this.#accounts
        .updateAccountState(this.accountOp.accountAddr, 'pending', [this.accountOp.chainId])
        // eslint-disable-next-line no-console
        .catch((e) => console.error(e))
    }

    // auto-retry once if it was the ambire paymaster
    if (paymaster.canAutoRetryOnFailure() && counter === 0) {
      const reestimatedUserOp = await this.#getInitialUserOp(true, eip7702Auth)
      return this.#getPaymasterUserOp(reestimatedUserOp, paymaster, eip7702Auth, counter + 1)
    }

    return {
      required: true,
      success: false,
      errorResponse
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

    if (!this.accountOp.signingKeyAddr || !this.accountOp.signingKeyType) {
      const message = `Unable to sign the transaction. During the preparation step, required signing key information was found missing. ${RETRY_TO_INIT_ACCOUNT_OP_MSG}`
      return this.#emitSigningErrorAndResetToReadyToSign(message)
    }

    if (!this.accountOp.gasFeePayment || !this.selectedOption) {
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

    if (!this.estimation.estimation) {
      const message = `Unable to sign the transaction. During the preparation step, required account key information was found missing. ${RETRY_TO_INIT_ACCOUNT_OP_MSG}`
      return this.#emitSigningErrorAndResetToReadyToSign(message)
    }

    const estimation = this.estimation.estimation as FullEstimationSummary
    const broadcastOption = this.accountOp.gasFeePayment.broadcastOption
    const isUsingPaymaster = !!estimation.bundlerEstimation?.paymaster.isUsable()
    const shouldSignDeployAuth = this.baseAccount.shouldSignDeployAuth(broadcastOption)

    // tell the FE where we are
    if (shouldSignDeployAuth) {
      this.shouldSignAuth = {
        type: 'V2Deploy',
        text: 'Step 1/2 preparing account'
      }
    }

    const isExternalSignerInvolved =
      this.accountOp.gasFeePayment.paidByKeyType !== 'internal' ||
      this.accountOp.signingKeyType !== 'internal'
    const isImmediatelyWaitingForPaymaster =
      broadcastOption === BROADCAST_OPTIONS.byBundler &&
      isUsingPaymaster &&
      !shouldSignDeployAuth &&
      !this.baseAccount.shouldSignAuthorization(BROADCAST_OPTIONS.byBundler)

    if (isImmediatelyWaitingForPaymaster) this.status = { type: SigningStatus.WaitingForPaymaster }

    // we update the FE with the changed status (in progress) only after the checks
    // above confirm everything is okay to prevent two different state updates
    this.emitUpdate()

    if (signer.init) signer.init(this.#externalSignerControllers[this.accountOp.signingKeyType])

    // just in-case: before signing begins, we delete the feeCall;
    // if there's a need for it, it will be added later on in the code.
    // We need this precaution because this could happen:
    // - try to broadcast with the relayer
    // - the feel call gets added
    // - the relayer broadcast fails
    // - the user does another broadcast, this time with EOA pays for SA
    // - the fee call stays, causing a low gas limit revert
    delete this.#accountOp.feeCall

    // delete the activatorCall as a precaution that it won't be added twice
    delete this.#accountOp.activatorCall

    // @EntryPoint activation for SA
    if (this.baseAccount.shouldIncludeActivatorCall()) {
      this.#accountOp.activatorCall = getActivatorCall(this.accountOp.accountAddr)
    }
    this.#updateAccountOp(this.#accountOp)

    const accountState = await this.#accounts.getOrFetchAccountOnChainState(
      this.accountOp.accountAddr,
      this.accountOp.chainId
    )

    if (!accountState) {
      const message = `Unable to sign the transaction. During the preparation step, required transaction information was found missing (account state). ${RETRY_TO_INIT_ACCOUNT_OP_MSG}`
      return this.#emitSigningErrorAndResetToReadyToSign(message)
    }

    try {
      // plain EOA
      if (
        broadcastOption === BROADCAST_OPTIONS.bySelf ||
        broadcastOption === BROADCAST_OPTIONS.bySelf7702
      ) {
        // rawTxn, No SA signatures
        // or 7702, calling executeBySender(). No SA signatures
        this.#updateAccountOp({ signature: '0x' })
      } else if (broadcastOption === BROADCAST_OPTIONS.byOtherEOA) {
        // SA, EOA pays fee. execute() needs a signature

        // fetch the nonce if needed
        const nonce = await this.baseAccount.getBroadcastNonce(
          this.#activity,
          this.accountOp,
          this.provider
        )
        if (nonce !== this.accountOp.nonce) this.#updateAccountOp({ nonce })

        this.#updateAccountOp({
          signature: await getExecuteSignature(this.#network, this.accountOp, accountState, signer)
        })
      } else if (broadcastOption === BROADCAST_OPTIONS.delegation) {
        // a delegation request has been made
        if (!this.accountOp.meta) {
          this.#updateAccountOp({ meta: {} })
        }

        const contract =
          this.accountOp.meta?.setDelegation || this.accountOp.calls.length > 1
            ? getContractImplementation(this.#network.chainId, this.accountKeyStoreKeys)
            : (ZeroAddress as Hex)
        if (this.accountOp.meta) {
          if (isExternalSignerInvolved)
            this.shouldSignAuth = { type: '7702', text: 'Step 1/2 preparing account' }
          this.accountOp.meta.delegation = get7702Sig(
            this.#network.chainId,
            // because we're broadcasting by ourselves, we need to add 1 to the nonce
            // as the sender nonce (the curr acc) gets incremented before the
            // authrorization validation
            accountState.eoaNonce! + 1n,
            contract,
            await signer.sign7702({
              chainId: this.#network.chainId,
              contract,
              nonce: accountState.eoaNonce! + 1n
            })
          )
          if (isExternalSignerInvolved)
            this.shouldSignAuth = { type: '7702', text: 'Step 2/2 signing transaction' }
        }
        this.#updateAccountOp({
          signature: '0x'
        })
      } else if (broadcastOption === BROADCAST_OPTIONS.byBundler) {
        const erc4337Estimation = estimation.bundlerEstimation as Erc4337GasLimits

        const paymaster = erc4337Estimation.paymaster
        if (paymaster.shouldIncludePayment()) this.#addFeePayment()

        // fix three problems:
        // 1) when we do eip7702Auth, initial estimation is not enough
        // 2) we estimate with the gas tank but if the user chooses
        // native, it could result in low gas limit => txn price too low.
        // In both cases, we re-estimate before broadcast
        // 3) some bundlers require a re-estimate before broadcast
        let shouldReestimate =
          (!!erc4337Estimation.feeCallType &&
            paymaster.getFeeCallType([this.selectedOption.token]) !==
              erc4337Estimation.feeCallType) ||
          this.bundlerSwitcher.getBundler().shouldReestimateBeforeBroadcast(this.#network)

        // sign the 7702 authorization if needed
        let eip7702Auth
        if (this.baseAccount.shouldSignAuthorization(BROADCAST_OPTIONS.byBundler)) {
          if (isExternalSignerInvolved)
            this.shouldSignAuth = { type: '7702', text: 'Step 1/2 preparing account' }
          const contract = getContractImplementation(
            this.#network.chainId,
            this.accountKeyStoreKeys
          )
          eip7702Auth = get7702Sig(
            this.#network.chainId,
            accountState.nonce,
            contract,
            await signer.sign7702({
              chainId: this.#network.chainId,
              contract,
              nonce: accountState.nonce
            })
          )
          if (isExternalSignerInvolved)
            this.shouldSignAuth = { type: '7702', text: 'Step 2/2 signing transaction' }
          if (isUsingPaymaster) {
            this.status = { type: SigningStatus.WaitingForPaymaster }
            this.emitUpdate()
          }
          shouldReestimate = true
        }

        if (shouldSignDeployAuth) {
          const epActivatorTypedData = await getEntryPointAuthorization(
            this.account.addr,
            this.#network.chainId,
            accountState.nonce
          )
          const epSignature = await getEIP712Signature(
            epActivatorTypedData,
            this.account,
            accountState,
            signer,
            this.#network
          )
          if (!this.accountOp.meta) {
            this.#updateAccountOp({ meta: {} })
          }
          if (this.accountOp.meta)
            this.accountOp.meta.entryPointAuthorization = adjustEntryPointAuthorization(epSignature)

          // after signing is complete, go to paymaster mode
          if (isUsingPaymaster) {
            this.shouldSignAuth = {
              type: 'V2Deploy',
              text: 'Step 2/2 signing transaction'
            }
            this.status = { type: SigningStatus.WaitingForPaymaster }
            this.emitUpdate()
          }

          shouldReestimate = true
        }

        const initialUserOp = await this.#getInitialUserOp(shouldReestimate, eip7702Auth)
        const paymasterInfo = await this.#getPaymasterUserOp(initialUserOp, paymaster, eip7702Auth)
        if (paymasterInfo.required) {
          if (paymasterInfo.success) {
            this.accountOp.gasFeePayment.isSponsored = paymaster.isSponsored()
            this.status = { type: SigningStatus.InProgress }
            this.emitUpdate()
          } else {
            const errorResponse = paymasterInfo.errorResponse as PaymasterErrorReponse
            this.emitError({
              level: 'major',
              message: errorResponse.message,
              error: errorResponse.error
            })
            this.status = { type: SigningStatus.ReadyToSign }
            this.emitUpdate()
            this.estimate()
            return
          }
        }

        // query the application state from memory to understand if the user
        // hasn't actually rejected the request while waiting for the
        // paymaster to respond
        if (!this.#isSignRequestStillActive()) return

        const userOperation = paymasterInfo.required ? paymasterInfo.userOp! : initialUserOp
        const isHotEOA = accountState.isEOA && this.accountOp.signingKeyType === 'internal'
        if (!isHotEOA) {
          const typedData = getTypedData(
            this.#network.chainId,
            this.accountOp.accountAddr,
            getUserOpHash(userOperation, this.#network.chainId)
          )
          const signature = wrapStandard(await signer.signTypedData(typedData))
          userOperation.signature = signature
          this.#updateAccountOp({ signature, asUserOperation: userOperation })
        } else {
          const typedData = get7702UserOpTypedData(
            this.#network.chainId,
            getSignableCalls(this.accountOp),
            getPackedUserOp(userOperation),
            getUserOpHash(userOperation, this.#network.chainId)
          )
          const signature = wrapUnprotected(await signer.signTypedData(typedData))
          userOperation.signature = signature
          this.#updateAccountOp({ signature, asUserOperation: userOperation })
        }
      } else {
        // Relayer
        this.#addFeePayment()

        // fetch the nonce if needed
        const nonce = await this.baseAccount.getBroadcastNonce(
          this.#activity,
          this.accountOp,
          this.provider
        )
        if (nonce !== this.accountOp.nonce) this.#updateAccountOp({ nonce })

        this.#updateAccountOp({
          signature: await getExecuteSignature(this.#network, this.accountOp, accountState, signer)
        })
      }

      this.status = { type: SigningStatus.Done }
      this.emitUpdate()
    } catch (error: any) {
      const { message } = getHumanReadableBroadcastError(error)

      this.#emitSigningErrorAndResetToReadyToSign(message, error?.sendCrashReport)
    }
  }

  /**
   * There are 4 ways to broadcast an AccountOp:
   *   1. For EOAs, there is only one way to do that. After
   *   signing the transaction, the serialized signed transaction object gets
   *   send to the network.
   *   2. For smart accounts, when EOA pays the fee. Two signatures are needed
   *   for this. The first one is the signature of the AccountOp itself. The
   *   second one is the signature of the transaction that will be executed
   *   by the smart account.
   *   3. For smart accounts that broadcast the ERC-4337 way.
   *   4. for smart accounts, when the Relayer does the broadcast.
   *
   */
  async #broadcast() {
    if (this.status?.type !== SigningStatus.Done) {
      this.throwBroadcastAccountOp({
        message: 'Pending broadcast. Please try again in a bit.'
      })
      return
    }
    const accountOp = this.accountOp
    const estimation = this.estimation.estimation
    const actionId = this.fromActionId
    const bundlerSwitcher = this.bundlerSwitcher
    const contactSupportPrompt = 'Please try again or contact support if the problem persists.'

    if (
      !accountOp ||
      !estimation ||
      !actionId ||
      !accountOp.signingKeyAddr ||
      !accountOp.signingKeyType ||
      !accountOp.signature ||
      !bundlerSwitcher ||
      !accountOp.gasFeePayment
    ) {
      const message = `Missing mandatory transaction details. ${contactSupportPrompt}`
      return this.throwBroadcastAccountOp({ message })
    }

    const account = this.#accounts.accounts.find((acc) => acc.addr === accountOp.accountAddr)

    if (!this.provider) {
      const networkName = this.#network?.name || `network with id ${accountOp.chainId}`
      const message = `Provider for ${networkName} not found. ${contactSupportPrompt}`
      return this.throwBroadcastAccountOp({ message })
    }

    if (!account) {
      const addr = shortenAddress(accountOp.accountAddr, 13)
      const message = `Account with address ${addr} not found. ${contactSupportPrompt}`
      return this.throwBroadcastAccountOp({ message })
    }

    if (!this.#network) {
      const message = `Network with id ${accountOp.chainId} not found. ${contactSupportPrompt}`
      return this.throwBroadcastAccountOp({ message })
    }

    this.broadcastStatus = 'LOADING'
    await this.forceEmitUpdate()

    const accountState = await this.#accounts.getOrFetchAccountOnChainState(
      accountOp.accountAddr,
      accountOp.chainId
    )
    if (!accountState) {
      const message = `Missing mandatory transaction details (account state). ${contactSupportPrompt}`

      return this.throwBroadcastAccountOp({ message, accountState })
    }
    const baseAcc = getBaseAccount(
      account,
      accountState,
      this.#keystore.getAccountKeys(account),
      this.#network
    )
    let transactionRes: {
      txnId?: string
      nonce: number
      identifiedBy: AccountOpIdentifiedBy
    } | null = null

    // broadcasting by EOA is quite the same:
    // 1) build a rawTxn 2) sign 3) broadcast
    // we have one handle, just a diff rawTxn for each case
    const rawTxnBroadcast = [
      BROADCAST_OPTIONS.bySelf,
      BROADCAST_OPTIONS.bySelf7702,
      BROADCAST_OPTIONS.byOtherEOA,
      BROADCAST_OPTIONS.delegation
    ]

    if (rawTxnBroadcast.includes(accountOp.gasFeePayment.broadcastOption)) {
      const multipleTxnsBroadcastRes = []
      const senderAddr =
        accountOp.gasFeePayment.broadcastOption === BROADCAST_OPTIONS.byOtherEOA
          ? accountOp.gasFeePayment.paidBy
          : accountOp.accountAddr
      const nonce = await this.provider.getTransactionCount(senderAddr).catch((e) => e)

      // @precaution
      if (nonce instanceof Error) {
        return this.throwBroadcastAccountOp({
          message: 'RPC error. Please try again',
          accountState
        })
      }

      try {
        const { gasFeePayment } = accountOp

        if (!gasFeePayment.paidBy || !gasFeePayment.paidByKeyType) {
          const message = `Missing gas fee payment details. ${contactSupportPrompt}`
          return this.throwBroadcastAccountOp({ message })
        }

        const signer = await this.#keystore.getSigner(
          gasFeePayment.paidBy,
          gasFeePayment.paidByKeyType
        )
        if (signer.init) {
          signer.init(this.#externalSignerControllers[gasFeePayment.paidByKeyType])
        }

        const txnLength = baseAcc.shouldBroadcastCallsSeparately(accountOp)
          ? accountOp.calls.length
          : 1
        if (txnLength > 1) this.update({ signedTransactionsCount: 0 })
        for (let i = 0; i < txnLength; i++) {
          const currentNonce = nonce + i
          const rawTxn = await buildRawTransaction(
            account,
            accountOp,
            accountState,
            this.provider,
            this.#network,
            currentNonce,
            accountOp.gasFeePayment.broadcastOption,
            accountOp.calls[i]
          )
          const signedTxn =
            accountOp.gasFeePayment.broadcastOption === BROADCAST_OPTIONS.delegation
              ? await signer.signTransactionTypeFour({
                  txnRequest: rawTxn,
                  eip7702Auth: accountOp.meta!.delegation!
                })
              : await signer.signRawTransaction(rawTxn)

          if (accountOp.gasFeePayment.broadcastOption === BROADCAST_OPTIONS.delegation) {
            multipleTxnsBroadcastRes.push({
              hash: await this.provider.send('eth_sendRawTransaction', [signedTxn])
            })
          } else {
            multipleTxnsBroadcastRes.push(await this.provider.broadcastTransaction(signedTxn))
          }
          if (txnLength > 1) this.update({ signedTransactionsCount: i + 1 })

          // record the EOA txn
          this.#callRelayer(`/v2/eoaSubmitTxn/${accountOp.chainId}`, 'POST', {
            rawTxn: signedTxn
          }).catch((e: any) => {
            // eslint-disable-next-line no-console
            console.log('failed to record EOA txn to relayer', accountOp.chainId)
            // eslint-disable-next-line no-console
            console.log(e)
          })
        }

        transactionRes = {
          nonce:
            accountOp.gasFeePayment.broadcastOption === BROADCAST_OPTIONS.byOtherEOA
              ? Number(accountOp.nonce)
              : nonce,
          identifiedBy: {
            type: txnLength > 1 ? 'MultipleTxns' : 'Transaction',
            identifier: multipleTxnsBroadcastRes.map((res) => res.hash).join('-')
          },
          txnId: multipleTxnsBroadcastRes[multipleTxnsBroadcastRes.length - 1]?.hash
        }
      } catch (error: any) {
        // eslint-disable-next-line no-console
        console.error('Error broadcasting', error)
        // for multiple txn cases
        // if a batch of 5 txn is sent to Ledger for sign but the user reject
        // #3, #1 and #2 are already broadcast. Reduce the accountOp's call
        // to #1 and #2 and create a submittedAccountOp
        //
        // unless it's the build-in swap - we want to throw an error and
        // allow the user to retry in this case
        if (multipleTxnsBroadcastRes.length && this.#type !== 'one-click-swap-and-bridge') {
          transactionRes = {
            nonce,
            identifiedBy: {
              type: 'MultipleTxns',
              identifier: multipleTxnsBroadcastRes.map((res) => res.hash).join('-')
            },
            txnId: multipleTxnsBroadcastRes[multipleTxnsBroadcastRes.length - 1]?.hash
          }
        } else {
          return this.throwBroadcastAccountOp({ error, accountState })
        }
      } finally {
        this.update({ signedTransactionsCount: null })
      }
    }
    // Smart account, the ERC-4337 way
    else if (accountOp.gasFeePayment?.broadcastOption === BROADCAST_OPTIONS.byBundler) {
      const userOperation = accountOp.asUserOperation
      if (!userOperation) {
        const accAddr = shortenAddress(accountOp.accountAddr, 13)
        const message = `Trying to broadcast an ERC-4337 request but userOperation is not set for the account with address ${accAddr}`
        return this.throwBroadcastAccountOp({ message, accountState })
      }

      // broadcast through bundler's service
      let userOperationHash
      const bundler = bundlerSwitcher.getBundler()
      try {
        userOperationHash = await bundler.broadcast(userOperation, this.#network)
      } catch (e: any) {
        let retryMsg

        // if the signAccountOp is still active (it should be)
        // try to switch the bundler and ask the user to try again
        const switcher = this.bundlerSwitcher
        this.updateStatus(SigningStatus.ReadyToSign)

        if (switcher.canSwitch(baseAcc)) {
          switcher.switch()
          this.simulate()
          this.gasPrice.fetch()
          retryMsg = 'Broadcast failed because bundler was down. Please try again'
        }

        return this.throwBroadcastAccountOp({
          error: e,
          accountState,
          provider: this.provider,
          network: this.#network,
          message: retryMsg
        })
      }
      if (!userOperationHash) {
        return this.throwBroadcastAccountOp({
          message: 'Bundler broadcast failed. Please try broadcasting by an EOA or contact support.'
        })
      }

      transactionRes = {
        nonce: Number(userOperation.nonce),
        identifiedBy: {
          type: 'UserOperation',
          identifier: userOperationHash,
          bundler: bundler.getName()
        }
      }
    }
    // Smart account, the Relayer way
    else {
      try {
        const body = {
          gasLimit: Number(accountOp.gasFeePayment!.simulatedGasLimit),
          txns: getSignableCalls(accountOp),
          signature: accountOp.signature,
          signer: { address: accountOp.signingKeyAddr },
          nonce: Number(accountOp.nonce)
        }
        const additionalRelayerNetwork = relayerAdditionalNetworks.find(
          (net) => net.chainId === this.#network.chainId
        )
        const relayerChainId = additionalRelayerNetwork
          ? additionalRelayerNetwork.chainId
          : accountOp.chainId
        const response = await this.#callRelayer(
          `/identity/${accountOp.accountAddr}/${relayerChainId}/submit`,
          'POST',
          body
        )
        if (!response.success) throw new Error(response.message)

        transactionRes = {
          txnId: response.txId,
          nonce: Number(accountOp.nonce),
          identifiedBy: {
            type: 'Relayer',
            identifier: response.id
          }
        }
      } catch (error: any) {
        return this.throwBroadcastAccountOp({ error, accountState, isRelayer: true })
      }
    }

    if (!transactionRes)
      return this.throwBroadcastAccountOp({
        message: 'No transaction response received after being broadcasted.'
      })

    const submittedAccountOp: SubmittedAccountOp = {
      ...accountOp,
      status: AccountOpStatus.BroadcastedButNotConfirmed,
      txnId: transactionRes.txnId,
      nonce: BigInt(transactionRes.nonce),
      identifiedBy: transactionRes.identifiedBy,
      timestamp: new Date().getTime(),
      isSingletonDeploy: !!accountOp.calls.find(
        (call) => call.to && getAddress(call.to) === SINGLETON
      )
    }

    await this.#onBroadcastSuccess({
      submittedAccountOp,
      accountOp: this.accountOp,
      type: this.#type,
      fromActionId: this.fromActionId
    })

    // Allow the user to broadcast a new transaction;
    // Important: Update signAndBroadcastAccountOp to SUCCESS/INITIAL only after the action is resolved:
    // `await this.resolveAccountOpAction(submittedAccountOp, actionId)`
    // Otherwise, a new request could be added to a previously broadcast action that will resolve shortly,
    // leaving the new request 'orphaned' in the background without being attached to any action.
    this.broadcastStatus = 'SUCCESS'
    await this.forceEmitUpdate()
    this.broadcastStatus = 'INITIAL'
    await this.forceEmitUpdate()
    return Promise.resolve()
  }

  async signAndBroadcast() {
    if (this.signAndBroadcastPromise) {
      return this.emitError({
        level: 'major',
        message:
          'Please wait, the signing/broadcasting process of this transaction is already in progress.',
        error: new Error(
          `The signing/broadcasting process is already in progress. (signAndBroadcast func). Status: ${
            this.status
          }. BroadcastStatus: ${this.broadcastStatus}. Signing key: ${
            this.accountOp.signingKeyType
          }. Fee payer key: ${this.accountOp.gasFeePayment?.paidByKeyType}. Type: ${this.#type}.`
        )
      })
    }

    this.signAndBroadcastPromise = (async () => {
      this.signPromise = this.sign().finally(() => {
        this.signPromise = undefined
      })
      await this.signPromise
      if (this.status && this.status.type === SigningStatus.Done) {
        this.broadcastPromise = this.#broadcast().finally(() => {
          this.broadcastPromise = undefined
        })
        await this.broadcastPromise
      }
    })().finally(() => {
      this.signAndBroadcastPromise = undefined
    })

    await this.signAndBroadcastPromise
  }

  get isSignInProgress() {
    return !!this.signPromise
  }

  get isBroadcastInProgress() {
    return !!this.broadcastPromise
  }

  get isSignAndBroadcastInProgress() {
    return !!this.signAndBroadcastPromise
  }

  throwBroadcastAccountOp({
    message: humanReadableMessage,
    error: _err,
    accountState,
    isRelayer = false,
    provider = undefined,
    network = undefined
  }: {
    message?: string
    error?: Error | EmittableError | ExternalSignerError
    accountState?: AccountOnchainState
    isRelayer?: boolean
    provider?: RPCProvider
    network?: Network
  }) {
    const originalMessage = _err?.message
    let message = humanReadableMessage
    let isReplacementFeeLow = false

    this.broadcastStatus = 'ERROR'
    this.forceEmitUpdate()
    this.broadcastStatus = 'INITIAL'
    this.forceEmitUpdate()

    if (originalMessage) {
      if (originalMessage.includes('replacement fee too low')) {
        message =
          'Replacement fee is insufficient. Fees have been automatically adjusted so please try submitting your transaction again.'
        isReplacementFeeLow = true
        this.simulate(false)
      } else if (originalMessage.includes('INSUFFICIENT_PRIVILEGE')) {
        message = accountState?.isV2
          ? 'Broadcast failed because of a pending transaction. Please try again'
          : 'Signer key not supported on this network'
      } else if (
        originalMessage.includes('underpriced') ||
        originalMessage.includes('Fee confirmation failed')
      ) {
        if (originalMessage.includes('underpriced')) {
          message =
            'Transaction fee underpriced. Please select a higher transaction speed and try again'
        }

        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.gasPrice.fetch()
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.simulate(false)
      } else if (originalMessage.includes('Failed to fetch') && isRelayer) {
        message =
          'Currently, the Ambire relayer seems to be down. Please try again a few moments later or broadcast with an EOA account'
      } else if (
        originalMessage.includes('INVALID_ACCOUNT_NONCE') ||
        originalMessage.includes('user nonce')
      ) {
        message = 'Pending transaction detected. Please try again in a few seconds'
        this.#accounts
          .updateAccountState(this.accountOp.accountAddr, 'pending', [this.accountOp.chainId])
          .then(() => this.simulate())
          .catch((e) => e)
      }
    }

    if (!message) {
      message = getHumanReadableBroadcastError(_err || new Error('')).message

      // if the message states that the paymaster doesn't have sufficient amount,
      // add it to the failedPaymasters to disable it until a top-up is made
      if (message.includes(insufficientPaymasterFunds) && provider && network) {
        failedPaymasters.addInsufficientFunds(provider, network).then(() => {
          this.simulate(false)
        })
      }
      if (message.includes('the selected fee is too low')) {
        this.gasPrice.fetch()
      }
    }

    // To enable another try for signing in case of broadcast fail
    // broadcast is called in the FE only after successful signing
    this.updateStatus(SigningStatus.ReadyToSign, isReplacementFeeLow)

    if (this.#onBroadcastFailed) {
      this.#onBroadcastFailed(this.#accountOp)
    }

    this.emitError({
      level: 'major',
      message,
      error: _err || new Error(message),
      sendCrashReport: _err && 'sendCrashReport' in _err ? _err.sendCrashReport : undefined
    })
    throw new Error(message) // so that broadcast resolves with an error status
  }

  canUpdate(): boolean {
    return !this.status || noStateUpdateStatuses.indexOf(this.status.type) === -1
  }

  setDiscoveryStatus(status: TraceCallDiscoveryStatus) {
    this.traceCallDiscoveryStatus = status
  }

  get type() {
    return this.#type
  }

  get delegatedContract(): Hex | null {
    if (!this.#accounts.accountStates[this.account.addr]) return null
    if (!this.#accounts.accountStates[this.account.addr]![this.#network.chainId.toString()])
      return null
    return this.#accounts.accountStates[this.account.addr]![this.#network.chainId.toString()]!
      .delegatedContract
  }

  get banners(): SignAccountOpBanner[] {
    const banners: SignAccountOpBanner[] = []

    const visualizations = this.humanization.flatMap((call) => call.fullVisualization ?? [])

    // Keep only token/address types AND ensure uniqueness by address
    const addressVisualizations = Array.from(
      new Map(
        visualizations
          .filter((v) => (v.type === 'token' || v.type === 'address') && v.address)
          .map((v) => [v.address, v]) // key: address → value: visualization
      ).values()
    )

    const blacklistedItems = addressVisualizations.filter((v) => v.verification === 'BLACKLISTED')

    if (blacklistedItems.length) {
      banners.push({
        id: 'blacklisted-addresses-error-banner',
        type: 'error',
        text: getScamDetectedText(blacklistedItems)
      })
    } else {
      const hasFailedToGet = visualizations.some(
        (v) => (v.type === 'token' || v.type === 'address') && v.verification === 'FAILED_TO_GET'
      )

      if (hasFailedToGet) {
        banners.push({
          id: 'blacklisted-addresses-warning-banner',
          type: 'warning',
          text: "We couldn't check the addresses or tokens in this transaction for malicious activity. Proceed with caution."
        })
      }
    }

    return banners
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      isInitialized: this.isInitialized,
      type: this.type,
      readyToSign: this.readyToSign,
      safetyChecksLoading: this.safetyChecksLoading,
      accountKeyStoreKeys: this.accountKeyStoreKeys,
      feePayerKeyStoreKeys: this.feePayerKeyStoreKeys,
      feeToken: this.feeToken,
      speedOptions: this.speedOptions,
      selectedOption: this.selectedOption,
      account: this.account,
      errors: this.errors,
      gasSavedUSD: this.gasSavedUSD,
      delegatedContract: this.delegatedContract,
      accountOp: this.accountOp,
      isSignInProgress: this.isSignInProgress,
      isBroadcastInProgress: this.isBroadcastInProgress,
      isSignAndBroadcastInProgress: this.isSignAndBroadcastInProgress,
      banners: this.banners
    }
  }
}
