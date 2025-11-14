import { getAddress, parseUnits } from 'ethers'
import isEmail from 'validator/es/lib/isEmail'

import { TokenResult } from '../../libs/portfolio'
import { getTokenAmount } from '../../libs/portfolio/helpers'
import { getSanitizedAmount } from '../../libs/transfer/amount'
import { isValidAddress } from '../address'

type ValidateReturnType = {
  success: boolean
  message: string
  // Severity levels:
  // 'error' - Critical validation failures that block the transaction (success: false)
  // 'warning' - Important information user should know but transaction can proceed (success: true)
  // 'info' - Neutral informational messages (success: true)
  severity?: 'info' | 'warning' | 'error'
  errorType?: 'insufficient_amount'
}

export const validateAddress = (address: string): ValidateReturnType => {
  if (!(address && address.length)) {
    return {
      success: false,
      message: ''
    }
  }

  if (!(address && isValidAddress(address))) {
    return {
      success: false,
      message: 'Invalid address.'
    }
  }

  try {
    getAddress(address)
  } catch {
    return {
      success: false,
      message: 'Invalid checksum. Verify the address and try again.'
    }
  }

  return { success: true, message: '' }
}

const validateAddAuthSignerAddress = (address: string, selectedAcc: any): ValidateReturnType => {
  const isValidAddr = validateAddress(address)
  if (!isValidAddr.success) return isValidAddr

  if (address && selectedAcc && address === selectedAcc) {
    return {
      success: false,
      message: "You can't send to the same address you’re sending from."
    }
  }

  return { success: true, message: '' }
}

const NOT_IN_ADDRESS_BOOK_MESSAGE =
  "This address isn't in your Address Book. Double-check the details before confirming."
const FIRST_TIME_SEND_MESSAGE = 'First time sending to this address.'
const FIRST_TIME_SEND_IN_ADDRESS_BOOK_MESSAGE = FIRST_TIME_SEND_MESSAGE // same same as above, but keep it separate just in case

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
  selectedAcc: string,
  addressConfirmed: any,
  isRecipientAddressUnknown: boolean,
  isRecipientHumanizerKnownTokenOrSmartContract: boolean,
  isEnsAddress: boolean,
  isRecipientDomainResolving: boolean,
  isSWWarningVisible?: boolean,
  isSWWarningAgreed?: boolean,
  isRecipientAddressFirstTimeSend?: boolean,
  lastRecipientTransactionDate?: Date | null
): ValidateReturnType => {
  // Basic validation is handled in the AddressInput component and we don't want to overwrite it.
  if (!isValidAddress(address) || isRecipientDomainResolving) {
    return {
      success: true,
      message: ''
    }
  }
  // Check for proper checksum
  if (address !== getAddress(address)) {
    return {
      success: false,
      message: 'Invalid checksum. Verify the address and try again.',
      severity: 'error'
    }
  }

  if (selectedAcc && address.toLowerCase() === selectedAcc.toLowerCase()) {
    return {
      success: false,
      message: "You can't send to the same address you're sending from.",
      severity: 'error'
    }
  }

  if (isRecipientHumanizerKnownTokenOrSmartContract) {
    return {
      success: false,
      message: 'You are trying to send tokens to a smart contract. Doing so would burn them.',
      severity: 'error'
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
      success: true,
      message,
      severity: lastRecipientTransactionDate ? 'warning' : 'info'
    }
  }

  if (
    isRecipientAddressUnknown &&
    isRecipientAddressFirstTimeSend &&
    !addressConfirmed &&
    !isEnsAddress &&
    !isRecipientDomainResolving
  ) {
    return {
      success: false,
      message: NOT_IN_ADDRESS_BOOK_MESSAGE,
      severity: 'error'
    }
  }

  if (
    isRecipientAddressUnknown &&
    isRecipientAddressFirstTimeSend &&
    !addressConfirmed &&
    isEnsAddress &&
    !isRecipientDomainResolving
  ) {
    return {
      success: false,
      message: NOT_IN_ADDRESS_BOOK_MESSAGE,
      severity: 'error'
    }
  }

  if (isRecipientAddressUnknown && addressConfirmed && isSWWarningVisible && !isSWWarningAgreed) {
    return {
      success: false,
      message: 'Please confirm that the recipient address is not an exchange.',
      severity: 'error'
    }
  }

  if (lastRecipientTransactionDate) {
    return {
      success: true,
      message: `Last transaction to this address was ${getTimeAgo(lastRecipientTransactionDate)}.`,
      severity: 'warning'
    }
  }

  return { success: true, message: '', severity: 'warning' }
}

const validateSendTransferAmount = (
  amount: string,
  selectedAsset: TokenResult
): ValidateReturnType => {
  const sanitizedAmount = getSanitizedAmount(amount, selectedAsset.decimals)

  if (!(sanitizedAmount && sanitizedAmount.length)) {
    return {
      success: false,
      message: ''
    }
  }

  if (!(sanitizedAmount && Number(sanitizedAmount) > 0)) {
    // The user has entered an amount that is outside of the valid range.
    if (Number(amount) > 0 && selectedAsset.decimals && selectedAsset.decimals > 0) {
      return {
        success: false,
        message: `The amount must be greater than 0.${'0'.repeat(selectedAsset.decimals - 1)}1.`,
        severity: 'error'
      }
    }

    return {
      success: false,
      message: 'The amount must be greater than 0.',
      severity: 'error'
    }
  }

  try {
    if (sanitizedAmount && selectedAsset && selectedAsset.decimals) {
      if (Number(sanitizedAmount) < 1 / 10 ** selectedAsset.decimals)
        return {
          success: false,
          message: 'Token amount too low.',
          severity: 'error'
        }

      const currentAmount: bigint = parseUnits(sanitizedAmount, selectedAsset.decimals)

      if (currentAmount > getTokenAmount(selectedAsset)) {
        return {
          success: false,
          message: 'Insufficient amount.',
          severity: 'error',
          errorType: 'insufficient_amount'
        }
      }
    }
  } catch (e) {
    // Keep original behavior but avoid adding new console usage beyond existing
    // callers may log if needed; return a warning indicating invalid amount.
    return {
      success: false,
      message: 'Invalid amount.',
      severity: 'error'
    }
  }

  return { success: true, message: '' }
}

const isValidCode = (code: string) => code.length === 6

const isValidPassword = (password: string) => password.length >= 8

function isValidURL(url: string) {
  const urlRegex =
    /^(?:https?|ftp):\/\/(?:\w+:{0,1}\w*@)?(?:\S+)(?::\d+)?(?:\/|\/(?:[\w#!:.?+=&%@!\-\/]))?$/

  return urlRegex.test(url)
}

export {
  isEmail,
  validateAddAuthSignerAddress,
  validateSendTransferAddress,
  validateSendTransferAmount,
  isValidCode,
  isValidPassword,
  isValidURL
}
