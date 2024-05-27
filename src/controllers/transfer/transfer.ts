import erc20Abi from 'adex-protocol-eth/abi/ERC20.json'
import { AddressBookController } from 'controllers/addressBook/addressBook'
import { SettingsController } from 'controllers/settings/settings'
import { formatUnits, Interface, isAddress, parseUnits } from 'ethers'

import { FEE_COLLECTOR } from '../../consts/addresses'
import { AddressState } from '../../interfaces/domains'
import { TransferUpdate } from '../../interfaces/transfer'
import { SignUserRequest } from '../../interfaces/userRequest'
import { HumanizerMeta } from '../../libs/humanizer/interfaces'
import { TokenResult } from '../../libs/portfolio'
import { getTokenAmount } from '../../libs/portfolio/helpers'
import { validateSendTransferAddress, validateSendTransferAmount } from '../../services/validations'
import EventEmitter from '../eventEmitter/eventEmitter'

const ERC20 = new Interface(erc20Abi)

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
  // State
  #settings: SettingsController

  #addressBook: AddressBookController

  #tokens: TokenResult[] = []

  #selectedToken: TokenResult | null = null

  isSWWarningVisible = false

  isSWWarningAgreed = false

  amount = ''

  addressState: AddressState = { ...DEFAULT_ADDRESS_STATE }

  isRecipientAddressUnknown = false

  isRecipientAddressUnknownAgreed = false

  isRecipientHumanizerKnownTokenOrSmartContract = false

  userRequest: SignUserRequest | null = null

  #selectedTokenNetworkData: {
    id: string
    unstoppableDomainsChain: string
  } | null = null

  #selectedAccount: string | null = null

  #humanizerInfo: HumanizerMeta | null = null

  isTopUp: boolean = false

  constructor(settings: SettingsController, addressBook: AddressBookController) {
    super()
    this.#settings = settings
    this.#addressBook = addressBook
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

  set tokens(tokenResults: TokenResult[]) {
    const filteredTokens = tokenResults.filter(
      (token) => Number(getTokenAmount(token)) > 0 && !token.flags.onGasTank
    )
    this.#tokens = filteredTokens
    this.#updateSelectedTokenIfNeeded(filteredTokens)
  }

  get tokens() {
    return this.#tokens
  }

  resetForm() {
    this.amount = ''
    this.addressState = { ...DEFAULT_ADDRESS_STATE }
    this.selectedToken = null
    this.#selectedTokenNetworkData = null
    this.isRecipientAddressUnknown = false
    this.userRequest = null
    this.isRecipientAddressUnknownAgreed = false
    this.isRecipientHumanizerKnownTokenOrSmartContract = false
    this.isSWWarningVisible = false
    this.isSWWarningAgreed = false

    this.emitUpdate()
  }

  reset() {
    this.resetForm()
    this.tokens = []
    this.#humanizerInfo = null
    this.#selectedAccount = null

    this.emitUpdate()
  }

  get validationFormMsgs() {
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
        this.addressState.isDomainResolving
      )
    }

    // Validate the amount
    if (this.selectedToken) {
      validationFormMsgsNew.amount = validateSendTransferAmount(this.amount, this.selectedToken)
    }

    return validationFormMsgsNew
  }

  get isFormValid() {
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
    return !!this.#humanizerInfo && !!this.#selectedAccount && !!this.tokens
  }

  get recipientAddress() {
    return (
      this.addressState.ensAddress || this.addressState.udAddress || this.addressState.fieldValue
    )
  }

  update({
    selectedAccount,
    humanizerInfo,
    tokens,
    selectedToken,
    amount,
    addressState,
    isSWWarningAgreed,
    isRecipientAddressUnknownAgreed,
    isTopUp
  }: TransferUpdate) {
    if (humanizerInfo) {
      this.#humanizerInfo = humanizerInfo
    }
    if (selectedAccount) {
      if (this.#selectedAccount !== selectedAccount) {
        this.amount = ''
      }
      this.#selectedAccount = selectedAccount
    }
    if (tokens) {
      this.tokens = tokens
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
      if (!this.isInitialized) return

      this.#onRecipientAddressChange()
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

  async buildUserRequest() {
    if (!this.isInitialized) {
      this.#throwNotInitialized()
      return
    }

    if (!this.selectedToken || !this.#selectedTokenNetworkData || !this.#selectedAccount) return

    // if the request is a top up, the recipient is the relayer
    const recipientAddress = this.isTopUp
      ? FEE_COLLECTOR.toLowerCase()
      : this.recipientAddress.toLowerCase()
    const sanitizedAmount = this.amount.split('.')
    if (sanitizedAmount[1])
      sanitizedAmount[1] = sanitizedAmount[1].slice(0, this.selectedToken.decimals)

    const bigNumberHexAmount = `0x${parseUnits(
      sanitizedAmount.join('.'),
      Number(this.selectedToken.decimals)
    ).toString(16)}`

    const txn = {
      to: this.selectedToken.address,
      value: BigInt(0),
      data: ERC20.encodeFunctionData('transfer', [recipientAddress, bigNumberHexAmount])
    }

    if (Number(this.selectedToken.address) === 0) {
      txn.to = recipientAddress
      txn.value = BigInt(bigNumberHexAmount)
      txn.data = '0x'
    }

    this.userRequest = {
      id: new Date().getTime(),
      action: { kind: 'call' as const, txns: [txn] },
      meta: {
        isSignAction: true,
        networkId: this.#selectedTokenNetworkData.id,
        accountAddr: this.#selectedAccount
      }
    }

    this.emitUpdate()
  }

  checkIsRecipientAddressUnknown() {
    const isAddressInAddressBook = this.#addressBook.contacts.some(
      ({ address }) => address.toLowerCase() === this.recipientAddress.toLowerCase()
    )

    this.isRecipientAddressUnknown =
      isAddress(this.recipientAddress) &&
      !isAddressInAddressBook &&
      this.recipientAddress.toLowerCase() !== FEE_COLLECTOR.toLowerCase()
    this.isRecipientAddressUnknownAgreed = false
    this.#setSWWarningVisibleIfNeeded()

    this.emitUpdate()
  }

  // Allows for debounce implementation in the UI
  #onRecipientAddressChange() {
    if (!this.isInitialized) {
      this.#throwNotInitialized()
      return
    }

    if (this.#humanizerInfo) {
      // @TODO: could fetch address code
      this.isRecipientHumanizerKnownTokenOrSmartContract =
        !!this.#humanizerInfo.knownAddresses[this.recipientAddress.toLowerCase()]?.isSC
    }

    this.checkIsRecipientAddressUnknown()
  }

  #updateSelectedTokenIfNeeded(updatedTokens: TokenResult[]) {
    this.selectedToken =
      updatedTokens.find(
        ({ address: tokenAddress, networkId: tokenNetworkId }) =>
          tokenAddress === this.selectedToken?.address &&
          tokenNetworkId === this.selectedToken?.networkId
      ) ||
      updatedTokens[0] ||
      null

    this.emitUpdate()
  }

  #setSWWarningVisibleIfNeeded() {
    this.#selectedTokenNetworkData =
      this.#settings.networks.find(({ id }) => id === this.selectedToken?.networkId) || null

    this.isSWWarningVisible =
      this.isRecipientAddressUnknown &&
      !this.isTopUp &&
      !!this.selectedToken?.address &&
      Number(this.selectedToken?.address) === 0 &&
      this.#settings.networks
        .filter((n) => n.id !== 'ethereum')
        .map(({ id }) => id)
        .includes(this.#selectedTokenNetworkData?.id || 'ethereum')

    this.emitUpdate()
  }

  #throwNotInitialized() {
    this.emitError({
      level: 'major',
      message:
        'We encountered an internal error during transfer initialization. Retry, or contact support if the issue persists.',
      error: new Error('transfer: controller not initialized')
    })
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
      tokens: this.tokens,
      maxAmount: this.maxAmount
    }
  }
}
