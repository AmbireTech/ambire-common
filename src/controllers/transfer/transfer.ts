import erc20Abi from 'adex-protocol-eth/abi/ERC20.json'
import { SettingsController } from 'controllers/settings/settings'
import { formatUnits, Interface, parseUnits } from 'ethers'

import { FEE_COLLECTOR } from '../../consts/addresses'
import { AddressState } from '../../interfaces/domains'
import { TransferUpdate } from '../../interfaces/transfer'
import { UserRequest } from '../../interfaces/userRequest'
import { TokenResult } from '../../libs/portfolio'
import { getTokenAmount } from '../../libs/portfolio/helpers'
import EventEmitter from '../eventEmitter/eventEmitter'

const ERC20 = new Interface(erc20Abi)

const DEFAULT_ADDRESS_STATE = {
  fieldValue: '',
  ensAddress: '',
  udAddress: '',
  isDomainResolving: false
}

export class TransferController extends EventEmitter {
  // State
  #settings: SettingsController

  #selectedToken: TokenResult | null = null

  isSWWarningAgreed = false

  amount = ''

  addressState: AddressState = { ...DEFAULT_ADDRESS_STATE }

  isRecipientAddressUnknownAgreed = false

  userRequest: UserRequest | null = null

  #selectedTokenNetworkData: {
    id: string
    unstoppableDomainsChain: string
  } | null = null

  #selectedAccount: string | null = null

  isTopUp: boolean = false

  constructor(settings: SettingsController) {
    super()
    this.#settings = settings
  }

  // every time when updating selectedToken update the amount and maxAmount of the form
  set selectedToken(token: TokenResult | null) {
    if (!token || Number(getTokenAmount(token)) === 0) {
      this.#selectedToken = null
      this.#selectedTokenNetworkData = null
      this.amount = ''
      return
    }

    const prevSelectedToken = { ...this.selectedToken }

    this.#selectedToken = token
    this.#selectedTokenNetworkData =
      this.#settings.networks.find((network) => network.id === token.networkId) || null

    if (
      prevSelectedToken?.address !== token?.address ||
      prevSelectedToken?.networkId !== token?.networkId
    ) {
      this.amount = ''
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
    this.selectedToken = null
    this.#selectedTokenNetworkData = null
    this.userRequest = null
    this.isRecipientAddressUnknownAgreed = false
    this.isSWWarningAgreed = false

    this.emitUpdate()
  }

  reset() {
    this.resetForm()
    this.#selectedAccount = null

    this.emitUpdate()
  }

  get isInitialized() {
    return !!this.#selectedAccount
  }

  get recipientAddress() {
    return (
      this.addressState.ensAddress || this.addressState.udAddress || this.addressState.fieldValue
    )
  }

  update({
    selectedAccount,
    selectedToken,
    amount,
    addressState,
    isSWWarningAgreed,
    isRecipientAddressUnknownAgreed,
    isTopUp
  }: TransferUpdate) {
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
      // Because controller state is synced with FE addressState, we need to check if the value
      // has actually changed. Otherwise we will reset isRecipientAddressUnknownAgreed for no reason
      if (this.addressState.fieldValue !== addressState.fieldValue) {
        this.isRecipientAddressUnknownAgreed = false
      }
      this.addressState = {
        ...this.addressState,
        ...addressState
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

    const bigNumberHexAmount = `0x${parseUnits(
      parseFloat(this.amount).toFixed(this.selectedToken.decimals).toString(),
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
      isInitialized: this.isInitialized,
      selectedToken: this.selectedToken,
      maxAmount: this.maxAmount
    }
  }
}
