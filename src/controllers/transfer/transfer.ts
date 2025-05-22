import { formatUnits, isAddress, parseUnits } from 'ethers'

import { FEE_COLLECTOR } from '../../consts/addresses'
import { AddressState } from '../../interfaces/domains'
import { Storage } from '../../interfaces/storage'
import { TransferUpdate } from '../../interfaces/transfer'
import { isSmartAccount } from '../../libs/account/account'
import { HumanizerMeta } from '../../libs/humanizer/interfaces'
import { TokenResult } from '../../libs/portfolio'
import { getTokenAmount } from '../../libs/portfolio/helpers'
import { getSanitizedAmount } from '../../libs/transfer/amount'
import { validateSendTransferAddress, validateSendTransferAmount } from '../../services/validations'
import { convertTokenPriceToBigInt } from '../../utils/numbers/formatters'
import { AddressBookController } from '../addressBook/addressBook'
import EventEmitter from '../eventEmitter/eventEmitter'
import { SelectedAccountController } from '../selectedAccount/selectedAccount'
import { SignAccountOpController } from '../signAccountOp/signAccountOp'
import { randomId } from '../../libs/humanizer/utils'
import { AccountsController } from '../accounts/accounts'
import { KeystoreController } from '../keystore/keystore'
import { PortfolioController } from '../portfolio/portfolio'
import { ExternalSignerControllers } from '../../interfaces/keystore'
import { ProvidersController } from '../providers/providers'
import { NetworksController } from '../networks/networks'
import { buildTransferUserRequest } from '../../libs/transfer/userRequest'
import { Call } from '../../libs/accountOp/types'
import { getAddressFromAddressState } from '../../utils/domains'
import { getBaseAccount } from '../../libs/account/getBaseAccount'
import { getAmbirePaymasterService } from '../../libs/erc7677/erc7677'
import { EstimationStatus } from '../estimation/types'
import wait from '../../utils/wait'

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
    message: ''
  }
}

const HARD_CODED_CURRENCY = 'usd'

export class TransferController extends EventEmitter {
  #storage: Storage

  #networks: NetworksController

  #addressBook: AddressBookController

  #selectedToken: TokenResult | null = null

  #selectedAccountData: SelectedAccountController

  #humanizerInfo: HumanizerMeta | null = null

  isSWWarningVisible = false

  isSWWarningAgreed = false

  amount = ''

  amountInFiat = ''

  amountFieldMode: 'fiat' | 'token' = 'token'

  addressState: AddressState = { ...DEFAULT_ADDRESS_STATE }

  isRecipientAddressUnknown = false

  isRecipientAddressUnknownAgreed = false

  isRecipientHumanizerKnownTokenOrSmartContract = false

  isTopUp: boolean = false

  #shouldSkipTransactionQueuedModal: boolean = false

  #accounts: AccountsController

  #keystore: KeystoreController

  #portfolio: PortfolioController

  #externalSignerControllers: ExternalSignerControllers

  #providers: ProvidersController

  #relayerUrl: string

  signAccountOpController: SignAccountOpController | null = null

  hasProceeded: boolean = false

  // Used to safely manage and cancel the periodic estimation loop.
  // When destroySignAccountOp() is called, the AbortController is aborted,
  // which prevents further re-estimation calls even if a wait() is in progress.
  // This ensures only one active estimation loop exists at any time.
  #reestimateAbortController: AbortController | null = null

  // Holds the initial load promise, so that one can wait until it completes
  #initialLoadPromise: Promise<void>

