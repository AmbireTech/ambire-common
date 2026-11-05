import { expect } from '@jest/globals'

import { AMBIRE_ACCOUNT_FACTORY } from '../../consts/deploy'
import { Account, AccountStates } from '../../interfaces/account'
import { networks as defaultNetworks } from '../../consts/networks'
import { Network } from '../../interfaces/network'
import { AddressPoisoningMatch } from '../../interfaces/transfer'
import { validateSendTransferAddress } from './validate'

const RECIPIENT = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
const SELECTED_ACCOUNT = '0xf9D6794F16CDbdC5b4873AEdeF4dC69d8D5edcaD'
const CHANGED_MESSAGE =
  'This name now resolves to a different address than the last time you sent to it. Verify the new recipient before proceeding.'
const POISONING_MESSAGE_START = 'Possible address poisoning'
const POISONING_LOOKALIKE = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA91111'
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
  isRecipientAddressBlacklisted?: boolean
  isRecipientAddressViewOnly?: boolean
  isRecipientAddressUnknownAgreed?: boolean
  isRecipientHumanizerKnownTokenOrSmartContract?: boolean
  addressPoisoningMatch?: AddressPoisoningMatch | null
  lastRecipientTransactionDate?: Date | null
  recipient?: string
  networks?: Network[]
  recipientAccount?: Account
  chainId?: bigint
}) =>
  validateSendTransferAddress(
    overrides.recipient ?? RECIPIENT,
    SELECTED_ACCOUNT,
    overrides.isRecipientAddressUnknownAgreed ?? false,
    overrides.isRecipientAddressUnknown ?? false,
    overrides.isRecipientHumanizerKnownTokenOrSmartContract ?? false,
    false,
    overrides.networks ?? networks,
    accountStates,
    overrides.recipientAccount,
    overrides.chainId,
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
    expect(result.shouldHold).toBe(true)
  })

  it('does not warn when the recipient is not view-only', () => {
    const result = validate({ isRecipientAddressViewOnly: false })

    expect(result.message).not.toBe(VIEW_ONLY_MESSAGE)
    expect(result.shouldHold).toBeFalsy()
  })

  it('keeps the hold even if a higher priority warning provides the message', () => {
    const result = validate({
      isRecipientAddressViewOnly: true,
      recipientDomainAddressChange: { previousAddress: SELECTED_ACCOUNT }
    })

    expect(result.message).toBe(CHANGED_MESSAGE)
    expect(result.shouldHold).toBe(true)
  })

  it('is not released by the agreement of the user for unknown addresses', () => {
    const result = validate({
      isRecipientAddressViewOnly: true,
      isRecipientAddressUnknown: true,
      isRecipientAddressFirstTimeSend: true,
      isRecipientAddressUnknownAgreed: true
    })

    expect(result.shouldHold).toBe(true)
  })
})

describe('validateSendTransferAddress - address poisoning', () => {
  const addressPoisoningMatch: AddressPoisoningMatch = {
    matchedAddress: POISONING_LOOKALIKE,
    matchedPrefixCharsCount: 36,
    matchedSuffixCharsCount: 0,
    differingCharsCount: 4
  }

  it('warns about the look-alike address and requires a hold', () => {
    const result = validate({ addressPoisoningMatch, isRecipientAddressFirstTimeSend: true })

    expect(result.severity).toBe('warning')
    expect(result.message.startsWith(POISONING_MESSAGE_START)).toBe(true)
    expect(result.shouldHold).toBe(true)
  })

  it('shows the poisoning warning instead of the first-time-send message', () => {
    const result = validate({
      addressPoisoningMatch,
      isRecipientAddressFirstTimeSend: true,
      isRecipientAddressUnknown: true
    })

    expect(result.message.startsWith(POISONING_MESSAGE_START)).toBe(true)
  })

  it('requires a hold even after the user agrees to send to the unknown address', () => {
    const result = validate({
      addressPoisoningMatch,
      isRecipientAddressFirstTimeSend: true,
      isRecipientAddressUnknown: true,
      isRecipientAddressUnknownAgreed: true
    })

    expect(result.shouldHold).toBe(true)
  })

  it('keeps the hold when a higher priority warning provides the message', () => {
    const result = validate({
      addressPoisoningMatch,
      recipientDomainAddressChange: { previousAddress: SELECTED_ACCOUNT }
    })

    expect(result.message).toBe(CHANGED_MESSAGE)
    expect(result.shouldHold).toBe(true)
  })

  it('is overridden by the blacklist error, which disables the buttons', () => {
    const result = validate({ addressPoisoningMatch, isRecipientAddressBlacklisted: true })

    expect(result.message).toBe(BLACKLISTED_MESSAGE)
    expect(result.severity).toBe('error')
  })

  it('suggests a typo instead of poisoning when only a few characters differ', () => {
    const result = validate({
      addressPoisoningMatch: { ...addressPoisoningMatch, differingCharsCount: 1 },
      isRecipientAddressFirstTimeSend: true
    })

    expect(result.severity).toBe('warning')
    expect(result.message).toBe(
      'Looks like a typo: only 1 character differs from an address you have sent to before.'
    )
    expect(result.shouldHold).toBe(true)
  })

  it('does not require a hold when there is no poisoning match', () => {
    const result = validate({ addressPoisoningMatch: null })

    expect(result.message.startsWith(POISONING_MESSAGE_START)).toBe(false)
    expect(result.shouldHold).toBeFalsy()
  })
})

