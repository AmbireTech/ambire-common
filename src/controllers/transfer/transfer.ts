import erc20Abi from 'adex-protocol-eth/abi/ERC20.json'
import { ethers, formatUnits, getAddress, Interface, parseUnits } from 'ethers'

import { HumanizerInfoType } from '../../../v1/hooks/useConstants'
import { FEE_COLLECTOR } from '../../consts/addresses'
import { networks } from '../../consts/networks'
import { UserRequest } from '../../interfaces/userRequest'
import { TokenResult } from '../../libs/portfolio'
import { isHumanizerKnownTokenOrSmartContract } from '../../services/address'
import { getBip44Items, resolveENSDomain } from '../../services/ensDomains'
import { resolveUDomain } from '../../services/unstoppableDomains'
import { validateSendTransferAddress, validateSendTransferAmount } from '../../services/validations'
import EventEmitter from '../eventEmitter/eventEmitter'

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

export class TransferController extends EventEmitter {
  // State
  #tokens: TokenResult[] = []

  #selectedToken: TokenResult | null = null

  isSWWarningVisible = false

  isSWWarningAgreed = false

  amount = ''

  maxAmount = '0'

  recipientAddress = ''

  recipientEnsAddress = ''

  recipientUDAddress = ''

  isRecipientDomainResolving = false

  isRecipientAddressUnknown = false

  isRecipientAddressUnknownAgreed = false

  isRecipientHumanizerKnownTokenOrSmartContract = false

  userRequest: UserRequest | null = null

  #selectedTokenNetworkData: {
    id: string
    unstoppableDomainsChain: string
  } | null = null

  #selectedAccount: string | null = null

  #humanizerInfo: HumanizerInfoType | null = null

  isTopUp: boolean = false

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
    this.recipientAddress = ''
    this.recipientEnsAddress = ''
    this.recipientUDAddress = ''
    this.selectedToken = null
    this.#selectedTokenNetworkData = null
    this.isRecipientAddressUnknown = false
    this.isRecipientDomainResolving = false
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
      const isUDAddress = !!this.recipientUDAddress
      const isEnsAddress = !!this.recipientEnsAddress

      validationFormMsgsNew.recipientAddress = validateSendTransferAddress(
        this.recipientUDAddress || this.recipientEnsAddress || this.recipientAddress,
        this.#selectedAccount,
        this.isRecipientAddressUnknownAgreed,
        this.isRecipientAddressUnknown,
        this.isRecipientHumanizerKnownTokenOrSmartContract,
        isUDAddress,
        isEnsAddress,
        this.isRecipientDomainResolving
      )
    }

    // Validate the amount
    if (this.selectedToken && (this.amount !== '' || this.recipientAddress !== '')) {
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
      !this.isRecipientDomainResolving
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
    recipientAddress,
    isSWWarningAgreed,
    isRecipientAddressUnknownAgreed,
    isTopUp
  }: {
    selectedAccount?: string
    preSelectedToken?: string
    humanizerInfo?: HumanizerInfoType
    tokens?: TokenResult[]
    selectedToken?: TokenResult
    amount?: string
    recipientAddress?: string
    isSWWarningAgreed?: boolean
    isRecipientAddressUnknownAgreed?: boolean
    isTopUp?: boolean
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
    // If we do a regular check the value won't update if it's '' or '0'
    if (typeof recipientAddress === 'string') {
      const canBeEnsOrUd = recipientAddress.indexOf('.') !== -1
      this.isRecipientDomainResolving = canBeEnsOrUd

      this.recipientAddress = recipientAddress.trim()
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
      ? FEE_COLLECTOR
      : getAddress(this.recipientUDAddress || this.recipientEnsAddress || this.recipientAddress)

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
    const address = this.recipientAddress.trim()
    const canBeEnsOrUd = address.indexOf('.') !== -1

    if (!canBeEnsOrUd) {
      if (this.recipientUDAddress) this.recipientUDAddress = ''
      if (this.recipientEnsAddress) this.recipientEnsAddress = ''
    }

    if (this.selectedToken?.networkId && this.#selectedTokenNetworkData && canBeEnsOrUd) {
      try {
        this.recipientUDAddress = await resolveUDomain(
          address,
          this.selectedToken.symbol,
          this.#selectedTokenNetworkData.unstoppableDomainsChain
        )
      } catch {
        this.emitError({
          level: 'major',
          message:
            'We encountered an internal error during UD resolving. Retry, or contact support if the issue persists.',
          error: new Error('transfer: UD resolving failed')
        })
      }

      const bip44Item = getBip44Items(this.selectedToken.symbol)

      try {
        this.recipientEnsAddress = await resolveENSDomain(address, bip44Item)
      } catch {
        // Don't throw an error if the address is already resolved as UD
        if (!this.recipientUDAddress) {
          this.emitError({
            level: 'major',
            message:
              'We encountered an internal error during ENS resolving. Retry, or contact support if the issue persists.',
            error: new Error('transfer: ENS resolving failed')
          })
        }
      }
    }
    if (this.#humanizerInfo) {
      // @TODO: could fetch address code
      this.isRecipientHumanizerKnownTokenOrSmartContract = isHumanizerKnownTokenOrSmartContract(
        this.#humanizerInfo,
        address
      )
    }

    if (this.recipientUDAddress || this.recipientEnsAddress) {
      this.isRecipientAddressUnknown = true // @TODO: check from the address book
    }

    // @TODO: isValidAddress & check from the address book
    this.isRecipientAddressUnknown =
      (!this.recipientUDAddress && !this.recipientEnsAddress
        ? ethers.getAddress(address)
        : address) !== FEE_COLLECTOR
    this.isRecipientDomainResolving = false

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
      !this.isTopUp &&
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
