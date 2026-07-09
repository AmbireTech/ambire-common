import { expect } from '@jest/globals'

import { AccountStates } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { validateSendTransferAddress } from './validate'

const RECIPIENT = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
const SELECTED_ACCOUNT = '0xf9D6794F16CDbdC5b4873AEdeF4dC69d8D5edcaD'
const CHANGED_MESSAGE =
  'This name now resolves to a different address than the last time you sent to it. Verify the new recipient before proceeding.'

const networks: Network[] = []
const accountStates: AccountStates = {}

// Thin wrapper so each test only sets the args it cares about.
const validate = (overrides: {
  recipientDomainAddressChange?: { previousAddress: string } | null
  isRecipientAddressFirstTimeSend?: boolean
  isRecipientAddressUnknown?: boolean
  isDomain?: boolean
}) =>
  validateSendTransferAddress(
    RECIPIENT,
    SELECTED_ACCOUNT,
    false,
    overrides.isRecipientAddressUnknown ?? false,
    false,
    overrides.isDomain ?? true,
    false,
    networks,
    accountStates,
    undefined,
    undefined,
    overrides.isRecipientAddressFirstTimeSend ?? false,
    null,
    null,
    overrides.recipientDomainAddressChange ?? null
  )

describe('validateSendTransferAddress - recipient domain address change', () => {
  it('warns when the domain now resolves to a different address', () => {
    const result = validate({ recipientDomainAddressChange: { previousAddress: SELECTED_ACCOUNT } })

    expect(result.severity).toBe('warning')
    expect(result.message).toBe(CHANGED_MESSAGE)
  })

  it('takes priority over the first-time-send warning', () => {
    const result = validate({
      recipientDomainAddressChange: { previousAddress: SELECTED_ACCOUNT },
      isRecipientAddressFirstTimeSend: true,
      isRecipientAddressUnknown: true
    })

    expect(result.message).toBe(CHANGED_MESSAGE)
  })

  it('does not warn about a changed address when there is no change', () => {
    const result = validate({ recipientDomainAddressChange: null })

    expect(result.message).not.toBe(CHANGED_MESSAGE)
  })
})