describe('validateSendTransferAddress - hold-to-proceed', () => {
  it('does not hold for errors, because they disable the buttons instead', () => {
    const blacklisted = validate({ isRecipientAddressBlacklisted: true })
    const smartContract = validate({ isRecipientHumanizerKnownTokenOrSmartContract: true })

    expect(blacklisted.severity).toBe('error')
    expect(blacklisted.shouldHold).toBeFalsy()
    expect(smartContract.severity).toBe('error')
    expect(smartContract.shouldHold).toBeFalsy()
  })

  it('does not hold for an unknown first-time smart contract recipient', () => {
    const result = validate({
      isRecipientHumanizerKnownTokenOrSmartContract: true,
      isRecipientAddressUnknown: true,
      isRecipientAddressFirstTimeSend: true
    })

    expect(result.severity).toBe('error')
    expect(result.shouldHold).toBeFalsy()
  })

  it('requires a hold for a changed domain address', () => {
    expect(
      validate({ recipientDomainAddressChange: { previousAddress: SELECTED_ACCOUNT } }).shouldHold
    ).toBe(true)
  })

  it('requires a hold for an unknown first-time recipient until the user agrees', () => {
    const unknownFirstTime = {
      isRecipientAddressUnknown: true,
      isRecipientAddressFirstTimeSend: true
    }
    const beforeAgreeing = validate(unknownFirstTime)
    const afterAgreeing = validate({ ...unknownFirstTime, isRecipientAddressUnknownAgreed: true })

    expect(beforeAgreeing.shouldHold).toBe(true)
    // The agreement releases only the hold - the message stays the same
    expect(afterAgreeing.shouldHold).toBeFalsy()
    expect(afterAgreeing.message).toBe(beforeAgreeing.message)
  })

  it('does not require a hold for a first-time recipient that is in the address book', () => {
    const result = validate({
      isRecipientAddressUnknown: false,
      isRecipientAddressFirstTimeSend: true
    })

    expect(result.shouldHold).toBeFalsy()
  })

  it('does not require a hold for a recipient the user already sent to', () => {
    const result = validate({ lastRecipientTransactionDate: new Date() })

    expect(result.severity).toBe('success')
    expect(result.shouldHold).toBeFalsy()
  })

  it('does not require a hold when sending to yourself', () => {
    const result = validate({ recipient: SELECTED_ACCOUNT })

    expect(result.severity).toBe('warning')
    expect(result.shouldHold).toBeFalsy()
  })

  it('does not require a hold while the address is invalid', () => {
    expect(
      validate({ recipient: 'not-an-address', isRecipientAddressViewOnly: true }).shouldHold
    ).toBeFalsy()
  })
})