  constructor(
    storage: Storage,
    humanizerInfo: HumanizerMeta,
    selectedAccountData: SelectedAccountController,
    networks: NetworksController,
    addressBook: AddressBookController,
    accounts: AccountsController,
    keystore: KeystoreController,
    portfolio: PortfolioController,
    externalSignerControllers: ExternalSignerControllers,
    providers: ProvidersController,
    relayerUrl: string
  ) {
    super()

    this.#storage = storage
    this.#humanizerInfo = humanizerInfo
    this.#selectedAccountData = selectedAccountData
    this.#networks = networks
    this.#addressBook = addressBook

    this.#accounts = accounts
    this.#keystore = keystore
    this.#portfolio = portfolio
    this.#externalSignerControllers = externalSignerControllers
    this.#providers = providers
    this.#relayerUrl = relayerUrl

    this.#initialLoadPromise = this.#load()
    this.emitUpdate()
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

  // every time when updating selectedToken update the amount and maxAmount of the form
  set selectedToken(token: TokenResult | null) {
    if (!token || Number(getTokenAmount(token)) === 0) {
      this.#selectedToken = null
      this.amount = ''
      this.amountInFiat = ''
      this.amountFieldMode = 'token'
      return
    }

    const prevSelectedToken = { ...this.selectedToken }

    this.#selectedToken = token

    if (
      prevSelectedToken?.address !== token?.address ||
      prevSelectedToken?.chainId !== token?.chainId
    ) {
      if (!token.priceIn.length) {
        this.amountFieldMode = 'token'
      }
      this.amount = ''
      this.amountInFiat = ''
      this.#setSWWarningVisibleIfNeeded()
    }
  }

  get selectedToken() {
    return this.#selectedToken
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

  resetForm(destroySignAccountOp = true) {
    this.amount = ''
    this.amountInFiat = ''
    this.addressState = { ...DEFAULT_ADDRESS_STATE }
    this.isRecipientAddressUnknown = false
    this.isRecipientAddressUnknownAgreed = false
    this.isRecipientHumanizerKnownTokenOrSmartContract = false
    this.isSWWarningVisible = false
    this.isSWWarningAgreed = false

    // Even if the form should be reset, there are cases where we still need to know the exact broadcasted account op
    // in order to visualize its status in the final Transfer step.
    // In that case, we are going to destroy it on component unmount or on a route navigation.
    if (destroySignAccountOp) this.destroySignAccountOp()
    this.emitUpdate()
  }

  get validationFormMsgs() {
    if (!this.isInitialized) return DEFAULT_VALIDATION_FORM_MSGS

    const validationFormMsgsNew = DEFAULT_VALIDATION_FORM_MSGS

    if (this.#humanizerInfo && this.#selectedAccountData.account?.addr) {
      const isEnsAddress = !!this.addressState.ensAddress

      validationFormMsgsNew.recipientAddress = validateSendTransferAddress(
        this.recipientAddress,
        this.#selectedAccountData.account?.addr,
        this.isRecipientAddressUnknownAgreed,
        this.isRecipientAddressUnknown,
        this.isRecipientHumanizerKnownTokenOrSmartContract,
        isEnsAddress,
        this.addressState.isDomainResolving,
        this.isSWWarningVisible,
        this.isSWWarningAgreed
      )
    }

    // Validate the amount
    if (this.selectedToken) {
      validationFormMsgsNew.amount = validateSendTransferAmount(
        this.amount,
        Number(this.maxAmount),
        Number(this.maxAmountInFiat),
        this.selectedToken
      )
    }

    return validationFormMsgsNew
  }

  get isFormValid() {
    if (!this.isInitialized) return false

    // if the amount is set, it's enough in topUp mode
    if (this.isTopUp) {
      return (
        this.selectedToken &&
        validateSendTransferAmount(
          this.amount,
          Number(this.maxAmount),
          Number(this.maxAmountInFiat),
          this.selectedToken
        ).success
      )
    }

    const areFormFieldsValid =
      this.validationFormMsgs.amount.success && this.validationFormMsgs.recipientAddress.success

    const isSWWarningMissingOrAccepted = !this.isSWWarningVisible || this.isSWWarningAgreed

    const isRecipientAddressUnknownMissingOrAccepted =
      !this.isRecipientAddressUnknown || this.isRecipientAddressUnknownAgreed

    return (
      areFormFieldsValid &&
      isSWWarningMissingOrAccepted &&
      isRecipientAddressUnknownMissingOrAccepted &&
      !this.addressState.isDomainResolving
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
    addressState,
    isSWWarningAgreed,
    isRecipientAddressUnknownAgreed,
    isTopUp,
    amountFieldMode
  }: TransferUpdate) {
    if (humanizerInfo) {
      this.#humanizerInfo = humanizerInfo
    }

    if (amountFieldMode) {
      this.amountFieldMode = amountFieldMode
    }

    if (selectedToken) {
      if (selectedToken.chainId !== this.selectedToken?.chainId) {
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

    if (typeof isTopUp === 'boolean') {
      this.isTopUp = isTopUp
      this.#setSWWarningVisibleIfNeeded()
    }

    console.log('TransferController: update()')
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
      this.isSWWarningVisible = false
      this.isSWWarningAgreed = false

      return
    }

    if (this.#humanizerInfo) {
      // @TODO: could fetch address code
      this.isRecipientHumanizerKnownTokenOrSmartContract =
        !!this.#humanizerInfo.knownAddresses[this.recipientAddress.toLowerCase()]?.isSC
    }

    this.checkIsRecipientAddressUnknown()
  }

  #setAmount(fieldValue: string) {
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
      const amountInFiatDecimals = fieldValue.split('.')[1]?.length || 0
      const { tokenPriceBigInt, tokenPriceDecimals } = convertTokenPriceToBigInt(tokenPrice)

      // Convert the numbers to big int
      const amountInFiatBigInt = parseUnits(fieldValue, amountInFiatDecimals)

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

      const sanitizedFieldValue = getSanitizedAmount(fieldValue, this.selectedToken.decimals)
      // Convert the field value to big int
      const formattedAmount = parseUnits(sanitizedFieldValue, this.selectedToken.decimals)

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
    console.log('Background: syncSignAccountOp() invoked')
    // shouldn't happen ever
    if (!this.#selectedAccountData.account) return

    const recipientAddress = this.isTopUp
      ? FEE_COLLECTOR
      : getAddressFromAddressState(this.addressState)

    // form field validation
    if (!this.#selectedToken || !this.amount || !isAddress(recipientAddress)) return

    const userRequest = buildTransferUserRequest({
      selectedAccount: this.#selectedAccountData.account.addr,
      amount: this.amount,
      selectedToken: this.#selectedToken,
      recipientAddress
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
      console.log('Background: Updating signAccountOpController with new calls:')
      this.signAccountOpController.update({ calls })
      return
    }

    console.log('Background: Init signAccountOpController')
    await this.#initSignAccOp(calls)
  }

  async #initSignAccOp(calls: Call[]) {
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
      accountOpToExecuteBefore: null,
      calls,
      meta: {
        paymasterService: getAmbirePaymasterService(baseAcc, this.#relayerUrl)
      }
    }

    this.signAccountOpController = new SignAccountOpController(
      this.#accounts,
      this.#networks,
      this.#keystore,
      this.#portfolio,
      this.#externalSignerControllers,
      this.#selectedAccountData.account,
      network,
      provider,
      randomId(), // the account op and the action are fabricated
      accountOp,
      () => true,
      false,
      undefined
    )

    // propagate updates from signAccountOp here
    this.signAccountOpController.onUpdate(() => {
      this.emitUpdate()
    })
    this.signAccountOpController.onError((error) => {
      this.#portfolio.overridePendingResults(this.signAccountOpController!.accountOp)
      this.emitError(error)
    })

    this.reestimate()
  }

  /**
   * Reestimate the signAccountOp request periodically.
   * Encapsulate it here instead of creating an interval in the background
   * as intervals are tricky and harder to control
   */
  async reestimate() {
    // Don't run the estimation loop if there is no SignAccountOpController or if the loop is already running.
    if (!this.signAccountOpController || this.#reestimateAbortController) return

    console.log('Re-estimate: Initialized')

    this.#reestimateAbortController = new AbortController()
    const signal = this.#reestimateAbortController.signal

    const loop = async () => {
      while (!signal.aborted) {
        // eslint-disable-next-line no-await-in-loop
        await wait(10000)
        if (signal.aborted) break

        if (this.signAccountOpController?.estimation.status !== EstimationStatus.Loading) {
          console.log('Re-estimate: Estimate()')
          // eslint-disable-next-line no-await-in-loop
          await this.signAccountOpController.estimate()
        }

        if (this.signAccountOpController?.estimation.errors.length) {
          console.log(
            'Errors on Transfer re-estimate',
            this.signAccountOpController.estimation.errors
          )
        }
      }
    }

    loop()
  }

  setUserProceeded(hasProceeded: boolean) {
    this.hasProceeded = hasProceeded
    this.emitUpdate()
  }

  destroySignAccountOp() {
    if (this.#reestimateAbortController) {
      this.#reestimateAbortController.abort()
      this.#reestimateAbortController = null
      console.log('Re-estimate: Aborted and Destroyed!')
    }

    if (this.signAccountOpController) {
      this.signAccountOpController.reset()
      this.signAccountOpController = null
    }

    this.hasProceeded = false
  }

  unloadScreen() {
    if (this.hasPersistedState) return

    this.resetForm()
  }

  // includes the getters in the stringified instance
  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      validationFormMsgs: this.validationFormMsgs,
      isFormValid: this.isFormValid,
      isInitialized: this.isInitialized,
      selectedToken: this.selectedToken,
      maxAmount: this.maxAmount,
      maxAmountInFiat: this.maxAmountInFiat,
      shouldSkipTransactionQueuedModal: this.shouldSkipTransactionQueuedModal,
      hasPersistedState: this.hasPersistedState
    }
  }
}
