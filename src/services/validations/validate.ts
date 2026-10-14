import { getAddress, parseUnits } from 'ethers'
import isEmail from 'validator/lib/isEmail'

import { Account, AccountStates } from '@/interfaces/account'
import { Network } from '@/interfaces/network'
import { AddressPoisoningMatch } from '@/interfaces/transfer'
import { getSupportedNetworks } from '@/libs/networks/networks'

import { TokenResult } from '../../libs/portfolio'
import { getTokenAmount } from '../../libs/portfolio/helpers'
import { getSanitizedAmount } from '../../libs/transfer/amount'
import shortenAddress from '../../utils/shortenAddress'
import { isValidAddress } from '../address'

export type Validation = {
  message: string
  /** Severity levels:
   * - 'error' - Critical validation failures that block the transaction
   * - 'warning' - Important information user should know but transaction can proceed
   * - 'info' - Neutral informational messages
   * - 'success' - Green confirmation message
   **/
  severity: 'info' | 'warning' | 'error' | 'success'
  id?: 'insufficient_amount' | 'resolving_domain'
}

export const validateAddress = (address: string): Validation => {
  if (!(address && address.length)) {
    return {
      severity: 'error',
      message: ''
    }
  }

  if (!(address && isValidAddress(address))) {
    return {
      severity: 'error',
      message: 'Invalid address.'
    }
  }

  try {
    getAddress(address)
  } catch {
    return {
      severity: 'error',
      message: 'Invalid checksum. Verify the address and try again.'
    }
  }

  return { severity: 'success', message: '' }
}

const validateAddAuthSignerAddress = (address: string, selectedAcc: any): Validation => {
  const isValidAddr = validateAddress(address)
  if (isValidAddr.severity === 'error') return isValidAddr

  if (address && selectedAcc && address === selectedAcc) {
    return {
      severity: 'error',
      message: "You can't send to the same address you’re sending from."
    }
  }

  return { severity: 'success', message: '' }
}

const FIRST_TIME_SEND_MESSAGE = 'First time sending to this address.'
const FIRST_TIME_SEND_IN_ADDRESS_BOOK_MESSAGE = FIRST_TIME_SEND_MESSAGE // same same as above, but keep it separate just in case
const VIEW_ONLY_RECIPIENT_MESSAGE =
  "This account is view-only in Ambire, so you can't move funds out of it from here. Make sure you can access it before you send."

// Keep poisoning warnings readable with compact address previews.
// We size the preview based on the strongest symmetric part of the match:
// 4-left/4-right uses 0x + 6...6, while stronger matches such as 5-left/5-right,
// 6-left/5-right or 6-left/6-right use 0x + 8...8 for more clarity.
const ADDRESS_POISONING_MESSAGE_VISIBLE_CHARS_DEFAULT = 6
const ADDRESS_POISONING_MESSAGE_VISIBLE_CHARS_EXTENDED = 8
const getAddressPoisoningWarningMessage = (matchedAddress: string) =>
  `Possible address poisoning: this new address looks similar to ${matchedAddress} that you have interacted with before. Proceed with caution.`

const formatAddressPoisoningMatchForMessage = ({
  matchedAddress,
  matchedPrefixCharsCount,
  matchedSuffixCharsCount
}: AddressPoisoningMatch) => {
  let normalizedAddress = matchedAddress

  try {
    normalizedAddress = getAddress(matchedAddress)
  } catch {
    // keep original if checksum normalization fails
  }

  const strongestSymmetricMatch = Math.max(matchedPrefixCharsCount, matchedSuffixCharsCount)
  const visibleChars =
    strongestSymmetricMatch >= 5
      ? ADDRESS_POISONING_MESSAGE_VISIBLE_CHARS_EXTENDED
      : ADDRESS_POISONING_MESSAGE_VISIBLE_CHARS_DEFAULT

  const fixedPreviewLength = visibleChars * 2 + 5 // 0x + left + ... + right

  return shortenAddress(normalizedAddress, fixedPreviewLength, visibleChars)
}

function getTimeAgo(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMinutes = Math.floor(diffMs / (1000 * 60))

  if (diffMinutes < 1) return 'just now'
  if (diffMinutes < 60) return `${diffMinutes} ${diffMinutes === 1 ? 'minute' : 'minutes'} ago`

  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  if (diffHours < 24) return `${diffHours} ${diffHours === 1 ? 'hour' : 'hours'} ago`

  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays === 1) return 'yesterday'
  if (diffDays <= 31) return `${diffDays} days ago`

  const diffMonths = Math.floor(diffDays / 30.44) // Average days per month
  if (diffMonths < 12) return `${diffMonths} ${diffMonths === 1 ? 'month' : 'months'} ago`

  const diffYears = Math.round(diffMonths / 12)
  return `${diffYears} ${diffYears === 1 ? 'year' : 'years'} ago`
}

