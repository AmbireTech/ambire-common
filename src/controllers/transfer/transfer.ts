import { formatUnits, isAddress, parseUnits } from 'ethers'

import { FEE_COLLECTOR } from '../../consts/addresses'
import { IAccountsController } from '../../interfaces/account'
import { IActivityController } from '../../interfaces/activity'
import { IAddressBookController } from '../../interfaces/addressBook'
import { AddressState } from '../../interfaces/domains'
import { ExternalSignerControllers, IKeystoreController } from '../../interfaces/keystore'
import { INetworksController } from '../../interfaces/network'
import { IPhishingController } from '../../interfaces/phishing'
import { IPortfolioController } from '../../interfaces/portfolio'
import { IProvidersController } from '../../interfaces/provider'
import { ISelectedAccountController } from '../../interfaces/selectedAccount'
import { ISignAccountOpController } from '../../interfaces/signAccountOp'
import { IStorageController } from '../../interfaces/storage'
import { ITransferController, TransferUpdate } from '../../interfaces/transfer'
import { IUiController, View } from '../../interfaces/ui'
import { isSmartAccount } from '../../libs/account/account'
import { getBaseAccount } from '../../libs/account/getBaseAccount'
import { AccountOp } from '../../libs/accountOp/accountOp'
import { Call } from '../../libs/accountOp/types'
import { getAmbirePaymasterService } from '../../libs/erc7677/erc7677'
import { HumanizerMeta } from '../../libs/humanizer/interfaces'
import { randomId } from '../../libs/humanizer/utils'
import { TokenResult } from '../../libs/portfolio'
import { getTokenAmount, getTokenBalanceInUSD } from '../../libs/portfolio/helpers'
import { getSanitizedAmount } from '../../libs/transfer/amount'
import { buildTransferUserRequest } from '../../libs/transfer/userRequest'
import { validateSendTransferAddress, validateSendTransferAmount } from '../../services/validations'
import { getAddressFromAddressState } from '../../utils/domains'
import {
  convertTokenPriceToBigInt,
  getSafeAmountFromFieldValue
} from '../../utils/numbers/formatters'
import EventEmitter from '../eventEmitter/eventEmitter'
import { OnBroadcastSuccess, SignAccountOpController } from '../signAccountOp/signAccountOp'

const CONVERSION_PRECISION = 16
const CONVERSION_PRECISION_POW = BigInt(10 ** CONVERSION_PRECISION)

const DEFAULT_ADDRESS_STATE = {
  fieldValue: '',
  ensAddress: '',
  isDomainResolving: false
}

const DEFAULT_VALIDATION_FORM_MSGS = {
  amount: {
    success: false,
    message: ''
  },
  recipientAddress: {
    success: false,
    message: '',
    severity: 'info'
  }
}

const HARD_CODED_CURRENCY = 'usd'

export class TransferController extends EventEmitter implements ITransferController {
  #callRelayer: Function

  #storage: IStorageController

  #networks: INetworksController

  #addressBook: IAddressBookController

  #selectedToken: TokenResult | null = null

  #selectedAccountData: ISelectedAccountController

  #humanizerInfo: HumanizerMeta | null = null

  // session / debounce
  #currentTransferSessionId: string | null = null

  isSWWarningVisible = false

  isSWWarningAgreed = false

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

  isRecipientAddressUnknown = false

  isRecipientAddressUnknownAgreed = false

  isRecipientHumanizerKnownTokenOrSmartContract = false

  isTopUp: boolean = false

  #shouldSkipTransactionQueuedModal: boolean = false

  #accounts: IAccountsController

  #keystore: IKeystoreController

  #portfolio: IPortfolioController

  #externalSignerControllers: ExternalSignerControllers

  #providers: IProvidersController

  #phishing: IPhishingController

  #relayerUrl: string

  isRecipientAddressFirstTimeSend: boolean = false

  lastSentToRecipientAt: Date | null = null

  signAccountOpController: ISignAccountOpController | null = null

  latestBroadcastedAccountOp: AccountOp | null = null

  latestBroadcastedToken: TokenResult | null = null

  #shouldTrackLatestBroadcastedAccountOp: boolean = true

  hasProceeded: boolean = false

  // Holds the initial load promise, so that one can wait until it completes
  #initialLoadPromise?: Promise<void>

  #activity: IActivityController

  #onBroadcastSuccess: OnBroadcastSuccess

  #ui: IUiController

  #waitPortfolioTimeout: ReturnType<typeof setTimeout> | null = null

  #tokens: TokenResult[] = []

  #unsubscribeSelectedAccountController: (() => void) | null = null

