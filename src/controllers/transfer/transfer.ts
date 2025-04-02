import { formatUnits, isAddress, parseUnits } from 'ethers'

import { FEE_COLLECTOR } from '../../consts/addresses'
import { Account } from '../../interfaces/account'
import { AddressState } from '../../interfaces/domains'
import { Network } from '../../interfaces/network'
import { Storage } from '../../interfaces/storage'
import { PersistedTransferUpdate, TransferUpdate } from '../../interfaces/transfer'
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

// TODO - document versioning
const PERSIST_STORAGE_KEY = 'transferState-v1'
const ALLOWED_PERSIST_KEYS: (keyof PersistedTransferUpdate)[] = [
  'amount',
  'amountFieldMode',
  'addressState',
  'isSWWarningAgreed',
  'isRecipientAddressUnknownAgreed',
  'selectedToken'
]

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

  #persistedState: PersistedTransferUpdate = {}

  constructor(
    storage: Storage,
    humanizerInfo: HumanizerMeta,
    selectedAccountData: Account,
    networks: Network[],
    portfolio: SelectedAccountPortfolio,
    shouldHydrate: boolean
  ) {
    super()

    this.#storage = storage
    this.#humanizerInfo = humanizerInfo
    this.#selectedAccountData = selectedAccountData
    this.#networks = networks
    this.#portfolio = portfolio

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
    const persistedState = await this.#storage.get(PERSIST_STORAGE_KEY, {})
    this.#persistedState = persistedState

    console.log('Hydrate:', persistedState)

    if (persistedState.selectedToken) {
      const portfolioToken = this.#portfolio.tokens.find(
        (token) =>
          token.address === persistedState.selectedToken.address &&
          token.networkId === persistedState.selectedToken.networkId
      )

      persistedState.selectedToken = portfolioToken
    }

    console.log('Hydrate (normalized):', persistedState)

    await this.update(persistedState, { isHydrate: true, shouldPersist: true })
  }

  #persist(updateInput: TransferUpdate) {
    console.log('Persist (latest input):', updateInput)
    const definedOnly: PersistedTransferUpdate = Object.fromEntries(
      ALLOWED_PERSIST_KEYS.map((key) => [key, updateInput[key]]).filter(
        ([, value]) => value !== undefined
      )
    )

    this.#persistedState = {
      ...this.#persistedState,
      ...definedOnly,
      ...(definedOnly.selectedToken && {
        selectedToken: {
          address: definedOnly.selectedToken.address,
          networkId: definedOnly.selectedToken.networkId
        }
      }),
      ...(definedOnly.addressState && {
        addressState: {
          ...this.#persistedState.addressState,
          ...definedOnly.addressState
        }
      })
    }

    console.log('Persist:', this.#persistedState)

    this.#storage.set(PERSIST_STORAGE_KEY, this.#persistedState)
  }

  #clearPersistedState() {
    console.log('Clear persisted state')
    this.#persistedState = {}
    this.#storage.remove(PERSIST_STORAGE_KEY)
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

  async update(
    updateInput: TransferUpdate,
    options?: { isHydrate?: boolean; shouldPersist?: boolean }
  ) {
    const { isHydrate, shouldPersist } = options || { isHydrate: false, shouldPersist: true }
    // If we're hydrating, we can safely skip waiting for #initialLoadPromise,
    // since #load() already loads the necessary storage values and triggers update() with the persisted input.
    // Otherwise, this.#initialLoadPromise may never resolve, because #load() calls update(),
    // while update() is waiting for #load() to resolve.
    if (!isHydrate) await this.#initialLoadPromise

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
    if (amountFieldMode) {
      this.amountFieldMode = amountFieldMode
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
      this.#clearPersistedState()
    }

    if (shouldPersist && !this.isTopUp) this.#persist(updateInput)
    this.emitUpdate()
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