/**
 * What the form buttons must do for the current recipient:
 * - 'none' - the normal button
 * - 'hold' - the user must hold the button to proceed (a risk the user can accept)
 * - 'block' - the button is disabled (a risk the user must not accept)
 */
export type RecipientGate = 'none' | 'hold' | 'block'

export type RecipientValidation = Validation & { gate: RecipientGate }

type RecipientRule = {
  /** Lazy, so that a rule that is not needed does not do any work */
  applies: () => boolean
  validation: () => Validation
  gate: RecipientGate
}

const GATE_STRENGTH: { [key in RecipientGate]: number } = { none: 0, hold: 1, block: 2 }

const validateSendTransferAddress = (
  address: string,
  selectedAccAddr: string,
  addressConfirmed: any,
  isRecipientAddressUnknown: boolean,
  isRecipientHumanizerKnownTokenOrSmartContract: boolean,
  _isDomain: boolean,
  isRecipientDomainResolving: boolean,
  networks: Network[],
  accountStates: AccountStates,
  recepientAccount?: Account,
  chainId?: bigint,
  isRecipientAddressFirstTimeSend?: boolean,
  lastRecipientTransactionDate?: Date | null,
  addressPoisoningMatch?: AddressPoisoningMatch | null,
  recipientDomainAddressChange?: { previousAddress: string } | null,
  isRecipientAddressBlacklisted?: boolean,
  isRecipientAddressViewOnly?: boolean
): RecipientValidation => {
  // Basic validation is handled in the AddressInput component and we don't want to overwrite it.
  if (!isValidAddress(address) || isRecipientDomainResolving) {
    return {
      message: '',
      severity: 'success',
      gate: 'none'
    }
  }

  const getUnsupportedNetworkReason = () => {
    if (!chainId) return undefined

    const accountNetworks = getSupportedNetworks(networks, accountStates, recepientAccount)
    const foundNetwork = accountNetworks.find((n) => n.chainId === chainId)
    if (foundNetwork && foundNetwork.isNotSupported && foundNetwork.notSupportedReason) {
      return foundNetwork.notSupportedReason
    }
    return undefined
  }

  // The only gate that depends on the agreement of the user: the message stays the same, but the
  // hold is released once the user agrees to send to the unknown address.
  const isUnknownRecipientHold =
    isRecipientAddressUnknown &&
    !addressConfirmed &&
    !isRecipientHumanizerKnownTokenOrSmartContract &&
    !!isRecipientAddressFirstTimeSend

  // The single source of truth for both the message under the input and the state of the buttons,
  // so a rule can't require a hold (or a block) without also explaining why.
  // The message comes from the FIRST rule that applies, so the order is the priority of the messages.
  // The gate is the STRONGEST gate of ALL the rules that apply, so a more important message
  // can't hide a lower priority hold.
  const rules: RecipientRule[] = [
    // A known scam address is the most severe problem, so it takes priority over every other message.
    // The severity is 'error' and the gate is 'block' - sending to a known scam address is never
    // something we let the user proceed with.
    {
      applies: () => !!isRecipientAddressBlacklisted,
      validation: () => ({
        message: 'This address is known for stealing funds. Anything you send to it will be lost.',
        severity: 'error'
      }),
      gate: 'block'
    },
    // A domain the user sent to before now resolves to a different address - it may have expired and
    // been re-pointed.
    {
      applies: () => !!recipientDomainAddressChange,
      validation: () => ({
        message:
          'This name now resolves to a different address than the last time you sent to it. Verify the new recipient before proceeding.',
        severity: 'warning'
      }),
      gate: 'hold'
    },
    {
      applies: () => address.toLowerCase() === selectedAccAddr.toLowerCase(),
      validation: () => ({
        message: "You're about to send funds back to yourself.",
        severity: 'warning'
      }),
      gate: 'none'
    },
    // check if the account is supported on the receiving network
    {
      applies: () => !!getUnsupportedNetworkReason(),
      validation: () => ({
        message: getUnsupportedNetworkReason() || '',
        severity: 'warning'
      }),
      gate: 'none'
    },
    {
      applies: () => isRecipientHumanizerKnownTokenOrSmartContract,
      validation: () => ({
        message: 'You are trying to send tokens to a smart contract. Doing so would burn them.',
        severity: 'error'
      }),
      gate: 'block'
    },
    // poisoning detected - require hold-to-proceed as an additional safety step
    {
      applies: () => !!addressPoisoningMatch,
      validation: () => ({
        message: getAddressPoisoningWarningMessage(
          formatAddressPoisoningMatchForMessage(addressPoisoningMatch as AddressPoisoningMatch)
        ),
        severity: 'warning'
      }),
      gate: 'hold'
    },
    {
      applies: () => !!isRecipientAddressViewOnly,
      validation: () => ({
        message: VIEW_ONLY_RECIPIENT_MESSAGE,
        severity: 'warning'
      }),
      gate: 'hold'
    },
    {
      applies: () => !!isRecipientAddressFirstTimeSend,
      validation: () => {
        let message = isRecipientAddressUnknown
          ? FIRST_TIME_SEND_MESSAGE
          : FIRST_TIME_SEND_IN_ADDRESS_BOOK_MESSAGE
        if (lastRecipientTransactionDate) {
          message = `Last transaction to this address was ${getTimeAgo(lastRecipientTransactionDate)}.`
        }
        return {
          message,
          severity: lastRecipientTransactionDate ? 'success' : 'warning'
        }
      },
      gate: isUnknownRecipientHold ? 'hold' : 'none'
    },
    {
      applies: () => !!lastRecipientTransactionDate,
      validation: () => ({
        message: `Last transaction to this address was ${getTimeAgo(lastRecipientTransactionDate as Date)}.`,
        severity: 'success'
      }),
      gate: 'none'
    }
  ]

  const appliedRules = rules.filter((rule) => rule.applies())

  const gate = appliedRules.reduce<RecipientGate>(
    (strongest, rule) =>
      GATE_STRENGTH[rule.gate] > GATE_STRENGTH[strongest] ? rule.gate : strongest,
    'none'
  )

  const validation: Validation = appliedRules[0]?.validation() ?? {
    severity: 'success',
    message: ''
  }

  return { ...validation, gate }
}

