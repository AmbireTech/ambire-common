import { formatUnits, isAddress } from 'ethers'
import { Network } from 'interfaces/network'

import { FEE_COLLECTOR } from '../../consts/addresses'
import { AccountId } from '../../interfaces/account'
import { AddressState } from '../../interfaces/domains'
import { TransferUpdate } from '../../interfaces/transfer'
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

export class TransferController extends EventEmitter {
  #networks: Network[] = []

  #addressBookContacts: Contacts = []

  #selectedToken: TokenResult | null = null

  #selectedAccount: string | null = null

  #humanizerInfo: HumanizerMeta | null = null

  isSWWarningVisible = false

  isSWWarningAgreed = false

  amount = ''

  addressState: AddressState = { ...DEFAULT_ADDRESS_STATE }

  isRecipientAddressUnknown = false

  isRecipientAddressUnknownAgreed = false

  isRecipientHumanizerKnownTokenOrSmartContract = false

  isTopUp: boolean = false

  constructor(humanizerInfo: HumanizerMeta, selectedAccount: AccountId, networks: Network[]) {
    super()

    this.#humanizerInfo = humanizerInfo
    this.#selectedAccount = selectedAccount
    this.#networks = networks

    this.emitUpdate()
  }

  // every time when updating selectedToken update the amount and maxAmount of the form
  set selectedToken(token: TokenResult | null) {
    if (!token || Number(getTokenAmount(token)) === 0) {
      this.#selectedToken = null
      this.amount = ''
      return
    }

    const prevSelectedToken = { ...this.selectedToken }

    this.#selectedToken = token

    if (
      prevSelectedToken?.address !== token?.address ||
      prevSelectedToken?.networkId !== token?.networkId
    ) {
      this.amount = ''
      this.#setSWWarningVisibleIfNeeded()
    }
  }

  get selectedToken() {
    return this.#selectedToken
  }

  get maxAmount() {
    if (
      !this.selectedToken ||
      getTokenAmount(this.selectedToken) === 0n ||
      !this.selectedToken.decimals
    )
      return '0'

    return formatUnits(getTokenAmount(this.selectedToken), Number(this.selectedToken.decimals))
  }

  resetForm() {
    this.amount = ''
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

    if (this.#humanizerInfo && this.#selectedAccount) {
      const isUDAddress = !!this.addressState.udAddress
      const isEnsAddress = !!this.addressState.ensAddress

      validationFormMsgsNew.recipientAddress = validateSendTransferAddress(
        this.recipientAddress,
        this.#selectedAccount,
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
    return !!this.#humanizerInfo && !!this.#selectedAccount && !!this.#networks.length
  }

  get recipientAddress() {
    return (
      this.addressState.ensAddress || this.addressState.udAddress || this.addressState.fieldValue
    )
  }

  update({
    selectedAccount,
    humanizerInfo,
    selectedToken,
    amount,
    addressState,
    isSWWarningAgreed,
    isRecipientAddressUnknownAgreed,
    isTopUp,
    networks,
    contacts
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
    if (selectedAccount) {
      if (this.#selectedAccount !== selectedAccount) {
        this.amount = ''
      }
      this.#selectedAccount = selectedAccount
    }
    if (selectedToken) {
      this.selectedToken = selectedToken
    }
    // If we do a regular check the value won't update if it's '' or '0'
    if (typeof amount === 'string') {
      this.amount = amount
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

  #setSWWarningVisibleIfNeeded() {
    this.isSWWarningVisible =
      this.isRecipientAddressUnknown &&
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
      maxAmount: this.maxAmount
    }
  }
}
