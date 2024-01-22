import erc20Abi from 'adex-protocol-eth/abi/ERC20.json'
import { formatUnits, getAddress, Interface, parseUnits } from 'ethers'

import { HumanizerInfoType } from '../../../v1/hooks/useConstants'
import { networks } from '../../consts/networks'
import { UserRequest } from '../../interfaces/userRequest'
import { TokenResult } from '../../libs/portfolio'
import { isKnownTokenOrContract } from '../../services/address'
import { validateSendTransferAddress, validateSendTransferAmount } from '../../services/validations'
import EventEmitter from '../eventEmitter'

const ERC20 = new Interface(erc20Abi)

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

const DEFAULT_RECIPIENT = {
  address: '',
  isENS: false,
  isUD: false,
  isDomainResolving: false
}

export class TransferController extends EventEmitter {
  // State
  #tokens: TokenResult[] = []

  #selectedToken: TokenResult | null = null

  isSWWarningVisible = false

  isSWWarningAgreed = false

  amount = ''

  maxAmount = '0'

  recipient = DEFAULT_RECIPIENT

  isRecipientAddressUnknown = false

  isRecipientAddressUnknownAgreed = false

  isRecipientSmartContract = false

  userRequest: UserRequest | null = null

  #selectedTokenNetworkData: {
    id: string
    unstoppableDomainsChain: string
  } | null = null

  #selectedAccount: string | null = null

  #humanizerInfo: HumanizerInfoType | null = null

  // every time when updating selectedToken update the amount and maxAmount of the form
  set selectedToken(token: TokenResult | null) {
    if (
      this.selectedToken?.address !== token?.address ||
      this.selectedToken?.networkId !== token?.networkId
    ) {
      this.#selectedToken = token
      this.amount = ''
      this.#setSWWarningVisibleIfNeeded()
    }
    // on portfolio update the max available amount can change for the selectedToken
    // in that case don't update the selectedToken and amount in the form but only the maxAmount value
    this.maxAmount = token ? formatUnits(token.amount, Number(token.decimals)) : '0'
  }

  get selectedToken() {
    return this.#selectedToken
  }

  set tokens(tokenResults: TokenResult[]) {
    const filteredTokens = tokenResults.filter(
      (token) => token.amount !== 0n && !token.flags.onGasTank
    )
    this.#tokens = filteredTokens
    this.#updateSelectedTokenIfNeeded(filteredTokens)
  }

  get tokens() {
    return this.#tokens
  }

  resetForm() {
    this.amount = ''
    this.maxAmount = '0'
    this.selectedToken = null
    this.#selectedTokenNetworkData = null
    this.isRecipientAddressUnknown = false
    this.recipient = DEFAULT_RECIPIENT
    this.userRequest = null
    this.isRecipientAddressUnknownAgreed = false
    this.isRecipientSmartContract = false
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
      validationFormMsgsNew.recipientAddress = validateSendTransferAddress(
        this.recipient.address,
        this.#selectedAccount,
        this.isRecipientAddressUnknownAgreed,
        this.isRecipientAddressUnknown,
        this.#humanizerInfo,
        this.recipient.isUD,
        this.recipient.isENS,
        this.recipient.isDomainResolving
      )
    }

    // Validate the amount
    if (this.selectedToken && (this.amount !== '' || this.recipient.address !== '')) {
      validationFormMsgsNew.amount = validateSendTransferAmount(this.amount, this.selectedToken)
    }

    return validationFormMsgsNew
  }

  get isFormValid() {
    const areFormFieldsValid =
      this.validationFormMsgs.amount.success && this.validationFormMsgs.recipientAddress.success

    const isSWWarningMissingOrAccepted = !this.isSWWarningVisible || this.isSWWarningAgreed

    const isRecipientAddressUnknownMissingOrAccepted =
      !this.isRecipientAddressUnknown || this.isRecipientAddressUnknownAgreed

    return (
      areFormFieldsValid &&
      isSWWarningMissingOrAccepted &&
      isRecipientAddressUnknownMissingOrAccepted &&
      !this.recipient.isDomainResolving
    )
  }

  get isInitialized() {
    return !!this.#humanizerInfo && !!this.#selectedAccount && !!this.tokens
  }

  update({
    selectedAccount,
    humanizerInfo,
    tokens,
    selectedToken,
    amount,
    recipient,
    isSWWarningAgreed,
    isRecipientAddressUnknownAgreed
  }: {
    selectedAccount?: string
    preSelectedToken?: string
    humanizerInfo?: HumanizerInfoType
    tokens?: TokenResult[]
    selectedToken?: TokenResult
    amount?: string
    recipient?: any
    isSWWarningAgreed?: boolean
    isRecipientAddressUnknownAgreed?: boolean
  }) {
    if (humanizerInfo) {
      this.#humanizerInfo = humanizerInfo
    }
    if (selectedAccount) {
      this.#selectedAccount = selectedAccount
      this.amount = ''
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
    if (recipient) {
      this.recipient = recipient
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

    this.emitUpdate()
  }

  async buildUserRequest() {
    if (!this.isInitialized) {
      this.#throwNotInitialized()
      return
    }

    if (!this.selectedToken || !this.#selectedTokenNetworkData || !this.#selectedAccount) return

    const recipientAddress = getAddress(this.recipient.address)

    const bigNumberHexAmount = `0x${parseUnits(
      this.amount,
      Number(this.selectedToken.decimals)
    ).toString(16)}`

    const txn = {
      kind: 'call' as const,
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
      networkId: this.#selectedTokenNetworkData.id,
      accountAddr: this.#selectedAccount,
      forceNonce: null,
      action: txn
    }

    this.emitUpdate()
  }

  // Allows for debounce implementation in the UI
  async onRecipientAddressChange() {
    if (!this.isInitialized) {
      this.#throwNotInitialized()
      return
    }

    if (this.#humanizerInfo) {
      // @TODO: could fetch address code
      this.isRecipientSmartContract = isKnownTokenOrContract(
        this.#humanizerInfo,
        this.recipient.address
      )
    }

    if (this.recipient.isUD || this.recipient.isENS) {
      this.isRecipientAddressUnknown = true // @TODO: check from the address book
    }

    this.isRecipientAddressUnknown = true // @TODO: isValidAddress & check from the address book

    this.emitUpdate()
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
      networks.find(({ id }) => id === this.selectedToken?.networkId) || null

    this.isSWWarningVisible =
      !!this.selectedToken?.address &&
      Number(this.selectedToken?.address) === 0 &&
      networks
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
      validationFormMsgs: this.validationFormMsgs,
      isFormValid: this.isFormValid,
      isInitialized: this.isInitialized,
      selectedToken: this.selectedToken,
      tokens: this.tokens
    }
  }
}