const validateSendTransferAmount = (amount: string, selectedAsset: TokenResult): Validation => {
  const sanitizedAmount = getSanitizedAmount(amount, selectedAsset.decimals)

  if (!(sanitizedAmount && sanitizedAmount.length)) {
    return {
      severity: 'error',
      message: ''
    }
  }

  if (!(sanitizedAmount && Number(sanitizedAmount) > 0)) {
    // The user has entered an amount that is outside of the valid range.
    if (Number(amount) > 0 && selectedAsset.decimals && selectedAsset.decimals > 0) {
      return {
        severity: 'error',
        message: `The amount must be greater than 0.${'0'.repeat(selectedAsset.decimals - 1)}1.`
      }
    }

    return {
      severity: 'error',
      message: 'The amount must be greater than 0.'
    }
  }

  try {
    if (sanitizedAmount && selectedAsset && selectedAsset.decimals) {
      if (Number(sanitizedAmount) < 1 / 10 ** selectedAsset.decimals)
        return {
          message: 'Token amount too low.',
          severity: 'error'
        }

      const currentAmount: bigint = parseUnits(sanitizedAmount, selectedAsset.decimals)

      if (currentAmount > getTokenAmount(selectedAsset)) {
        return {
          message: 'Insufficient amount.',
          severity: 'error',
          id: 'insufficient_amount'
        }
      }
    }
  } catch {
    // Keep original behavior but avoid adding new console usage beyond existing
    // callers may log if needed; return a warning indicating invalid amount.
    return {
      message: 'Invalid amount.',
      severity: 'error'
    }
  }

  return { severity: 'success', message: '' }
}

const isValidCode = (code: string) => code.length === 6

const isValidPassword = (password: string) => password.length >= 8

function isValidURL(url: string) {
  const urlRegex =
    /^(?:https?|ftp):\/\/(?:\w+:{0,1}\w*@)?(?:\S+)(?::\d+)?(?:\/|\/(?:[\w#!:.?+=&%@!\-\/]))?$/

  return urlRegex.test(url)
}

const isValidHostname = (str: string) => {
  // Matches hostnames like "google.com", "app.uniswap.org", etc.
  const hostnameRegex = /^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/
  return hostnameRegex.test(str)
}

export {
  isEmail,
  isValidCode,
  isValidPassword,
  isValidURL,
  isValidHostname,
  getTimeAgo,
  validateAddAuthSignerAddress,
  validateSendTransferAddress,
  validateSendTransferAmount
}
