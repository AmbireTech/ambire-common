import { AddressState } from 'interfaces/domains'
import { FromToken, SwapAndBridgeToToken } from 'interfaces/swapAndBridge'
import EventEmitter from '../eventEmitter/eventEmitter'

const DEFAULT_ADDRESS_STATE = {
  fieldValue: '',
  ensAddress: '',
  isDomainResolving: false
}

export class TransactionFormState extends EventEmitter {
  fromAmount: string = ''

  fromAmountInFiat: string = ''

  fromAmountFieldMode: 'fiat' | 'token' = 'token'

  toAmount: string = ''

  toAmountInFiat: string = ''

  toAmountFieldMode: 'fiat' | 'token' = 'token'

  fromChainId: number | null = null

  toChainId: number | null = null

  addressState: AddressState = { ...DEFAULT_ADDRESS_STATE }

  isRecipientAddressUnknown = false

  isRecipientAddressUnknownAgreed = false

  isRecipientHumanizerKnownTokenOrSmartContract = false

  fromSelectedToken: FromToken | null = null

  toSelectedToken: SwapAndBridgeToToken | null = null

  update(params: any) {
    this.fromAmount = params.fromAmount
    this.emitUpdate()
  }

  reset() {
    this.fromAmount = ''
    this.fromAmountInFiat = ''
    this.fromAmountFieldMode = 'token'
    this.toAmount = ''
    this.toAmountInFiat = ''
    this.toAmountFieldMode = 'token'
  }

  get isFormEmpty() {
    return (
      !this.fromChainId ||
      !this.toChainId ||
      !this.fromAmount ||
      !this.toAmount ||
      !this.addressState.fieldValue
    )
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      fromAmount: this.fromAmount,
      fromAmountInFiat: this.fromAmountInFiat,
      fromAmountFieldMode: this.fromAmountFieldMode,
      toAmount: this.toAmount,
      toAmountInFiat: this.toAmountInFiat,
      toAmountFieldMode: this.toAmountFieldMode,
      fromChainId: this.fromChainId,
      toChainId: this.toChainId,
      addressState: this.addressState,
      isRecipientAddressUnknown: this.isRecipientAddressUnknown,
      isRecipientAddressUnknownAgreed: this.isRecipientAddressUnknownAgreed,
      isRecipientHumanizerKnownTokenOrSmartContract:
        this.isRecipientHumanizerKnownTokenOrSmartContract,
      fromSelectedToken: this.fromSelectedToken,
      toSelectedToken: this.toSelectedToken
    }
  }
}
