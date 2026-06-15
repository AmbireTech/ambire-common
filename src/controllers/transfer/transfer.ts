import { formatUnits, isAddress, parseUnits } from 'ethers'

import { BindedRelayerCall } from '@/libs/relayerCall/relayerCall'

import { FEE_COLLECTOR } from '../../consts/addresses'
import { IAccountsController } from '../../interfaces/account'
import { IActivityController } from '../../interfaces/activity'
import { IAddressBookController } from '../../interfaces/addressBook'
import { IDappsController } from '../../interfaces/dapp'
import { AddressState } from '../../interfaces/domains'
import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter'
import { ExternalSignerControllers, IKeystoreController } from '../../interfaces/keystore'
import { INetworksController } from '../../interfaces/network'
import { IPhishingController } from '../../interfaces/phishing'
import { IPortfolioController } from '../../interfaces/portfolio'
import { IProvidersController } from '../../interfaces/provider'
import { ISelectedAccountController } from '../../interfaces/selectedAccount'
import { ISignAccountOpController } from '../../interfaces/signAccountOp'
import { IStorageController } from '../../interfaces/storage'
import {
  AddressPoisoningMatch,
  ITransferController,
  TransferUpdate
} from '../../interfaces/transfer'
import { IUiController, View } from '../../interfaces/ui'
import { getBaseAccount } from '../../libs/account/getBaseAccount'
import { AccountOp } from '../../libs/accountOp/accountOp'
import { Call } from '../../libs/accountOp/types'
import { AssetType } from '../../libs/defiPositions/types'
import { getAmbirePaymasterService } from '../../libs/erc7677/erc7677'
import { HumanizerMeta } from '../../libs/humanizer/interfaces'
import { randomId } from '../../libs/humanizer/utils'
import { TokenResult } from '../../libs/portfolio'
import { getTokenAmount, getTokenBalanceInUSD } from '../../libs/portfolio/helpers'
import {
  getAmountAfterFeeReserve,
  getAmountAfterFeeSync,
  getSanitizedAmount
} from '../../libs/transfer/amount'
import { getTransferRequestParams } from '../../libs/transfer/userRequest'
import {
  validateSendTransferAddress,
  validateSendTransferAmount,
  Validation
} from '../../services/validations'
import { getIsViewOnly } from '../../utils/accounts'
import { getAddressFromAddressState } from '../../utils/domains'
import {
  convertTokenPriceToBigInt,
  getSafeAmountFromFieldValue
} from '../../utils/numbers/formatters'
import { generateUuid } from '../../utils/uuid'
import EventEmitter from '../eventEmitter/eventEmitter'
import { OnBroadcastSuccess, SignAccountOpController } from '../signAccountOp/signAccountOp'

const CONVERSION_PRECISION = 16
const CONVERSION_PRECISION_POW = BigInt(10 ** CONVERSION_PRECISION)

const DEFAULT_ADDRESS_STATE: AddressState = {
  fieldValue: '',
  resolvedAddress: '',
  resolvedAddressType: null,
  isDomainResolving: false
}

const DEFAULT_VALIDATION_FORM_MSGS: {
  [key in 'amount' | 'recipientAddress']: Validation
} = {
  amount: {
    severity: 'error',
    message: ''
  },
  recipientAddress: {
    message: '',
    severity: 'error'
  }
}

const HARD_CODED_CURRENCY = 'usd'
const isTransfer = (route: string | undefined) => {
  return route === 'transfer' || route === 'top-up-gas-tank'
}

type SignAccountOpControllerMethods = {
  [K in keyof SignAccountOpController as SignAccountOpController[K] extends (...args: any) => any
    ? K
    : never]: SignAccountOpController[K]
}

export class TransferController extends EventEmitter implements ITransferController {
  #callRelayer: BindedRelayerCall

  #storage: IStorageController

  #networks: INetworksController

  #addressBook: IAddressBookController

  #selectedToken: TokenResult | null = null

  #selectedAccount: ISelectedAccountController

  #humanizerInfo: HumanizerMeta | null = null

  // session / debounce
  #currentTransferSessionId: string | null = null

  /**
   * The field value for the amount input. Not sanitized and can contain
   * invalid values. Use #getSafeAmountFromFieldValue() to get a formatted value.
   */
  amount = ''

  amountInFiat = ''

  /**
   * A counter used to trigger UI updates when a form values is
   * changed programmatically by the controller.
   */
  programmaticUpdateCounter = 0

  amountFieldMode: 'fiat' | 'token' = 'token'

  addressState: AddressState = { ...DEFAULT_ADDRESS_STATE }

  areDefaultsSet = false

  isRecipientAddressUnknown = false

  isRecipientAddressUnknownAgreed = false

  isRecipientHumanizerKnownTokenOrSmartContract = false

  isRecipientAddressViewOnly = false

  isTopUp: boolean = false

  #shouldSkipTransactionQueuedModal: boolean = false

  #isMaxAmountSelected: boolean = false

  #maxFeeReservation: { key: string; amount: bigint } | null = null

  #accounts: IAccountsController

  #keystore: IKeystoreController

  #portfolio: IPortfolioController

