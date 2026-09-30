import { expect } from '@jest/globals'

import { AccountStates } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { validateSendTransferAddress } from './validate'

const RECIPIENT = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
const SELECTED_ACCOUNT = '0xf9D6794F16CDbdC5b4873AEdeF4dC69d8D5edcaD'
const CHANGED_MESSAGE =
  'This name now resolves to a different address than the last time you sent to it. Verify the new recipient before proceeding.'
const BLACKLISTED_MESSAGE =
  'This address is known for stealing funds. Anything you send to it will be lost.'

const networks: Network[] = []
const accountStates: AccountStates = {}

// Thin wrapper so each test only sets the args it cares about.
const validate = (overrides: {
  recipientDomainAddressChange?: { previousAddress: string } | null
  isRecipientAddressFirstTimeSend?: boolean
  isRecipientAddressUnknown?: boolean
  isDomain?: boolean
  isRecipientAddressBlacklisted?: boolean | null
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
    overrides.recipientDomainAddressChange ?? null,
    overrides.isRecipientAddressBlacklisted === undefined
      ? false
      : overrides.isRecipientAddressBlacklisted
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

describe('validateSendTransferAddress - blacklisted recipient', () => {
  it('errors when the recipient is in the phishing list', () => {
    const result = validate({ isRecipientAddressBlacklisted: true })

    expect(result.message).toBe(BLACKLISTED_MESSAGE)
    // 'error' keeps the buttons of the transfer form disabled, so the user cannot proceed.
    expect(result.severity).toBe('error')
  })

  it('takes priority over every other recipient message', () => {
    const result = validate({
      isRecipientAddressBlacklisted: true,
      recipientDomainAddressChange: { previousAddress: SELECTED_ACCOUNT },
      isRecipientAddressFirstTimeSend: true,
      isRecipientAddressUnknown: true
    })

    expect(result.message).toBe(BLACKLISTED_MESSAGE)
  })

  it('does not warn when the recipient is not in the phishing list', () => {
    const result = validate({ isRecipientAddressBlacklisted: false })

    expect(result.message).not.toBe(BLACKLISTED_MESSAGE)
  })

  it('says the check has not answered yet rather than reassuring the user', () => {
    // The list loads in the background, so an address entered before it is ready cannot be
    // judged. Falling through to the messages below would show a reassuring one and then flip
    // to the scam error once the answer lands.
    const result = validate({ isRecipientAddressBlacklisted: null })

    expect(result.severity).toBe('warning')
    expect(result.message).toContain("couldn't check this address")
  })

  it('still lets a wallet that never reached the list be used', () => {
    // A warning, not an error: an error keeps the form disabled, which would strand a first
    // run with no network.
    const result = validate({ isRecipientAddressBlacklisted: null })

    expect(result.severity).not.toBe('error')
  })

  it('a confirmed hit still outranks the unanswered state', () => {
    const result = validate({ isRecipientAddressBlacklisted: true })

    expect(result.message).toBe(BLACKLISTED_MESSAGE)
  })
})
