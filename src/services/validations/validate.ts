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

const NOT_IN_ADDRESS_BOOK_MESSAGE =
  "This address isn't in your Address Book. Double-check the details before confirming."
const FIRST_TIME_SEND_MESSAGE = 'First time sending to this address.'
const FIRST_TIME_SEND_IN_ADDRESS_BOOK_MESSAGE = FIRST_TIME_SEND_MESSAGE // same same as above, but keep it separate just in case

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

const validateSendTransferAddress = (
  address: string,
  selectedAccAddr: string,
  addressConfirmed: any,
  isRecipientAddressUnknown: boolean,
  isRecipientHumanizerKnownTokenOrSmartContract: boolean,
  isDomain: boolean,
  isRecipientDomainResolving: boolean,
  networks: Network[],
  accountStates: AccountStates,
  recepientAccount?: Account,
  chainId?: bigint,
  isRecipientAddressFirstTimeSend?: boolean,
  lastRecipientTransactionDate?: Date | null,
  addressPoisoningMatch?: AddressPoisoningMatch | null,
  recipientDomainAddressChange?: { previousAddress: string } | null
): Validation => {
  // Basic validation is handled in the AddressInput component and we don't want to overwrite it.
  if (!isValidAddress(address) || isRecipientDomainResolving) {
    return {
      message: '',
      severity: 'success'
    }
  }

  // A domain the user sent to before now resolves to a different address - it may have expired and
  // been re-pointed.
  if (recipientDomainAddressChange) {
    return {
      message:
        'This name now resolves to a different address than the last time you sent to it. Verify the new recipient before proceeding.',
      severity: 'warning'
    }
  }

  if (address.toLowerCase() === selectedAccAddr.toLowerCase()) {
    return {
      message: "You're about to send funds back to yourself.",
      severity: 'warning'
    }
  }

  // check if the account is supported on the receiving network
  if (chainId) {
    const accountNetworks = getSupportedNetworks(networks, accountStates, recepientAccount)
    const foundNetwork = accountNetworks.find((n) => n.chainId === chainId)
    if (foundNetwork && foundNetwork.isNotSupported && foundNetwork.notSupportedReason) {
      return {
        message: foundNetwork.notSupportedReason,
        severity: 'warning'
      }
    }
  }

  if (isRecipientHumanizerKnownTokenOrSmartContract) {
    return {
      message: 'You are trying to send tokens to a smart contract. Doing so would burn them.',
      severity: 'error'
    }
  }

  if (addressPoisoningMatch) {
    return {
      message: getAddressPoisoningWarningMessage(
        formatAddressPoisoningMatchForMessage(addressPoisoningMatch)
      ),
      severity: 'warning'
    }
  }

  if (isRecipientAddressFirstTimeSend) {
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
  }

  if (
    isRecipientAddressUnknown &&
    isRecipientAddressFirstTimeSend &&
    !addressConfirmed &&
    !isDomain &&
    !isRecipientDomainResolving
  ) {
    return {
      message: NOT_IN_ADDRESS_BOOK_MESSAGE,
      severity: 'error'
    }
  }

  if (
    isRecipientAddressUnknown &&
    isRecipientAddressFirstTimeSend &&
    !addressConfirmed &&
    isDomain &&
    !isRecipientDomainResolving
  ) {
    return {
      message: NOT_IN_ADDRESS_BOOK_MESSAGE,
      severity: 'error'
    }
  }

  if (lastRecipientTransactionDate) {
    return {
      message: `Last transaction to this address was ${getTimeAgo(lastRecipientTransactionDate)}.`,
      severity: 'success'
    }
  }

  return { severity: 'success', message: '' }
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
  } catch (e) {
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