  #externalSignerControllers: ExternalSignerControllers

  #providers: IProvidersController

  #phishing: IPhishingController

  #dapps: IDappsController

  #relayerUrl: string

  isRecipientAddressFirstTimeSend: boolean = false

  lastSentToRecipientAt: Date | null = null

  // Set only for first-time sends when the recipient matches a known address
  // by both prefix and suffix, which may indicate address poisoning.
  addressPoisoningMatch: AddressPoisoningMatch | null = null

  signAccountOpController: ISignAccountOpController | null = null

  latestBroadcastedAccountOp: AccountOp | null = null

  latestBroadcastedToken: TokenResult | null = null

  hasProceeded: boolean = false

  // Holds the initial load promise, so that one can wait until it completes
  #initialLoadPromise?: Promise<void>

  #activity: IActivityController

  #onBroadcastSuccess: OnBroadcastSuccess

  #ui: IUiController

  #tokens: TokenResult[] = []

  #getHasAnotherTransferViewOpen() {
    const views = this.#ui.views.filter((view) => isTransfer(view.currentRoute))

    return views.length >= 1
  }

  constructor(
    callRelayer: BindedRelayerCall,
    storage: IStorageController,
    humanizerInfo: HumanizerMeta,
    selectedAccount: ISelectedAccountController,
    networks: INetworksController,
    addressBook: IAddressBookController,
    accounts: IAccountsController,
    keystore: IKeystoreController,
    portfolio: IPortfolioController,
    activity: IActivityController,
    externalSignerControllers: ExternalSignerControllers,
    providers: IProvidersController,
    phishing: IPhishingController,
    dapps: IDappsController,
    relayerUrl: string,
    onBroadcastSuccess: OnBroadcastSuccess,
    ui: IUiController,
    eventEmitterRegistry?: IEventEmitterRegistryController
  ) {
    super(eventEmitterRegistry)

    this.#callRelayer = callRelayer
    this.#storage = storage
    this.#humanizerInfo = humanizerInfo
    this.#selectedAccount = selectedAccount
    this.#networks = networks
    this.#addressBook = addressBook

    this.#accounts = accounts
    this.#keystore = keystore
    this.#portfolio = portfolio
    this.#activity = activity
    this.#externalSignerControllers = externalSignerControllers
    this.#providers = providers
    this.#phishing = phishing
    this.#dapps = dapps
    this.#relayerUrl = relayerUrl
    this.#onBroadcastSuccess = onBroadcastSuccess
    this.#ui = ui

    this.#initialLoadPromise = this.#load().finally(() => {
      this.#initialLoadPromise = undefined
    })

    this.#ui.uiEvent.on('updateView', (view: View) => {
      if (isTransfer(view.currentRoute)) {
        this.#enterTransfer(view)
      } else if (isTransfer(view.previousRoute) && !this.#getHasAnotherTransferViewOpen()) {
        // Update view is handled differently as it implies that the user has
        // navigated out to another route, thus state persistence is irrelevant
        this.unloadScreen(view.type, { isNavigateOut: true })
      }
    })

    this.#ui.uiEvent.on('removeView', (view: View) => {
      if (!isTransfer(view.currentRoute) || this.#getHasAnotherTransferViewOpen()) return

      this.unloadScreen(view.type)
    })

    this.#selectedAccount.onUpdate(async (forceEmit) => {
      // Don't update anything if the transfer screen is not open or
      // if the user has proceeded with the transfer and is about to sign/broadcast
      if (!this.#currentTransferSessionId || this.hasProceeded) return
      this.#setTokens()

      if (this.#selectedAccount.portfolio.isReadyToVisualize && !this.selectedToken) {
        this.#setDefaultSelectedToken()

        if (this.selectedToken || this.#selectedAccount.portfolio.isAllReady)
          this.areDefaultsSet = true
      }

      this.propagateUpdate(forceEmit)
    })

    this.emitUpdate()
  }

  #enterTransfer(view: View) {
    this.#ensureTransferSessionId()

    const nextIsTopUp = view.currentRoute === 'top-up-gas-tank'
    const searchParams = view.searchParams

    const isFormInitialized = this.hasPersistedState && this.areDefaultsSet
    const isSameMode = this.isTopUp === nextIsTopUp
    const hasNoSearchParams = Object.keys(searchParams || {}).length === 0

    const shouldKeepExistingForm = isFormInitialized && isSameMode && hasNoSearchParams

    if (shouldKeepExistingForm) {
      if (!this.areDefaultsSet) {
        this.areDefaultsSet = true
        this.emitUpdate()
      }

      return
    }

    const tokenParams =
      searchParams && searchParams.address && searchParams.chainId
        ? {
            address: String(searchParams.address),
            chainId: String(searchParams.chainId)
          }
        : undefined

    this.isTopUp = nextIsTopUp
    this.#setTokens()
    this.#setDefaultSelectedToken(tokenParams)
    this.areDefaultsSet = true
    this.emitUpdate()
  }

  #ensureTransferSessionId() {
    if (!this.#currentTransferSessionId) {
      this.#currentTransferSessionId = String(randomId())
    }
  }

  get transferSessionId() {
    return this.#currentTransferSessionId
  }

  #setTokens() {
    const tokens = this.#selectedAccount.portfolio.tokens
      .filter((token) => {
        const hasAmount = Number(getTokenAmount(token)) > 0
        const isVisible = !token.flags.isHidden

        if (this.isTopUp) {
          const tokenNetwork = this.#networks.networks.find(
            (network) => network.chainId === token.chainId
          )

          return (
            hasAmount &&
            isVisible &&
            tokenNetwork?.hasRelayer &&
            token.flags.canTopUpGasTank &&
            !token.flags.onGasTank
          )
        }

        return (
          hasAmount &&
          isVisible &&
          !token.flags.onGasTank &&
          !token.flags.rewardsType &&
          token.flags.defiTokenType !== AssetType.Borrow
        )
      })
      .sort((a, b) => {
        const tokenAinUSD = getTokenBalanceInUSD(a)
        const tokenBinUSD = getTokenBalanceInUSD(b)

        return tokenBinUSD - tokenAinUSD
      })

    this.#tokens = tokens

    if (this.selectedToken) {
      this.selectedToken =
        this.#tokens.find(
          (t) =>
            t.address === this.selectedToken?.address &&
            t.chainId === this.selectedToken?.chainId &&
            !t.flags.onGasTank
        ) ||
        this.#tokens[0] ||
        null
    }
  }

  #setDefaultSelectedToken(tokenData?: { address: string; chainId: string | number }) {
    if (!this.#tokens.length) return

    const tokenAddress = tokenData?.address.toLowerCase() || ''
    const tokenChainId = tokenData?.chainId.toString() || ''

    let newSelectedToken = null

    // 1. If a valid address is provided → try to match it
    if (tokenAddress) {
      newSelectedToken = this.#tokens.find(
        (t: TokenResult) =>
          t.address.toLowerCase() === tokenAddress &&
          tokenChainId === t.chainId.toString() &&
          t.flags.onGasTank === false
      )
    }

    // 2. If no valid address or no match → fallback to first token
    if (!newSelectedToken) newSelectedToken = this.#tokens[0]

    // 3. Only update if changed
    if (
      newSelectedToken &&
      (!this.selectedToken ||
        this.selectedToken.address !== newSelectedToken.address ||
        this.selectedToken.chainId !== newSelectedToken.chainId)
    ) {
      this.selectedToken = newSelectedToken
      // 4. Or if the user has no tokens
    } else if (!newSelectedToken) {
      this.selectedToken = null
      this.areDefaultsSet = true
    }
  }

  async #load() {
    this.#shouldSkipTransactionQueuedModal = await this.#storage.get(
      'shouldSkipTransactionQueuedModal',
      false
    )

    await this.#selectedAccount.initialLoadPromise
  }

  get shouldSkipTransactionQueuedModal() {
    return this.#shouldSkipTransactionQueuedModal
  }

  set shouldSkipTransactionQueuedModal(value: boolean) {
    this.#shouldSkipTransactionQueuedModal = value
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.#storage.set('shouldSkipTransactionQueuedModal', value)
    this.emitUpdate()
  }

  // every time when updating selectedToken update the amount and maxAmount of the form
  set selectedToken(token: TokenResult | null) {
    // Disallow the update of the selected token if the user has proceeded.
    // If we update it, latestBroadcastedToken may not correspond to the token that
    // is being sent in the latestBroadcastedAccountOp.
    if (this.hasProceeded) return

    if (!token || Number(getTokenAmount(token)) === 0) {
      this.#selectedToken = null
      this.#isMaxAmountSelected = false
      this.#resetMaxFeeReservation()
      this.#setAmountAndNotifyUI('')
      this.#setAmountInFiatAndNotifyUI('')
      this.amountFieldMode = 'token'
      return
    }

    const prevSelectedToken = { ...this.selectedToken }

    this.#selectedToken = token

    if (
      prevSelectedToken?.address !== token?.address ||
      prevSelectedToken?.chainId !== token?.chainId
    ) {
      this.#isMaxAmountSelected = false
      this.#resetMaxFeeReservation()
      if (!token.priceIn.length) this.amountFieldMode = 'token'
      this.#setAmountAndNotifyUI('')
      this.#setAmountInFiatAndNotifyUI('')
    }
  }

  get selectedToken() {
    return this.#selectedToken
  }

  get tokens() {
    return this.#tokens
  }

  get maxAmount(): string {
    if (!this.selectedToken || getTokenAmount(this.selectedToken) === 0n) return '0'

    return formatUnits(getTokenAmount(this.selectedToken), this.selectedToken.decimals)
  }

  get maxAmountInFiat(): string {
    if (!this.selectedToken || getTokenAmount(this.selectedToken) === 0n) return '0'

    const tokenPrice = this.selectedToken?.priceIn.find(
      (p) => p.baseCurrency === HARD_CODED_CURRENCY
    )?.price
    if (!tokenPrice || !Number(this.maxAmount)) return '0'

    const maxAmount = getTokenAmount(this.selectedToken)
    const { tokenPriceBigInt, tokenPriceDecimals } = convertTokenPriceToBigInt(tokenPrice)

    // Multiply the max amount by the token price. The calculation is done in big int to avoid precision loss
    return formatUnits(
      maxAmount * tokenPriceBigInt,
      // Shift the decimal point by the number of decimals in the token price
      this.selectedToken.decimals + tokenPriceDecimals
    )
  }

  resetForm(shouldDestroyAccountOp = true) {
    this.#isMaxAmountSelected = false
    this.amount = ''
    this.amountInFiat = ''
    this.amountFieldMode = 'token'
    this.addressState = { ...DEFAULT_ADDRESS_STATE }
    this.#onRecipientAddressChange()
    // This MUST be incremented and not reset to zero, because the UI relies on
    // the change of this value. If the value was 0 and is reset to 0, the UI
    // would not detect a change.
    if (this.programmaticUpdateCounter === 0) {
      this.programmaticUpdateCounter += 1
    } else {
      this.programmaticUpdateCounter = 0
    }

    if (shouldDestroyAccountOp) {
      this.destroySignAccountOp()
    }

    this.emitUpdate()
  }

  #fetchRecipientAccountStateIfNeeded() {
    if (!this.isInitialized) return

    const recipientAcc = this.#accounts.accounts.find((a) => a.addr === this.recipientAddress)
    if (recipientAcc && this.selectedToken?.chainId) {
      const state =
        this.#accounts.accountStates[recipientAcc.addr]?.[this.selectedToken.chainId.toString()]
      if (!state) {
        this.#accounts
          .getOrFetchAccountOnChainState(recipientAcc.addr, this.selectedToken.chainId)
          .catch((e) => {
            console.log('Failed to get the account on chain state:', e)
          })
      }
    }
  }

  get validationFormMsgs() {
    if (!this.isInitialized) return DEFAULT_VALIDATION_FORM_MSGS

    const validationFormMsgsNew = DEFAULT_VALIDATION_FORM_MSGS

    if (this.#humanizerInfo && this.#selectedAccount.account?.addr) {
      // if the recipientAcc is an account in the extension
      // & the account state is not fetched for it, fetch it
      // so that we could validate the account properly
      // example: Safe accounts may not be deployed on certain networks
      const recipientAcc = this.#accounts.accounts.find((a) => a.addr === this.recipientAddress)

      validationFormMsgsNew.recipientAddress = validateSendTransferAddress(
        this.recipientAddress,
        this.#selectedAccount.account.addr,
        this.isRecipientAddressUnknownAgreed,
        this.isRecipientAddressUnknown,
        this.isRecipientHumanizerKnownTokenOrSmartContract,
        !!this.addressState.resolvedAddress,
        this.addressState.isDomainResolving,
        this.#networks.networks,
        this.#accounts.accountStates,
        recipientAcc,
        this.selectedToken?.chainId,
        this.isRecipientAddressFirstTimeSend,
        this.lastSentToRecipientAt,
        this.addressPoisoningMatch
      )
    }

    // Validate the amount
    if (this.selectedToken) {
      validationFormMsgsNew.amount = validateSendTransferAmount(this.amount, this.selectedToken)
    }

    return validationFormMsgsNew
  }

  get isFormValid() {
    if (!this.isInitialized) return false

    // if the amount is set, it's enough in topUp mode
    if (this.isTopUp) {
      return (
        this.selectedToken &&
        validateSendTransferAmount(this.amount, this.selectedToken).severity === 'success'
      )
    }

    const areFormFieldsValid = this.validationFormMsgs.amount.severity === 'success'

    return areFormFieldsValid && !this.addressState.isDomainResolving
  }

  get isInitialized() {
    return (
      !!this.#humanizerInfo &&
      !!this.#selectedAccount.account?.addr &&
      !!this.#networks.networks.length
    )
  }

  get recipientAddress() {
    return getAddressFromAddressState(this.addressState)
  }

  async update({
    humanizerInfo,
    selectedToken,
    amount,
    shouldSetMaxAmount,
    addressState,
    isRecipientAddressUnknownAgreed,
    amountFieldMode
  }: TransferUpdate) {
    if (humanizerInfo) {
      this.#humanizerInfo = humanizerInfo
    }

    if (amountFieldMode) {
      this.amountFieldMode = amountFieldMode
    }

    if (selectedToken) {
      if (this.selectedToken && selectedToken.chainId !== this.selectedToken.chainId) {
        // The SignAccountOp controller is already initialized with the previous chainId and account operation.
        // When the chainId changes, we need to recreate the controller to correctly estimate for the new chain.
        // Here, we destroy it, and at the end of this update method, we initialize it again.
        this.destroySignAccountOp()
      }

      this.selectedToken = selectedToken
      this.#fetchRecipientAccountStateIfNeeded()
    }
    // If we do a regular check the value won't update if it's '' or '0'
    if (typeof amount === 'string') {
      this.#isMaxAmountSelected = false
      this.#resetMaxFeeReservation()
      this.#setAmount(amount)
    }

    if (shouldSetMaxAmount) {
      const maxAmountAfterFeeReservation = this.#getMaxAmountAfterFeeReservation()
      if (!Number(maxAmountAfterFeeReservation)) return

      this.#isMaxAmountSelected = true
      this.#resetMaxFeeReservation()
      this.amountFieldMode = 'token'
      this.#setTokenAmount(maxAmountAfterFeeReservation, true)
    }

    if (addressState) {
      this.addressState = {
        ...this.addressState,
        ...addressState
      }
      if (this.isInitialized) {
        this.#onRecipientAddressChange()
      }
    }
    // We can do a regular check here, because the property defines if it should be updated
    // and not the actual value
    if (isRecipientAddressUnknownAgreed) {
      this.isRecipientAddressUnknownAgreed = !this.isRecipientAddressUnknownAgreed
    }

    await this.#updateRecipientHistoryAndPoisoning()

    await this.syncSignAccountOp()
    this.emitUpdate()
  }

  checkIsRecipientAddressUnknown() {
    if (!isAddress(this.recipientAddress)) {
      this.isRecipientAddressUnknown = false
      this.isRecipientAddressUnknownAgreed = false

      this.emitUpdate()
      return
    }
    const isAddressInAddressBook = this.#addressBook.contacts.some(
      ({ address }) => address.toLowerCase() === this.recipientAddress.toLowerCase()
    )

    this.isRecipientAddressUnknown =
      !isAddressInAddressBook &&
      this.recipientAddress.toLowerCase() !== this.#selectedAccount.account?.addr.toLowerCase() &&
      this.recipientAddress.toLowerCase() !== FEE_COLLECTOR.toLowerCase()
    this.isRecipientAddressUnknownAgreed = false

    this.emitUpdate()
  }

  checkIsRecipientAddressViewOnly() {
    const recipientAccount = this.#accounts.accounts.find(
      ({ addr }) => addr.toLowerCase() === this.recipientAddress.toLowerCase()
    )

    if (recipientAccount) {
      const isViewOnly = getIsViewOnly(this.#keystore.keys, recipientAccount.associatedKeys)
      this.isRecipientAddressViewOnly = isViewOnly
    } else {
      this.isRecipientAddressViewOnly = false
    }
  }

  #onRecipientAddressChange() {
    if (!isAddress(this.recipientAddress)) {
      this.isRecipientAddressUnknown = false
      this.isRecipientAddressUnknownAgreed = false
      this.isRecipientHumanizerKnownTokenOrSmartContract = false
      this.isRecipientAddressFirstTimeSend = false
      this.lastSentToRecipientAt = null
      this.addressPoisoningMatch = null
      this.isRecipientAddressViewOnly = false

      return
    }

    if (this.#humanizerInfo) {
      // @TODO: could fetch address code
      this.isRecipientHumanizerKnownTokenOrSmartContract =
        !!this.#humanizerInfo.knownAddresses[this.recipientAddress]?.isSC
    }

    this.checkIsRecipientAddressViewOnly()
    this.checkIsRecipientAddressUnknown()
    this.#fetchRecipientAccountStateIfNeeded()
  }

  #setAmountAndNotifyUI(amount: string) {
    this.amount = amount
    this.programmaticUpdateCounter += 1
  }

  #setAmountInFiatAndNotifyUI(amountInFiat: string) {
    this.amountInFiat = amountInFiat
    this.programmaticUpdateCounter += 1
  }

  #setAmount(fieldValue: string, isProgrammaticUpdate = false) {
    if (isProgrammaticUpdate) {
      // There is no problem in updating this first as there are no
      // emit updates in this method
      this.programmaticUpdateCounter += 1
    }

    if (!fieldValue) {
      this.amount = ''
      this.amountInFiat = ''
      return
    }

    const tokenPrice = this.selectedToken?.priceIn.find(
      (p) => p.baseCurrency === HARD_CODED_CURRENCY
    )?.price

    if (!tokenPrice) {
      this.amount = fieldValue
      this.amountInFiat = ''
      return
    }

    if (this.amountFieldMode === 'fiat' && typeof this.selectedToken?.decimals === 'number') {
      this.amountInFiat = fieldValue

      // Get the number of decimals
      const amountInFiatDecimals = 10
      const { tokenPriceBigInt, tokenPriceDecimals } = convertTokenPriceToBigInt(tokenPrice)

      // Convert the numbers to big int
      const sanitizedFiat = getSanitizedAmount(fieldValue, amountInFiatDecimals)
      const amountInFiatBigInt = sanitizedFiat
        ? parseUnits(sanitizedFiat, amountInFiatDecimals)
        : 0n
      this.amount = formatUnits(
        (amountInFiatBigInt * CONVERSION_PRECISION_POW) / tokenPriceBigInt,
        // Shift the decimal point by the number of decimals in the token price
        amountInFiatDecimals + CONVERSION_PRECISION - tokenPriceDecimals
      )

      return
    }
    if (this.amountFieldMode === 'token') {
      this.amount = fieldValue

      if (!this.selectedToken) return

      const formattedAmount = parseUnits(
        getSafeAmountFromFieldValue(fieldValue, this.selectedToken.decimals),
        this.selectedToken.decimals
      )

      if (!formattedAmount) return

      const { tokenPriceBigInt, tokenPriceDecimals } = convertTokenPriceToBigInt(tokenPrice)

      this.amountInFiat = formatUnits(
        formattedAmount * tokenPriceBigInt,
        // Shift the decimal point by the number of decimals in the token price
        this.selectedToken.decimals + tokenPriceDecimals
      )
    }
  }

  #setTokenAmount(amount: string, isProgrammaticUpdate = false) {
    const amountFieldMode = this.amountFieldMode

    this.amountFieldMode = 'token'
    this.#setAmount(amount, isProgrammaticUpdate)
    this.amountFieldMode = amountFieldMode
  }

  #getMaxAmountAfterFeeReservation() {
    if (!this.selectedToken) return this.maxAmount

    const totalTokenAmount = getTokenAmount(this.selectedToken)
    const gasFeePayment = this.signAccountOpController?.accountOp.gasFeePayment

    if (!this.#shouldReserveFeeFromTransferredToken() || !gasFeePayment) {
      return formatUnits(totalTokenAmount, this.selectedToken.decimals)
    }

    return formatUnits(
      getAmountAfterFeeReserve(totalTokenAmount, gasFeePayment.amount),
      this.selectedToken.decimals
    )
  }

  #resetMaxFeeReservation() {
    this.#maxFeeReservation = null
  }

  /**
   * Get an unique key to know when to change the calculations
   */
  #getMaxFeeReservationKey() {
    const gasFeePayment = this.signAccountOpController?.accountOp.gasFeePayment
    const selectedFeeOption = this.signAccountOpController?.selectedOption
    const selectedToken = this.selectedToken

    if (!gasFeePayment || !selectedFeeOption || !selectedToken) return null

    return [
      selectedToken.chainId.toString(),
      selectedToken.address.toLowerCase(),
      selectedFeeOption.paidBy.toLowerCase(),
      selectedFeeOption.token.chainId.toString(),
      selectedFeeOption.token.address.toLowerCase(),
      selectedFeeOption.token.flags.onGasTank ? 'gas-tank' : 'account',
      this.signAccountOpController?.selectedFeeSpeed || '',
      gasFeePayment.broadcastOption
    ].join(':')
  }

  /**
   * The MAX amount you can set was reacting to every small fee estimate change.
   * When ARB was both the transfer token and fee token, that created a feedback cycle:
   * fee changes amount, amount re-estimates fee, repeat.
   * We're changing the MAX same-token fee reservation to keep the highest fee seen for
   * the current fee token/payer/speed, so the amount can decrease to remain safe
   * but won’t bounce back upward and retrigger the loop.
   */
  #getMaxReservedFeeAmount(feeAmount: bigint) {
    const key = this.#getMaxFeeReservationKey()
    if (!key) return feeAmount

    if (
      !this.#maxFeeReservation ||
      this.#maxFeeReservation.key !== key ||
      this.#maxFeeReservation.amount < feeAmount
    ) {
      this.#maxFeeReservation = {
        key,
        amount: feeAmount
      }
    }

    return this.#maxFeeReservation.amount
  }

  #shouldReserveFeeFromTransferredToken() {
    const gasFeePayment = this.signAccountOpController?.accountOp.gasFeePayment
    const selectedFeeOption = this.signAccountOpController?.selectedOption
    const selectedToken = this.selectedToken
    const accountAddr = this.#selectedAccount.account?.addr.toLowerCase()

    if (!accountAddr || !gasFeePayment || !selectedFeeOption || !selectedToken) return false
    if (selectedFeeOption.token.flags.onGasTank) return false
    if (selectedFeeOption.paidBy.toLowerCase() !== accountAddr) return false

    const selectedTokenAddress = selectedToken.address.toLowerCase()

    return (
      !!accountAddr &&
      !!gasFeePayment &&
      !!selectedFeeOption &&
      selectedFeeOption.paidBy.toLowerCase() === accountAddr &&
      selectedFeeOption.token.chainId === selectedToken.chainId &&
      selectedFeeOption.token.address.toLowerCase() === selectedTokenAddress &&
      gasFeePayment.inToken.toLowerCase() === selectedTokenAddress &&
      (!gasFeePayment.feeTokenChainId || gasFeePayment.feeTokenChainId === selectedToken.chainId)
    )
  }

  #syncAmountWithFeeReservation(forceEmit?: boolean) {
    if (!this.amount || !this.selectedToken || typeof this.selectedToken.decimals !== 'number')
      return false

    const totalTokenAmount = getTokenAmount(this.selectedToken)
    const shouldReserveFee = this.#shouldReserveFeeFromTransferredToken()
    const gasFeePayment = this.signAccountOpController?.accountOp.gasFeePayment
    const fee = shouldReserveFee ? gasFeePayment?.amount || 0n : 0n
    const reservedFee =
      shouldReserveFee && this.#isMaxAmountSelected ? this.#getMaxReservedFeeAmount(fee) : fee

    if (!shouldReserveFee) this.#resetMaxFeeReservation()

    const currentAmount = this.amount
      ? parseUnits(
          getSafeAmountFromFieldValue(this.amount, this.selectedToken.decimals),
          this.selectedToken.decimals
        )
      : 0n
    const desiredAmount = getAmountAfterFeeSync({
      currentAmount,
      totalAmount: totalTokenAmount,
      fee,
      reservedFee,
      shouldReserveFee,
      isMaxAmountSelected: this.#isMaxAmountSelected
    })

    if (desiredAmount === 0n || currentAmount === desiredAmount) return false

    this.#setTokenAmount(formatUnits(desiredAmount, this.selectedToken.decimals), true)
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.syncSignAccountOp()
    this.propagateUpdate(forceEmit)

    return true
  }

  /**
   * When doing a MAX transfer or a close to MAX transfer out,
   * if the selected fee token is the same as the transfer token,
   * we automatically adjust the transfer amount so the user
   * can successfully broadcast. For that, we put an additional
   * warning telling him why this is happening
   */
  get amountAdjustmentWarning(): Validation | null {
    if (!this.amount || !this.selectedToken || !this.#shouldReserveFeeFromTransferredToken()) {
      return null
    }

    const gasFeePayment = this.signAccountOpController?.accountOp.gasFeePayment
    if (!gasFeePayment) return null

    const currentAmount = parseUnits(
      getSafeAmountFromFieldValue(this.amount, this.selectedToken.decimals),
      this.selectedToken.decimals
    )
    const totalTokenAmount = getTokenAmount(this.selectedToken)
    const maxAmountAfterFeeReservation = getAmountAfterFeeReserve(
      totalTokenAmount,
      gasFeePayment.amount
    )

    if (
      maxAmountAfterFeeReservation > 0n &&
      currentAmount > 0n &&
      currentAmount + gasFeePayment.amount >= totalTokenAmount
    ) {
      return {
        severity: 'warning',
        message: 'Amount adjusted to cover blockchain fees'
      }
    }

    return null
  }

  async #updateRecipientHistoryAndPoisoning() {
    // Check if the address has been used previously for transactions
    let found = false
    let lastTransactionDate = null
    let addressPoisoningMatch = null

    if (isAddress(this.recipientAddress)) {
      const result = await this.#activity.hasAccountOpsSentTo(
        this.recipientAddress,
        this.#selectedAccount.account?.addr || ''
      )
      found = result.found
      lastTransactionDate = result.lastTransactionDate
      addressPoisoningMatch = result.addressPoisoningMatch
    }

    this.isRecipientAddressFirstTimeSend =
      !found && this.recipientAddress.toLowerCase() !== FEE_COLLECTOR.toLowerCase()
    this.lastSentToRecipientAt = lastTransactionDate

    this.addressPoisoningMatch = this.isRecipientAddressFirstTimeSend ? addressPoisoningMatch : null
  }

  get hasPersistedState() {
    return !!(this.amount || this.amountInFiat || this.addressState.fieldValue)
  }

  async syncSignAccountOp() {
    // shouldn't happen ever
    if (!this.#selectedAccount.account) return

    const recipientAddress = this.isTopUp
      ? FEE_COLLECTOR
      : getAddressFromAddressState(this.addressState)

    // form field validation
    if (!this.#selectedToken || !this.amount || !isAddress(recipientAddress) || !this.isFormValid)
      return

    const sanitizedFiat = getSanitizedAmount(this.amountInFiat, 6)
    const amountInFiatBigInt = sanitizedFiat ? parseUnits(sanitizedFiat, 6) : 0n
    const userRequestParams = getTransferRequestParams({
      selectedAccount: this.#selectedAccount.account.addr,
      amount: getSafeAmountFromFieldValue(this.amount, this.selectedToken?.decimals),
      selectedToken: this.#selectedToken,
      recipientAddress,
      amountInFiat: amountInFiatBigInt
    })

    if (!userRequestParams) {
      this.emitError({
        level: 'major',
        message: 'Unexpected error while building transfer request',
        error: new Error(
          'buildUserRequestFromTransferRequest: bad parameters passed to buildTransferUserRequest'
        )
      })

      return
    }

    // If SignAccountOpController is already initialized, we just update it.
    if (this.signAccountOpController) {
      this.signAccountOpController.update({
        accountOpData: {
          calls: userRequestParams.calls,
          meta: {
            ...(this.signAccountOpController.accountOp.meta || {}),
            topUpAmount: userRequestParams.meta.topUpAmount
          }
        }
      })

      return
    }

    await this.#initSignAccOp(userRequestParams.calls, userRequestParams.meta.topUpAmount)
  }

  async #initSignAccOp(calls: Call[], topUpAmount?: bigint) {
    if (!this.#selectedAccount.account || this.signAccountOpController) return

    const network = this.#networks.networks.find(
      (net) => net.chainId === this.#selectedToken!.chainId
    )

    // shouldn't happen ever
    if (!network) return

    const provider = this.#providers.providers[network.chainId.toString()]!
    const accountState = await this.#accounts.getOrFetchAccountOnChainState(
      this.#selectedAccount.account.addr,
      network.chainId
    )

    if (!accountState) {
      const error = new Error(
        `Failed to fetch account onchain state for network with chainId ${network.chainId}`
      )

      this.emitError({
        level: 'major',
        message:
          'Unable to proceed with the transfer due to missing information (account state). Please try again later.',
        error
      })
      return
    }

    const baseAcc = getBaseAccount(this.#selectedAccount.account, accountState, network)
    const accountOp = {
      id: generateUuid(),
      accountAddr: this.#selectedAccount.account.addr,
      chainId: network.chainId,
      signingKeyAddr: null,
      signingKeyType: null,
      gasLimit: null,
      gasFeePayment: null,
      nonce: accountState.nonce,
      signature: null,
      calls,
      meta: {
        paymasterService: getAmbirePaymasterService(baseAcc, this.#relayerUrl),
        topUpAmount,
        allowTransferFeeTokenSelfReserve: true
      }
    }

    await this.#updateRecipientHistoryAndPoisoning()
    this.signAccountOpController = new SignAccountOpController({
      type: 'one-click-transfer',
      callRelayer: this.#callRelayer,
      accounts: this.#accounts,
      networks: this.#networks,
      keystore: this.#keystore,
      portfolio: this.#portfolio,
      externalSignerControllers: this.#externalSignerControllers,
      activity: this.#activity,
      account: this.#selectedAccount.account,
      network,
      provider,
      phishing: this.#phishing,
      dapps: this.#dapps,
      fromRequestId: randomId(), // the account op and the request are fabricated,
      accountOp,
      shouldSimulate: false,
      onBroadcastSuccess: async (props) => {
        const { submittedAccountOp } = props
        void this.#portfolio.simulateAccountOp(props.accountOp).then(() => {
          this.#portfolio.markSimulationAsBroadcasted(accountOp.accountAddr, accountOp.chainId)
        })

        await this.#onBroadcastSuccess(props)

        if (this.transferSessionId) {
          this.latestBroadcastedToken = structuredClone(this.selectedToken)
          this.latestBroadcastedAccountOp = submittedAccountOp
        } else {
          // Do a complete reset if there is no transfer session
          // as the user may have closed the transfer screen immediately after broadcasting
          // which means that we won't reset the form there.
          this.reset({ destroyAccountOp: true })
        }
      }
    })

    this.signAccountOpController.onUpdate((forceEmit) => {
      this.#syncAmountWithFeeReservation(forceEmit)

      this.propagateUpdate(forceEmit)

      if (this.signAccountOpController?.broadcastStatus === 'SUCCESS') {
        // Reset the form on the next tick so the FE receives the final
        // signAccountOpController update before resetForm destroys it
        setTimeout(() => {
          this.resetForm()
        }, 0)
      }
    }, 'transfer')

    this.signAccountOpController.onError(async (error) => {
      this.emitError(error)

      if (this.signAccountOpController)
        await this.#portfolio.overrideSimulationResults(this.signAccountOpController.accountOp)
    })
  }

  async callSignAccountOpMethod<M extends keyof SignAccountOpControllerMethods>(
    method: M,
    args: Parameters<SignAccountOpControllerMethods[M]>
  ) {
    if (!this.signAccountOpController) return

    await (this.signAccountOpController[method] as any)(...args)
  }

  setUserProceeded(hasProceeded: boolean) {
    this.hasProceeded = hasProceeded
    this.emitUpdate()
  }

  destroySignAccountOp() {
    if (this.signAccountOpController) {
      this.signAccountOpController.destroy()
      this.signAccountOpController = null
    }

    this.hasProceeded = false
  }

  destroyLatestBroadcastedAccountOp(skipUpdate: boolean = false) {
    this.latestBroadcastedAccountOp = null
    this.latestBroadcastedToken = null

    if (!skipUpdate) {
      this.emitUpdate()
    }
  }

  unloadScreen(viewType: View['type'], opts?: { isNavigateOut: boolean }) {
    const { isNavigateOut = false } = opts || {}

    // Always reset the session id
    this.#currentTransferSessionId = null

    if (this.hasPersistedState && !isNavigateOut && viewType === 'popup') return

    this.reset({ destroyAccountOp: true })
  }

  reset(opts?: { destroyAccountOp: boolean }) {
    const { destroyAccountOp = false } = opts || {}

    this.#tokens = []
    this.selectedToken = null
    this.areDefaultsSet = false

    this.destroyLatestBroadcastedAccountOp(true)
    this.resetForm(destroyAccountOp)
  }

  /**
   * Unbrick mechanism.
   * Use this only when you are sure there's no way to continue, or
   * a promise waiting to resolve that might change the state
   */
  cancelSignReq() {
    this.signAccountOpController?.cancelSignReq()
  }

  // includes the getters in the stringified instance
  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      transferSessionId: this.transferSessionId,
      validationFormMsgs: this.validationFormMsgs,
      isFormValid: this.isFormValid,
      isInitialized: this.isInitialized,
      selectedToken: this.selectedToken,
      tokens: this.tokens,
      maxAmount: this.maxAmount,
      maxAmountInFiat: this.maxAmountInFiat,
      shouldSkipTransactionQueuedModal: this.shouldSkipTransactionQueuedModal,
      hasPersistedState: this.hasPersistedState,
      isRecipientAddressViewOnly: this.isRecipientAddressViewOnly,
      amountAdjustmentWarning: this.amountAdjustmentWarning
    }
  }
}