describe('validateSendTransferAddress - which result wins', () => {
  const SMART_CONTRACT_MESSAGE =
    'You are trying to send tokens to a smart contract. Doing so would burn them.'

  it('shows an error over a warning, so that the buttons are disabled', () => {
    const result = validate({
      isRecipientHumanizerKnownTokenOrSmartContract: true,
      recipientDomainAddressChange: { previousAddress: SELECTED_ACCOUNT }
    })

    expect(result.message).toBe(SMART_CONTRACT_MESSAGE)
    expect(result.severity).toBe('error')
    expect(result.shouldHold).toBeFalsy()
  })

  it('shows the blacklist error before the smart contract error', () => {
    const result = validate({
      isRecipientAddressBlacklisted: true,
      isRecipientHumanizerKnownTokenOrSmartContract: true
    })

    expect(result.message).toBe(BLACKLISTED_MESSAGE)
  })

  it('shows a warning that requires a hold over a plain warning', () => {
    const result = validate({ recipient: SELECTED_ACCOUNT, isRecipientAddressViewOnly: true })

    // Otherwise the self-send warning would show and the hold would be lost
    expect(result.message).toBe(VIEW_ONLY_MESSAGE)
    expect(result.shouldHold).toBe(true)
  })

  it('shows the self-send warning for a first-time send to your own account', () => {
    const result = validate({
      recipient: SELECTED_ACCOUNT,
      isRecipientAddressUnknown: false,
      isRecipientAddressFirstTimeSend: true
    })

    // Both are plain warnings, so the order of the checks decides
    expect(result.message).toBe("You're about to send funds back to yourself.")
    expect(result.shouldHold).toBeFalsy()
  })

  it('shows a plain warning over a success message', () => {
    const result = validate({
      recipient: SELECTED_ACCOUNT,
      lastRecipientTransactionDate: new Date()
    })

    expect(result.severity).toBe('warning')
    expect(result.shouldHold).toBeFalsy()
  })

  it('shows the plain warning once the user agrees and the hold is released', () => {
    // The first-time-send warning requires a hold until the user agrees
    const unknownFirstTime = {
      recipient: SELECTED_ACCOUNT,
      isRecipientAddressUnknown: true,
      isRecipientAddressFirstTimeSend: true
    }

    expect(validate(unknownFirstTime).shouldHold).toBe(true)
    expect(validate(unknownFirstTime).message).toBe('First time sending to this address.')

    const afterAgreeing = validate({ ...unknownFirstTime, isRecipientAddressUnknownAgreed: true })
    expect(afterAgreeing.shouldHold).toBeFalsy()
    expect(afterAgreeing.message).toBe("You're about to send funds back to yourself.")
  })
})

describe('validateSendTransferAddress - recipient account not supported on the network', () => {
  const ethereum = defaultNetworks.find((n) => n.chainId === 1n)!
  const NOT_SUPPORTED_MESSAGE = 'Ambire smart accounts are not supported on this network'
  // An Ambire v2 smart account, which needs the contracts to be deployed on the network
  const smartAccount: Account = {
    addr: RECIPIENT,
    initialPrivileges: [],
    associatedKeys: [],
    creation: {
      factoryAddr: AMBIRE_ACCOUNT_FACTORY,
      bytecode: '0x',
      salt: '0x'
    },
    preferences: { label: 'Smart account', pfp: RECIPIENT }
  }
  const networkWithoutContracts: Network = { ...ethereum, areContractsDeployed: false }
  const unsupported = {
    networks: [networkWithoutContracts],
    recipientAccount: smartAccount,
    chainId: ethereum.chainId
  }

  it('warns with the reason, without requiring a hold', () => {
    const result = validate(unsupported)

    expect(result.message).toBe(NOT_SUPPORTED_MESSAGE)
    expect(result.severity).toBe('warning')
    // Only an error disables the buttons, so the user can still proceed
    expect(result.shouldHold).toBeFalsy()
  })

  it('does not warn when the account is supported on the network', () => {
    const result = validate({
      ...unsupported,
      networks: [{ ...ethereum, areContractsDeployed: true, hasRelayer: true }]
    })

    expect(result.message).not.toBe(NOT_SUPPORTED_MESSAGE)
  })

  it('does not warn when no network is selected', () => {
    expect(validate({ ...unsupported, chainId: undefined }).message).not.toBe(NOT_SUPPORTED_MESSAGE)
  })

  it('does not warn when the recipient is not an account of the wallet', () => {
    expect(validate({ ...unsupported, recipientAccount: undefined }).message).not.toBe(
      NOT_SUPPORTED_MESSAGE
    )
  })

  it('shows the warning over a success message', () => {
    const result = validate({ ...unsupported, lastRecipientTransactionDate: new Date() })

    expect(result.message).toBe(NOT_SUPPORTED_MESSAGE)
  })

  it('shows a warning that requires a hold over it', () => {
    const result = validate({ ...unsupported, isRecipientAddressViewOnly: true })

    expect(result.message).toBe(VIEW_ONLY_MESSAGE)
    expect(result.shouldHold).toBe(true)
  })

  it('shows an error over it', () => {
    const result = validate({ ...unsupported, isRecipientAddressBlacklisted: true })

    expect(result.message).toBe(BLACKLISTED_MESSAGE)
    expect(result.severity).toBe('error')
  })
})