  #previousRoute: string | undefined = undefined

  constructor(
    callRelayer: Function,
    storage: IStorageController,
    humanizerInfo: HumanizerMeta,
    selectedAccountData: ISelectedAccountController,
    networks: INetworksController,
    addressBook: IAddressBookController,
    accounts: IAccountsController,
    keystore: IKeystoreController,
    portfolio: IPortfolioController,
    activity: IActivityController,
    externalSignerControllers: ExternalSignerControllers,
    providers: IProvidersController,
    phishing: IPhishingController,
    relayerUrl: string,
    onBroadcastSuccess: OnBroadcastSuccess,
    ui: IUiController
  ) {
    super()

    this.#callRelayer = callRelayer
    this.#storage = storage
    this.#humanizerInfo = humanizerInfo
    this.#selectedAccountData = selectedAccountData
    this.#networks = networks
    this.#addressBook = addressBook

    this.#accounts = accounts
    this.#keystore = keystore
    this.#portfolio = portfolio
    this.#activity = activity
    this.#externalSignerControllers = externalSignerControllers
    this.#providers = providers
    this.#phishing = phishing
    this.#relayerUrl = relayerUrl
    this.#onBroadcastSuccess = onBroadcastSuccess
    this.#ui = ui

    this.#initialLoadPromise = this.#load().finally(() => {
      this.#initialLoadPromise = undefined
    })

    this.#ui.uiEvent.on('updateView', async (view: View) => {
      await this.#handleUpdateView(view)
    })

    this.emitUpdate()
  }

  async #handleUpdateView(view: View) {
    const current = view.currentRoute
    const prev = this.#previousRoute
    this.#previousRoute = current

    const isTransfer = (route: string | undefined) => {
      return route === 'transfer' || route === 'top-up-gas-tank'
    }

    // Detect entering transfer
    if (!isTransfer(prev) && isTransfer(current)) {
      await this.#enterTransfer(view)
      return
    }

    // Detect leaving transfer
    if (isTransfer(prev) && !isTransfer(current)) {
      this.#leaveTransfer()
    }
  }

  async #enterTransfer(view: View) {
    this.#ensureTransferSessionId()

    this.unsubscribeSelectedAccountController()
    this.#subscribeToSelectedAccountUpdates(view)

    await this.#setTokens(view)
    await this.#setDefaultSelectedToken(view)
  }

  #leaveTransfer() {
    this.destroyTransferSession()
    this.unsubscribeSelectedAccountController()

    this.#tokens = []
    this.selectedToken = null
    this.emitUpdate()
  }

  #ensureTransferSessionId() {
    if (!this.#currentTransferSessionId) {
      this.#currentTransferSessionId = String(randomId())
    }
  }

  destroyTransferSession() {
    this.#currentTransferSessionId = null
  }

  #subscribeToSelectedAccountUpdates(view: View) {
    this.#unsubscribeSelectedAccountController = this.#selectedAccountData.onUpdate(async () => {
      if (!this.#currentTransferSessionId) return

      await this.#setTokens(view)
      await this.#setDefaultSelectedToken(view)

      this.emitUpdate()
    })
  }

  unsubscribeSelectedAccountController() {
    if (this.#unsubscribeSelectedAccountController) {
      this.#unsubscribeSelectedAccountController()
    }

    this.#unsubscribeSelectedAccountController = null
  }

  get transferSessionId() {
    return this.#currentTransferSessionId
  }

  async #setTokens(view?: View) {
    const isTopUpView = view?.currentRoute === 'top-up-gas-tank'

    const isReady = await this.#waitUntilReadyPortfolio()

    // If aborted → don't continue
    if (!isReady) return

    const tokens = this.#selectedAccountData.portfolio.isAllReady
      ? this.#selectedAccountData.portfolio.tokens
          .filter((token) => {
            const hasAmount = Number(getTokenAmount(token)) > 0

            if (isTopUpView) {
              const tokenNetwork = this.#networks.networks.find(
                (network) => network.chainId === token.chainId
              )

              return (
                hasAmount &&
                tokenNetwork?.hasRelayer &&
                token.flags.canTopUpGasTank &&
                !token.flags.onGasTank
              )
            }

            return hasAmount && !token.flags.onGasTank && !token.flags.rewardsType
          })
          .sort((a, b) => {
            const tokenAinUSD = getTokenBalanceInUSD(a)
            const tokenBinUSD = getTokenBalanceInUSD(b)

            return tokenBinUSD - tokenAinUSD
          })
      : []

    this.#tokens = tokens
  }

  async #setDefaultSelectedToken(view?: View): Promise<void> {
    if (!this.#tokens.length) return

    const searchParams = (view && view.searchParams) || {}
    const tokenAddress = (searchParams.address || '').toLowerCase()
    const tokenChainId = searchParams.chainId

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

      // Emit update to reflect possible changes in the UI
      this.emitUpdate()
    }
  }

  #waitUntilReadyPortfolio(): Promise<boolean> {
    // Cancel previous wait if any
    if (this.#waitPortfolioTimeout) {
      clearTimeout(this.#waitPortfolioTimeout)
      this.#waitPortfolioTimeout = null
    }

    return new Promise((resolve) => {
      const startTime = Date.now()

      const check = () => {
        // Timeout after 30s
        if (Date.now() - startTime > 30000) {
          this.#waitPortfolioTimeout = null
          return resolve(false)
        }

        // If ready → resolve
        if (this.#selectedAccountData.portfolio.isAllReady) {
          this.#waitPortfolioTimeout = null
          return resolve(true)
        }

        // Not ready → check again
        this.#waitPortfolioTimeout = setTimeout(check, 150)
      }

      check()
    })
  }

  async #load() {
    this.#shouldSkipTransactionQueuedModal = await this.#storage.get(
      'shouldSkipTransactionQueuedModal',
      false
    )

    await this.#selectedAccountData.initialLoadPromise
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

  get shouldTrackLatestBroadcastedAccountOp() {
    return this.#shouldTrackLatestBroadcastedAccountOp
  }

  set shouldTrackLatestBroadcastedAccountOp(value: boolean) {
    this.#shouldTrackLatestBroadcastedAccountOp = value
  }

  // every time when updating selectedToken update the amount and maxAmount of the form
  set selectedToken(token: TokenResult | null) {
    if (!token || Number(getTokenAmount(token)) === 0) {
      this.#selectedToken = null
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
      if (!token.priceIn.length) this.amountFieldMode = 'token'
      this.#setAmountAndNotifyUI('')
      this.#setAmountInFiatAndNotifyUI('')
      this.#setSWWarningVisibleIfNeeded()
    }
  }

  get selectedToken() {
    return this.#selectedToken
  }

  get tokens() {
    return this.#tokens
  }

  get maxAmount(): string {
    if (
      !this.selectedToken ||
      getTokenAmount(this.selectedToken) === 0n ||
      typeof this.selectedToken.decimals !== 'number'
    )
      return '0'

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
    this.destroyTransferSession()
    this.selectedToken = null
    this.amount = ''
    this.amountInFiat = ''
    this.amountFieldMode = 'token'
    this.addressState = { ...DEFAULT_ADDRESS_STATE }
    this.#onRecipientAddressChange()
    this.programmaticUpdateCounter = 0

    if (shouldDestroyAccountOp) {
      this.destroySignAccountOp()
    }

    this.emitUpdate()
  }

  get validationFormMsgs() {
    if (!this.isInitialized) return DEFAULT_VALIDATION_FORM_MSGS

    const validationFormMsgsNew = DEFAULT_VALIDATION_FORM_MSGS

    if (this.#humanizerInfo && this.#selectedAccountData.account?.addr) {
      const isEnsAddress = !!this.addressState.ensAddress

      const recipientValidation = validateSendTransferAddress(
        this.recipientAddress,
        this.#selectedAccountData.account?.addr,
        this.isRecipientAddressUnknownAgreed,
        this.isRecipientAddressUnknown,
        this.isRecipientHumanizerKnownTokenOrSmartContract,
        isEnsAddress,
        this.addressState.isDomainResolving,
        this.isSWWarningVisible,
        this.isSWWarningAgreed,
        this.isRecipientAddressFirstTimeSend,
        this.lastSentToRecipientAt
      )

      validationFormMsgsNew.recipientAddress = {
        success: recipientValidation.success,
        message: recipientValidation.message,
        severity: recipientValidation.severity ?? 'info'
      }
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
        this.selectedToken && validateSendTransferAmount(this.amount, this.selectedToken).success
      )
    }

    const areFormFieldsValid =
      this.validationFormMsgs.amount.success && this.validationFormMsgs.recipientAddress.success

    const isSWWarningMissingOrAccepted = !this.isSWWarningVisible || this.isSWWarningAgreed

    return (
      areFormFieldsValid && isSWWarningMissingOrAccepted && !this.addressState.isDomainResolving
    )
  }

  get isInitialized() {
    return (
      !!this.#humanizerInfo &&
      !!this.#selectedAccountData.account?.addr &&
      !!this.#networks.networks.length
    )
  }

  get recipientAddress() {
    return this.addressState.ensAddress || this.addressState.fieldValue
  }

  async update({
    humanizerInfo,
    selectedToken,
    amount,
    shouldSetMaxAmount,
    addressState,
    isSWWarningAgreed,
    isRecipientAddressUnknownAgreed,
    isTopUp,
    amountFieldMode
  }: TransferUpdate) {
    this.shouldTrackLatestBroadcastedAccountOp = true

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
    }
    // If we do a regular check the value won't update if it's '' or '0'
    if (typeof amount === 'string') {
      this.#setAmount(amount)
    }

    if (shouldSetMaxAmount) {
      this.amountFieldMode = 'token'
      this.#setAmount(this.maxAmount, true)
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
    if (isSWWarningAgreed) {
      this.isSWWarningAgreed = !this.isSWWarningAgreed
    }
    // We can do a regular check here, because the property defines if it should be updated
    // and not the actual value
    if (isRecipientAddressUnknownAgreed) {
      this.isRecipientAddressUnknownAgreed = !this.isRecipientAddressUnknownAgreed
    }

    // Check if the address has been used previously for transactions
    let found = false
    let lastTransactionDate = null
    if (isAddress(this.recipientAddress)) {
      const result = await this.#activity.hasAccountOpsSentTo(
        this.recipientAddress,
        this.#selectedAccountData.account?.addr || ''
      )
      found = result.found
      lastTransactionDate = result.lastTransactionDate
    }
    this.isRecipientAddressFirstTimeSend =
      !found && this.recipientAddress.toLowerCase() !== FEE_COLLECTOR.toLowerCase()
    this.lastSentToRecipientAt = lastTransactionDate

    if (typeof isTopUp === 'boolean') {
      this.isTopUp = isTopUp
      this.#setSWWarningVisibleIfNeeded()
    }

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
      !isAddressInAddressBook && this.recipientAddress.toLowerCase() !== FEE_COLLECTOR.toLowerCase()
    this.isRecipientAddressUnknownAgreed = false
    this.#setSWWarningVisibleIfNeeded()

    this.emitUpdate()
  }

  #onRecipientAddressChange() {
    if (!isAddress(this.recipientAddress)) {
      this.isRecipientAddressUnknown = false
      this.isRecipientAddressUnknownAgreed = false
      this.isRecipientHumanizerKnownTokenOrSmartContract = false
      this.isRecipientAddressFirstTimeSend = false
      this.lastSentToRecipientAt = null
      this.isSWWarningVisible = false
      this.isSWWarningAgreed = false

      return
    }

    if (this.#humanizerInfo) {
      // @TODO: could fetch address code
      this.isRecipientHumanizerKnownTokenOrSmartContract =
        !!this.#humanizerInfo.knownAddresses[this.recipientAddress]?.isSC
    }

    this.checkIsRecipientAddressUnknown()
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

  #setSWWarningVisibleIfNeeded() {
    if (!this.#selectedAccountData.account?.addr) return

    this.isSWWarningVisible =
      this.isRecipientAddressUnknown &&
      isSmartAccount(this.#selectedAccountData.account) &&
      !this.isTopUp &&
      !!this.selectedToken?.address &&
      Number(this.selectedToken?.address) === 0 &&
      this.#networks.networks
        .filter((n) => n.chainId !== 1n)
        .map(({ chainId }) => chainId)
        .includes(this.selectedToken.chainId || 1n)

    this.emitUpdate()
  }

  get hasPersistedState() {
    return !!(this.amount || this.amountInFiat || this.addressState.fieldValue)
  }

  async syncSignAccountOp() {
    // shouldn't happen ever
    if (!this.#selectedAccountData.account) return

    const recipientAddress = this.isTopUp
      ? FEE_COLLECTOR
      : getAddressFromAddressState(this.addressState)

    // form field validation
    if (!this.#selectedToken || !this.amount || !isAddress(recipientAddress) || !this.isFormValid)
      return

    const sanitizedFiat = getSanitizedAmount(this.amountInFiat, 6)
    const amountInFiatBigInt = sanitizedFiat ? parseUnits(sanitizedFiat, 6) : 0n
    const userRequest = buildTransferUserRequest({
      selectedAccount: this.#selectedAccountData.account.addr,
      amount: getSafeAmountFromFieldValue(this.amount, this.selectedToken?.decimals),
      selectedToken: this.#selectedToken,
      recipientAddress,
      amountInFiat: amountInFiatBigInt
    })

    if (!userRequest || userRequest.action.kind !== 'calls') {
      this.emitError({
        level: 'major',
        message: 'Unexpected error while building transfer request',
        error: new Error(
          'buildUserRequestFromTransferRequest: bad parameters passed to buildTransferUserRequest'
        )
      })

      return
    }

    const calls = userRequest.action.calls

    // If SignAccountOpController is already initialized, we just update it.
    if (this.signAccountOpController) {
      this.signAccountOpController.update({
        accountOpData: {
          calls,
          meta: {
            ...(this.signAccountOpController.accountOp.meta || {}),
            topUpAmount: userRequest.meta.topUpAmount
          }
        }
      })

      return
    }

    await this.#initSignAccOp(calls, userRequest.meta.topUpAmount)
  }

  async #initSignAccOp(calls: Call[], topUpAmount?: bigint) {
    if (!this.#selectedAccountData.account || this.signAccountOpController) return

    const network = this.#networks.networks.find(
      (net) => net.chainId === this.#selectedToken!.chainId
    )

    // shouldn't happen ever
    if (!network) return

    const provider = this.#providers.providers[network.chainId.toString()]
    const accountState = await this.#accounts.getOrFetchAccountOnChainState(
      this.#selectedAccountData.account.addr,
      network.chainId
    )

    if (!accountState) {
      const error = new Error(
        `Failed to fetch account on-chain state for network with chainId ${network.chainId}`
      )

      this.emitError({
        level: 'major',
        message:
          'Unable to proceed with the transfer due to missing information (account state). Please try again later.',
        error
      })
      return
    }

    const baseAcc = getBaseAccount(
      this.#selectedAccountData.account,
      accountState,
      this.#keystore.getAccountKeys(this.#selectedAccountData.account),
      network
    )

    const accountOp = {
      accountAddr: this.#selectedAccountData.account.addr,
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
        topUpAmount
      }
    }

    // Check if the address has been used previously for transactions
    let previousTransactionExists = false
    let lastTransactionDate = null
    if (isAddress(this.recipientAddress)) {
      const result = await this.#activity.hasAccountOpsSentTo(
        this.recipientAddress,
        this.#selectedAccountData.account.addr
      )
      previousTransactionExists = result.found
      lastTransactionDate = result.lastTransactionDate
    }

    // Update state based on whether there are previous transactions to this address
    this.isRecipientAddressFirstTimeSend =
      !previousTransactionExists &&
      this.recipientAddress.toLowerCase() !== FEE_COLLECTOR.toLowerCase()
    this.lastSentToRecipientAt = lastTransactionDate
    this.signAccountOpController = new SignAccountOpController({
      type: 'one-click-transfer',
      callRelayer: this.#callRelayer,
      accounts: this.#accounts,
      networks: this.#networks,
      keystore: this.#keystore,
      portfolio: this.#portfolio,
      externalSignerControllers: this.#externalSignerControllers,
      activity: this.#activity,
      account: this.#selectedAccountData.account,
      network,
      provider,
      phishing: this.#phishing,
      fromActionId: randomId(), // the account op and the action are fabricated,
      accountOp,
      isSignRequestStillActive: () => true,
      shouldSimulate: false,
      onBroadcastSuccess: async (props) => {
        const { submittedAccountOp } = props
        this.#portfolio.simulateAccountOp(props.accountOp).then(() => {
          this.#portfolio.markSimulationAsBroadcasted(accountOp.accountAddr, accountOp.chainId)
        })

        await this.#onBroadcastSuccess(props)

        if (this.shouldTrackLatestBroadcastedAccountOp) {
          this.latestBroadcastedToken = this.selectedToken
          this.latestBroadcastedAccountOp = submittedAccountOp
        }

        this.resetForm()
      }
    })

    this.signAccountOpController.onUpdate(() => {
      this.emitUpdate()
    })
    this.signAccountOpController.onError((error) => {
      if (this.signAccountOpController)
        this.#portfolio.overrideSimulationResults(this.signAccountOpController.accountOp)
      this.emitError(error)
    })
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

  async destroyLatestBroadcastedAccountOp(shouldResetSelectedToken = true) {
    this.latestBroadcastedAccountOp = null
    this.latestBroadcastedToken = null
    if (shouldResetSelectedToken) {
      this.#ensureTransferSessionId()
      await this.#setTokens()
      await this.#setDefaultSelectedToken()
    }
  }

  async unloadScreen(forceUnload?: boolean) {
    if (this.hasPersistedState && !forceUnload) return

    await this.destroyLatestBroadcastedAccountOp(false)
    this.resetForm()
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
      hasPersistedState: this.hasPersistedState
    }
  }
}
