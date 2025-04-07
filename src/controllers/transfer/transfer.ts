import { formatUnits, isAddress, parseUnits } from 'ethers'

import { FEE_COLLECTOR } from '../../consts/addresses'
import { Account } from '../../interfaces/account'
import { AddressState } from '../../interfaces/domains'
import { Network } from '../../interfaces/network'
import { Storage } from '../../interfaces/storage'
import { TransferUpdate } from '../../interfaces/transfer'
import { isSmartAccount } from '../../libs/account/account'
import { HumanizerMeta } from '../../libs/humanizer/interfaces'
import { TokenResult } from '../../libs/portfolio'
import { getTokenAmount } from '../../libs/portfolio/helpers'
import { getSanitizedAmount } from '../../libs/transfer/amount'
import { validateSendTransferAddress, validateSendTransferAmount } from '../../services/validations'
import { convertTokenPriceToBigInt } from '../../utils/numbers/formatters'
import { Contacts } from '../addressBook/addressBook'
import EventEmitter from '../eventEmitter/eventEmitter'
import { SelectedAccountPortfolio } from '../../interfaces/selectedAccount'
import { stringify } from '../../libs/richJson/richJson'

const CONVERSION_PRECISION = 16
const CONVERSION_PRECISION_POW = BigInt(10 ** CONVERSION_PRECISION)

