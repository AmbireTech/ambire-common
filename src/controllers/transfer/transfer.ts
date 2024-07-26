import { formatUnits, isAddress, parseUnits } from 'ethers'

import { FEE_COLLECTOR } from '../../consts/addresses'
import { Account } from '../../interfaces/account'
import { AddressState } from '../../interfaces/domains'
import { Network } from '../../interfaces/network'
import { TransferUpdate } from '../../interfaces/transfer'
import { isSmartAccount } from '../../libs/account/account'
import { HumanizerMeta } from '../../libs/humanizer/interfaces'
import { TokenResult } from '../../libs/portfolio'
import { getTokenAmount } from '../../libs/portfolio/helpers'
import { validateSendTransferAddress, validateSendTransferAmount } from '../../services/validations'
import { Contacts } from '../addressBook/addressBook'
import EventEmitter from '../eventEmitter/eventEmitter'

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

export class TransferController extends EventEmitter {
  #networks: Network[] = []

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

  constructor(humanizerInfo: HumanizerMeta, selectedAccountData: Account, networks: Network[]) {
    super()

    this.#humanizerInfo = humanizerInfo
    this.#selectedAccountData = selectedAccountData
    this.#networks = networks

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
      !this.selectedToken.decimals
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
    const tokenPriceBigInt = parseUnits(
      tokenPrice.toFixed(this.selectedToken.decimals),
      this.selectedToken.decimals
    )
    const pow = BigInt(10 ** this.selectedToken.decimals)

    return formatUnits((maxAmount * tokenPriceBigInt) / pow, this.selectedToken.decimals)
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

  update({
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
  }: TransferUpdate) {
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

    if (this.amountFieldMode === 'fiat' && this.selectedToken?.decimals) {
      this.amountInFiat = fieldValue
      const fieldValueBigInt = parseUnits(fieldValue, this.selectedToken.decimals * 2)

      const priceBigInt = parseUnits(
        tokenPrice.toFixed(this.selectedToken.decimals),
        this.selectedToken.decimals
      )

      this.amount = formatUnits(fieldValueBigInt / priceBigInt, this.selectedToken.decimals)
      return
    }
    if (this.amountFieldMode === 'token') {
      this.amount = fieldValue
      const formattedAmount = Number(this.amount)

      if (!formattedAmount) return

      this.amountInFiat = String(formattedAmount * tokenPrice)
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
      maxAmountInFiat: this.maxAmountInFiat
    }
  }
}
