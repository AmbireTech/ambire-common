import erc20Abi from 'adex-protocol-eth/abi/ERC20.json'
import { formatUnits, Interface, parseUnits } from 'ethers'

import { HumanizerInfoType } from '../../../v1/hooks/useConstants'
import { networks } from '../../consts/networks'
import { UserRequest } from '../../interfaces/userRequest'
import { TokenResult } from '../../libs/portfolio'
import { isKnownTokenOrContract } from '../../services/address'
import { getBip44Items, resolveENSDomain } from '../../services/ensDomains'
import { resolveUDomain } from '../../services/unstoppableDomains'
import { validateSendTransferAddress, validateSendTransferAmount } from '../../services/validations'
import EventEmitter from '../eventEmitter'

const ERC20 = new Interface(erc20Abi)

const getTokenAddressAndNetworkFromId = (id: string) => {
  const [address, networkId] = id.split('-')
  return [address, networkId]
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
  isInitialized = false

  tokens: TokenResult[] = []

  selectedToken: TokenResult | null = null

  isSWWarningVisible = false

  isSWWarningAgreed = false

  amount = '0'

  maxAmount = '0'

  recipientAddress = ''

  recipientEnsAddress = ''

  recipientUDAddress = ''

  isRecipientDomainResolving = false

  isRecipientAddressUnknown = false

  isRecipientAddressUnknownAgreed = false

  isRecipientSmartContract = false

  userRequest: UserRequest | null = null

  validationFormMsgs = DEFAULT_VALIDATION_FORM_MSGS

  isFormValid = false

  #selectedTokenNetworkData: {
    id: string
    unstoppableDomainsChain: string
  } | null = null

  #selectedAccount: string | null = null

  #humanizerInfo: HumanizerInfoType | null = null

  async init({
    selectedAccount,
    preSelectedToken,
    // The old humanizer from ambire-constants. @TODO: replace it with the new one?
    humanizerInfo,
    tokens
  }: {
    selectedAccount: string
    preSelectedToken?: string
    humanizerInfo: HumanizerInfoType
    tokens: TokenResult[]
  }) {
    // @TODO: implement new humanizer after the sign-account-op PR gets merged
    if (!humanizerInfo) {
      this.emitError({
        level: 'major',
        message: 'Internal transfer error. Please retry, or contact support if issue persists.',
        error: new Error('transfer: missing humanizerInfo')
      })

      return
    }
    if (!selectedAccount) {
      this.emitError({
        level: 'major',
        message: 'Internal transfer error. Please retry, or contact support if issue persists.',
        error: new Error('transfer: missing selectedAccount')
      })
      return
    }

    this.#humanizerInfo = humanizerInfo
    this.#selectedAccount = selectedAccount

    this.tokens = tokens.filter((token) => token.amount !== 0n)

    if (preSelectedToken) {
      this.handleTokenChange(preSelectedToken)
    } else if (!preSelectedToken && this.tokens.length > 0) {
      const firstToken = this.tokens[0]
      const firstTokenAddressAndNetwork = `${firstToken.address}-${firstToken.networkId}`

      this.handleTokenChange(firstTokenAddressAndNetwork)
    }
    this.isInitialized = true

    this.emitUpdate()
  }

  reset() {
    this.isInitialized = false
    this.amount = '0'
    this.recipientAddress = ''
    this.recipientEnsAddress = ''
    this.recipientUDAddress = ''
    this.isRecipientAddressUnknown = false
    this.selectedToken = this.tokens[0]
    this.#selectedTokenNetworkData = null
    this.userRequest = null
    this.isRecipientAddressUnknown = false
    this.isRecipientAddressUnknownAgreed = false
    this.isRecipientSmartContract = false
    this.isSWWarningVisible = false
    this.isSWWarningAgreed = false
    this.validationFormMsgs = DEFAULT_VALIDATION_FORM_MSGS
    this.isFormValid = false

    this.emitUpdate()
  }

  update({
    amount,
    recipientAddress,
    setMaxAmount,
    isSWWarningAgreed,
    isRecipientAddressUnknownAgreed
  }: {
    amount?: string
    recipientAddress?: string
    setMaxAmount?: boolean
    isSWWarningAgreed?: boolean
    isRecipientAddressUnknownAgreed?: boolean
  }) {
    if (!this.isInitialized) {
      this.#throwNotInitialized()
      return
    }
    // If we do a regular check the value won't update if it's '' or '0'
    if (typeof amount === 'string') {
      this.amount = amount
    }
    // We can do a regular check here, because the property defines if it should be updated
    // and not the actual value
    if (setMaxAmount) {
      this.amount = this.maxAmount
    }
    // If we do a regular check the value won't update if it's '' or '0'
    if (typeof recipientAddress === 'string') {
      const canBeEnsOrUd = recipientAddress.indexOf('.') !== -1

      if (canBeEnsOrUd) {
        this.isRecipientDomainResolving = true
      } else {
        this.isRecipientDomainResolving = false
      }

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

    this.#validateForm()
    this.emitUpdate()
  }

  async buildUserRequest() {
    if (!this.isInitialized) {
      this.#throwNotInitialized()
      return
    }
    const recipientAddress =
      this.recipientUDAddress || this.recipientEnsAddress || this.recipientAddress

    if (!this.selectedToken || !this.#selectedTokenNetworkData || !this.#selectedAccount) return

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

    const req: UserRequest = {
      id: new Date().getTime(),
      networkId: this.#selectedTokenNetworkData.id,
      accountAddr: this.#selectedAccount,
      forceNonce: null,
      action: txn
    }

    this.userRequest = req

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
      this.recipientUDAddress = await resolveUDomain(
        address,
        this.selectedToken.symbol,
        this.#selectedTokenNetworkData.unstoppableDomainsChain
      )

      const bip44Item = getBip44Items(this.selectedToken.symbol)
      this.recipientEnsAddress = await resolveENSDomain(address, bip44Item)
    }
    if (this.#humanizerInfo) {
      this.isRecipientSmartContract = isKnownTokenOrContract(this.#humanizerInfo, address)
    }

    if (this.recipientUDAddress || this.recipientEnsAddress) {
      this.isRecipientAddressUnknown = true // @TODO: check from the address book
    }

    this.isRecipientAddressUnknown = true // @TODO: isValidAddress & check from the address book
    this.isRecipientDomainResolving = false

    this.#validateForm()

    this.emitUpdate()
  }

  handleTokenChange(tokenAddressAndNetwork: string) {
    const [selectedTokenAddress, selectedTokenNetwork] =
      getTokenAddressAndNetworkFromId(tokenAddressAndNetwork)

    const matchingToken =
      this.tokens.find(
        ({ address: tokenAddress, networkId: tokenNetworkId }) =>
          tokenAddress === selectedTokenAddress && tokenNetworkId === selectedTokenNetwork
      ) || this.tokens[0]

    const { amount: matchingTokenAmount, decimals } = matchingToken

    this.selectedToken = matchingToken
    this.#selectedTokenNetworkData =
      networks.find(({ id }) => id === matchingToken.networkId) || null
    this.amount = '0'
    this.validationFormMsgs.amount = DEFAULT_VALIDATION_FORM_MSGS.amount
    this.isFormValid = false
    this.maxAmount = formatUnits(matchingTokenAmount, Number(decimals))
    this.isSWWarningVisible =
      !!this.selectedToken?.address &&
      Number(this.selectedToken?.address) === 0 &&
      networks
        .map(({ id }) => id)
        .filter((id) => id !== 'ethereum')
        .includes(this.#selectedTokenNetworkData?.id || 'ethereum')

    this.emitUpdate()
  }

  #validateForm() {
    // Validate the recipient address
    if (this.#humanizerInfo && this.#selectedAccount) {
      const isUDAddress = !!this.recipientUDAddress
      const isEnsAddress = !!this.recipientEnsAddress

      this.validationFormMsgs.recipientAddress = validateSendTransferAddress(
        this.recipientUDAddress || this.recipientEnsAddress || this.recipientAddress,
        this.#selectedAccount,
        this.isRecipientAddressUnknownAgreed,
        this.isRecipientAddressUnknown,
        this.#humanizerInfo,
        isUDAddress,
        isEnsAddress,
        this.isRecipientDomainResolving
      )
    }

    // Validate the amount
    if (this.selectedToken) {
      this.validationFormMsgs.amount = validateSendTransferAmount(this.amount, this.selectedToken)
    }

    // Determine if the form is valid
    const areFormFieldsValid =
      this.validationFormMsgs.amount.success && this.validationFormMsgs.recipientAddress.success

    const isSWWarningMissingOrAccepted = !this.isSWWarningVisible || this.isSWWarningAgreed

    const isRecipientAddressUnknownMissingOrAccepted =
      !this.isRecipientAddressUnknown || this.isRecipientAddressUnknownAgreed

    this.isFormValid =
      areFormFieldsValid &&
      isSWWarningMissingOrAccepted &&
      isRecipientAddressUnknownMissingOrAccepted &&
      !this.isRecipientDomainResolving

    this.emitUpdate()
  }

  #throwNotInitialized() {
    this.emitError({
      level: 'major',
      message:
        'We encountered an internal error during transfer initialization. Retry, or contact support if issue persists.',
      error: new Error('transfer: controller not initialized')
    })
  }
}