const DEFAULT_ADDRESS_STATE = {
  fieldValue: '',
  ensAddress: '',
  udAddress: '',
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

const PERSIST_STORAGE_KEY = 'transferState'

type PersistedState = {
  version: string
  state: Pick<
    TransferController,
    | 'amount'
    | 'amountInFiat'
    | 'amountFieldMode'
    | 'addressState'
    | 'isSWWarningVisible'
    | 'isSWWarningAgreed'
    | 'isRecipientAddressUnknown'
    | 'isRecipientAddressUnknownAgreed'
    | 'isRecipientHumanizerKnownTokenOrSmartContract'
  > & {
    selectedToken?: {
      address: string
      networkId: string
    }
  }
}

export const hasPersistedState = async (storage: Storage, appVersion: string) => {
  const persistedState: PersistedState = await storage.get(PERSIST_STORAGE_KEY)

  if (!persistedState) return false

  if (persistedState.version !== appVersion) {
    return false
  }

  return !!Object.keys(persistedState.state)
}

export class TransferController extends EventEmitter {
  #storage: Storage

  #networks: Network[] = []

  #portfolio: SelectedAccountPortfolio

  #addressBookContacts: Contacts = []

  #selectedToken: TokenResult | null = null

  #selectedAccountData: Account | null = null

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

  // Holds the initial load promise, so that one can wait until it completes
  #initialLoadPromise: Promise<void>

  #APP_VERSION: string

  constructor(
    storage: Storage,
    humanizerInfo: HumanizerMeta,
    selectedAccountData: Account,
    networks: Network[],
    portfolio: SelectedAccountPortfolio,
    shouldHydrate: boolean,
    APP_VERSION: string
  ) {
    super()

    this.#storage = storage
    this.#humanizerInfo = humanizerInfo
    this.#selectedAccountData = selectedAccountData
    this.#networks = networks
    this.#portfolio = portfolio
    this.#APP_VERSION = APP_VERSION

    this.#initialLoadPromise = this.#load(shouldHydrate)
    this.emitUpdate()
  }

  async #load(shouldHydrate: boolean) {
    this.#shouldSkipTransactionQueuedModal = await this.#storage.get(
      'shouldSkipTransactionQueuedModal',
      false
    )

    if (shouldHydrate) await this.#hydrate()
  }

  async #hydrate() {
    const persistedState: PersistedState = await this.#storage.get(PERSIST_STORAGE_KEY)

    // Don't hydrate if no state was previously persisted.
    if (!persistedState) return

    // In case of a newer app version, we don't hydrate using the older persisted storage,
    // as the storage interface may differ from the newly deployed code.
    // This could result in a runtime error, so we prefer to play it safe.
    if (persistedState.version !== this.#APP_VERSION) {
      await this.#clearPersistedState()
      return
    }

    const { selectedToken, ...rest } = persistedState.state

    // Normalize selected token to TokenResult
    if (selectedToken) {
      const portfolioToken = this.#portfolio.tokens.find(
        (token) =>
          token.address === selectedToken.address && token.networkId === selectedToken.networkId
      )

      if (portfolioToken) this.#selectedToken = portfolioToken
    }

    Object.assign(this, rest)
    console.log('HYDRATED STATE:', this.#selectedToken, this.toJSON())
  }

  get persistableState() {
    const PERSISTED_FIELDS: PersistedState['state'] = {
      amount: this.amount,
      amountInFiat: this.amountInFiat,
      amountFieldMode: this.amountFieldMode,
      addressState: this.addressState,
      isSWWarningVisible: this.isSWWarningVisible,
      isSWWarningAgreed: this.isSWWarningAgreed,
      isRecipientAddressUnknown: this.isRecipientAddressUnknown,
      isRecipientAddressUnknownAgreed: this.isRecipientAddressUnknownAgreed,
      isRecipientHumanizerKnownTokenOrSmartContract:
        this.isRecipientHumanizerKnownTokenOrSmartContract
    }

    // We prefer to keep TokenResult simplified in storage and normalize it back to the full object during hydration,
    // to avoid some TokenResult fields (amount, flags) becoming obsolete while cached.
    if (this.#selectedToken) {
      PERSISTED_FIELDS.selectedToken = {
        address: this.#selectedToken.address,
        networkId: this.#selectedToken.networkId
      }
    }

    return PERSISTED_FIELDS
  }

  #persist() {
    console.log('PERSISTED STATE:', this.persistableState)
    this.#storage.set(PERSIST_STORAGE_KEY, {
      state: this.persistableState,
      version: this.#APP_VERSION
    })
  }

  async #clearPersistedState() {
    await this.#storage.remove(PERSIST_STORAGE_KEY)
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
      prevSelectedToken?.networkId !== token?.networkId
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

  resetForm() {
    this.amount = ''
    this.amountInFiat = ''
    this.addressState = { ...DEFAULT_ADDRESS_STATE }
    this.isRecipientAddressUnknown = false
    this.isRecipientAddressUnknownAgreed = false
    this.isRecipientHumanizerKnownTokenOrSmartContract = false
    this.isSWWarningVisible = false
    this.isSWWarningAgreed = false

    this.#clearPersistedState()
    this.emitUpdate()
  }

  get validationFormMsgs() {
    if (!this.isInitialized) return DEFAULT_VALIDATION_FORM_MSGS

    const validationFormMsgsNew = DEFAULT_VALIDATION_FORM_MSGS

    if (this.#humanizerInfo && this.#selectedAccountData) {
      const isUDAddress = !!this.addressState.udAddress
      const isEnsAddress = !!this.addressState.ensAddress

      validationFormMsgsNew.recipientAddress = validateSendTransferAddress(
        this.recipientAddress,
        this.#selectedAccountData.addr,
        this.isRecipientAddressUnknownAgreed,
        this.isRecipientAddressUnknown,
        this.isRecipientHumanizerKnownTokenOrSmartContract,
        isUDAddress,
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
    return !!this.#humanizerInfo && !!this.#selectedAccountData && !!this.#networks.length
  }

  get recipientAddress() {
    return (
      this.addressState.ensAddress || this.addressState.udAddress || this.addressState.fieldValue
    )
  }

  async update(updateInput: TransferUpdate, options: { shouldPersist?: boolean } = {}) {
    const { shouldPersist = true } = options

    await this.#initialLoadPromise

    const prevState = stringify(this.persistableState)

    const {
      selectedAccountData,
      humanizerInfo,
      selectedToken,
      amount,
      addressState,
      isSWWarningAgreed,
      isRecipientAddressUnknownAgreed,
      isTopUp,
      networks,
      contacts,
      amountFieldMode
    } = updateInput

    if (humanizerInfo) {
      this.#humanizerInfo = humanizerInfo
    }
    if (networks) {
      this.#networks = networks
    }
    if (contacts) {
      this.#addressBookContacts = contacts

      if (this.isInitialized) {
        this.checkIsRecipientAddressUnknown()
      }
    }
    if (selectedAccountData) {
      if (this.#selectedAccountData?.addr !== selectedAccountData.addr) {
        this.#setAmount('')
        this.selectedToken = null
      }
      this.#selectedAccountData = selectedAccountData
    }
    if (selectedToken) {
      this.selectedToken = selectedToken
    }
    // If we do a regular check the value won't update if it's '' or '0'
    if (typeof amount === 'string') {
      this.#setAmount(amount)
    }
    if (amountFieldMode) {
      this.amountFieldMode = amountFieldMode
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

    this.emitUpdate()

    if (shouldPersist) {
      if (this.isTopUp) {
        return this.#clearPersistedState()
      }

      const hasStateChange = prevState !== stringify(this.persistableState)

      if (hasStateChange) this.#persist()
    }
  }

  checkIsRecipientAddressUnknown() {
    if (!isAddress(this.recipientAddress)) {
      this.isRecipientAddressUnknown = false
      this.isRecipientAddressUnknownAgreed = false

      this.emitUpdate()
      return
    }
    const isAddressInAddressBook = this.#addressBookContacts.some(
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
    if (!this.#selectedAccountData) return

    this.isSWWarningVisible =
      this.isRecipientAddressUnknown &&
      isSmartAccount(this.#selectedAccountData) &&
      !this.isTopUp &&
      !!this.selectedToken?.address &&
      Number(this.selectedToken?.address) === 0 &&
      this.#networks
        .filter((n) => n.id !== 'ethereum')
        .map(({ id }) => id)
        .includes(this.selectedToken.networkId || 'ethereum')

    this.emitUpdate()
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
      shouldSkipTransactionQueuedModal: this.shouldSkipTransactionQueuedModal
    }
  }
}
