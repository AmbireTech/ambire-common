// This class should only contain the state of the form to be used

import { AddressState } from 'interfaces/domains'

const DEFAULT_ADDRESS_STATE = {
  fieldValue: '',
  ensAddress: '',
  isDomainResolving: false
}

// in the only page of the transaction flow
export class TransactionFormState {
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

  update(params: Partial<TransactionFormState>) {
    Object.assign(this, params)
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
}
