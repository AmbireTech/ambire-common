import { expect } from '@jest/globals'

import { AccountStates } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { AddressPoisoningMatch } from '../../interfaces/transfer'
import { validateSendTransferAddress } from './validate'

const RECIPIENT = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
const SELECTED_ACCOUNT = '0xf9D6794F16CDbdC5b4873AEdeF4dC69d8D5edcaD'
const CHANGED_MESSAGE =
  'This name now resolves to a different address than the last time you sent to it. Verify the new recipient before proceeding.'
const VIEW_ONLY_MESSAGE =
  "This account is view-only in Ambire, so you can't move funds out of it from here. Make sure you can access it before you send."
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
  isRecipientAddressBlacklisted?: boolean
  isRecipientAddressViewOnly?: boolean
  isRecipientAddressUnknownAgreed?: boolean
  isRecipientHumanizerKnownTokenOrSmartContract?: boolean
  addressPoisoningMatch?: AddressPoisoningMatch | null
  lastRecipientTransactionDate?: Date | null
  recipient?: string
}) =>
  validateSendTransferAddress(
    overrides.recipient ?? RECIPIENT,
    SELECTED_ACCOUNT,
    overrides.isRecipientAddressUnknownAgreed ?? false,
    overrides.isRecipientAddressUnknown ?? false,
    overrides.isRecipientHumanizerKnownTokenOrSmartContract ?? false,
    overrides.isDomain ?? true,
    false,
    networks,
    accountStates,
    undefined,
    undefined,
    overrides.isRecipientAddressFirstTimeSend ?? false,
    overrides.lastRecipientTransactionDate ?? null,
    overrides.addressPoisoningMatch ?? null,
    overrides.recipientDomainAddressChange ?? null,
    overrides.isRecipientAddressBlacklisted ?? false,
    overrides.isRecipientAddressViewOnly ?? false
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
})

describe('validateSendTransferAddress - view-only recipient', () => {
  it('warns and requires a hold, instead of showing a success message', () => {
    const result = validate({
      isRecipientAddressViewOnly: true,
      isRecipientAddressFirstTimeSend: true,
      lastRecipientTransactionDate: new Date()
    })

    expect(result.message).toBe(VIEW_ONLY_MESSAGE)
    expect(result.severity).toBe('warning')
    expect(result.gate).toBe('hold')
  })

  it('does not warn when the recipient is not view-only', () => {
    const result = validate({ isRecipientAddressViewOnly: false })

    expect(result.message).not.toBe(VIEW_ONLY_MESSAGE)
    expect(result.gate).toBe('none')
  })

  it('keeps the hold even if a higher priority warning provides the message', () => {
    const result = validate({
      isRecipientAddressViewOnly: true,
      recipientDomainAddressChange: { previousAddress: SELECTED_ACCOUNT }
    })

    expect(result.message).toBe(CHANGED_MESSAGE)
    expect(result.gate).toBe('hold')
  })

  it('is not released by the agreement of the user for unknown addresses', () => {
    const result = validate({
      isRecipientAddressViewOnly: true,
      isRecipientAddressUnknown: true,
      isRecipientAddressFirstTimeSend: true,
      isRecipientAddressUnknownAgreed: true
    })

    expect(result.gate).toBe('hold')
  })
})

describe('validateSendTransferAddress - gate', () => {
  it('blocks a blacklisted recipient', () => {
    expect(validate({ isRecipientAddressBlacklisted: true }).gate).toBe('block')
  })

  it('blocks a smart contract recipient', () => {
    const result = validate({ isRecipientHumanizerKnownTokenOrSmartContract: true })

    expect(result.severity).toBe('error')
    expect(result.gate).toBe('block')
  })

  it('blocks even when other rules require a hold', () => {
    const result = validate({
      isRecipientAddressBlacklisted: true,
      isRecipientAddressViewOnly: true,
      recipientDomainAddressChange: { previousAddress: SELECTED_ACCOUNT }
    })

    expect(result.gate).toBe('block')
  })

  it('requires a hold for a changed domain address', () => {
    expect(
      validate({ recipientDomainAddressChange: { previousAddress: SELECTED_ACCOUNT } }).gate
    ).toBe('hold')
  })

  it('requires a hold for an unknown first-time recipient until the user agrees', () => {
    const unknownFirstTime = {
      isRecipientAddressUnknown: true,
      isRecipientAddressFirstTimeSend: true
    }
    const beforeAgreeing = validate(unknownFirstTime)
    const afterAgreeing = validate({ ...unknownFirstTime, isRecipientAddressUnknownAgreed: true })

    expect(beforeAgreeing.gate).toBe('hold')
    // The agreement releases only the hold - the message stays the same
    expect(afterAgreeing.gate).toBe('none')
    expect(afterAgreeing.message).toBe(beforeAgreeing.message)
  })

  it('does not require a hold for a first-time recipient that is in the address book', () => {
    const result = validate({
      isRecipientAddressUnknown: false,
      isRecipientAddressFirstTimeSend: true
    })

    expect(result.gate).toBe('none')
  })

  it('does not require a hold for a recipient the user already sent to', () => {
    const result = validate({ lastRecipientTransactionDate: new Date() })

    expect(result.severity).toBe('success')
    expect(result.gate).toBe('none')
  })

  it('has no gate while the address is invalid or resolving', () => {
    expect(validate({ recipient: 'not-an-address', isRecipientAddressViewOnly: true }).gate).toBe(
      'none'
    )
  })
})
