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
 * The result of one check of the recipient.
 * `shouldHold` (hold-to-proceed) is possible only for a warning: an error already disables the
 * buttons of the form, and a success message needs no confirmation from the user.
 */
type RecipientCheckResult =
  | { severity: 'success' | 'error'; message: string; shouldHold?: never }
  | { severity: 'warning'; message: string; shouldHold?: boolean }

/** Returns `undefined` when the check doesn't apply to the recipient */
type RecipientCheck = () => RecipientCheckResult | undefined

export type RecipientValidation = Validation & {
  /** True if the user must hold the button to proceed (a risk the user can accept) */
  shouldHold: boolean
}

const validateSendTransferAddress = (
  address: string,
  selectedAccAddr: string,
  addressConfirmed: boolean,
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
      shouldHold: false
    }
  }

  // The single source of truth for both the message under the input and the hold-to-proceed state
  // of the buttons, so a check can't require a hold without also explaining why.
  // The message comes from the FIRST check that applies, so the order is the priority of the messages.
  // The hold is required if ANY check that applies requires it, so a more important message
  // can't hide a lower priority hold.
  const checks: RecipientCheck[] = [
    // A known scam address is the most severe problem, so it takes priority over every other message.
    // The severity is 'error' so that the buttons of the form stay disabled - sending to a known scam
    // address is never something we let the user proceed with.
    () => {
      if (!isRecipientAddressBlacklisted) return undefined

      return {
        message: 'This address is known for stealing funds. Anything you send to it will be lost.',
        severity: 'error'
      }
    },
    // A domain the user sent to before now resolves to a different address - it may have expired and
    // been re-pointed.
    () => {
      if (!recipientDomainAddressChange) return undefined

      return {
        message:
          'This name now resolves to a different address than the last time you sent to it. Verify the new recipient before proceeding.',
        severity: 'warning',
        shouldHold: true
      }
    },
    () => {
      if (address.toLowerCase() !== selectedAccAddr.toLowerCase()) return undefined

      return {
        message: "You're about to send funds back to yourself.",
        severity: 'warning'
      }
    },
    // check if the account is supported on the receiving network
    () => {
      if (!chainId) return undefined

      const accountNetworks = getSupportedNetworks(networks, accountStates, recepientAccount)
      const foundNetwork = accountNetworks.find((n) => n.chainId === chainId)
      if (!foundNetwork || !foundNetwork.isNotSupported || !foundNetwork.notSupportedReason) {
        return undefined
      }

      return {
        message: foundNetwork.notSupportedReason,
        severity: 'warning'
      }
    },
    () => {
      if (!isRecipientHumanizerKnownTokenOrSmartContract) return undefined

      return {
        message: 'You are trying to send tokens to a smart contract. Doing so would burn them.',
        severity: 'error'
      }
    },
    // poisoning detected - require hold-to-proceed as an additional safety step
    () => {
      if (!addressPoisoningMatch) return undefined

      return {
        message: getAddressPoisoningWarningMessage(
          formatAddressPoisoningMatchForMessage(addressPoisoningMatch)
        ),
        severity: 'warning',
        shouldHold: true
      }
    },
    () => {
      if (!isRecipientAddressViewOnly) return undefined

      return {
        message: VIEW_ONLY_RECIPIENT_MESSAGE,
        severity: 'warning',
        shouldHold: true
      }
    },
    // The only check that depends on the agreement of the user: the message stays the same, but
    // the hold is released once the user agrees to send to the unknown address.
    () => {
      if (!isRecipientAddressFirstTimeSend) return undefined

      return {
        message: isRecipientAddressUnknown
          ? FIRST_TIME_SEND_MESSAGE
          : FIRST_TIME_SEND_IN_ADDRESS_BOOK_MESSAGE,
        severity: 'warning',
        shouldHold:
          isRecipientAddressUnknown &&
          !addressConfirmed &&
          !isRecipientHumanizerKnownTokenOrSmartContract
      }
    },
    () => {
      if (!lastRecipientTransactionDate) return undefined

      return {
        message: `Last transaction to this address was ${getTimeAgo(lastRecipientTransactionDate)}.`,
        severity: 'success'
      }
    }
  ]

  const results = checks
    .map((check) => check())
    .filter((result): result is RecipientCheckResult => !!result)

  const [firstResult] = results
  const validation: Validation = firstResult ?? { severity: 'success', message: '' }

  return { ...validation, shouldHold: results.some((result) => !!result.shouldHold) }
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
