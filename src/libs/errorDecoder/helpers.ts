import { isHexString, toUtf8String } from 'ethers'

import { ERROR_PREFIX, PANIC_ERROR_PREFIX } from './constants'

const panicErrorCodeToReason = (errorCode: bigint): string | undefined => {
  switch (errorCode) {
    case 0x0n:
      return 'Generic compiler inserted panic'
    case 0x1n:
      return 'Assertion error'
    case 0x11n:
      return 'Arithmetic operation underflowed or overflowed outside of an unchecked block'
    case 0x12n:
      return 'Division or modulo division by zero'
    case 0x21n:
      return 'Tried to convert a value into an enum, but the value was too big or negative'
    case 0x22n:
      return 'Incorrectly encoded storage byte array'
    case 0x31n:
      return '.pop() was called on an empty array'
    case 0x32n:
      return 'Array accessed at an out-of-bounds or negative index'
    case 0x41n:
      return 'Too much memory was allocated, or an array was created that is too large'
    case 0x51n:
      return 'Called a zero-initialized variable of internal function type'
    default:
      return undefined
  }
}

const isReasonValid = (reason: string | null): boolean => {
  return (
    !!reason &&
    typeof reason === 'string' &&
    reason !== '0x' &&
    reason !== 'Unknown error' &&
    reason !== 'UNKNOWN_ERROR' &&
    !reason.startsWith(ERROR_PREFIX) &&
    !reason.startsWith(PANIC_ERROR_PREFIX) &&
    !reason.toLowerCase().includes('could not coalesce error')
  )
}

/**
 * Counts the number of valid Unicode numbers and letters in a string.
 */
const countUnicodeLettersAndNumbers = (str: string): number => {
  let validCount = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charAt(i)
    // Check if it's an alphabetic character (from any language) or a number
    if (/[\p{L}\p{N}]/u.test(char)) {
      validCount++
    }
  }
  return validCount
}

/**
 * Some reasons are encoded in hex, this function will decode them to a human-readable string
 * which can then be matched to a specific error message.
 */
const formatReason = (reason: string): string => {
  const trimmedReason = reason.trim()
  if (!isHexString(trimmedReason)) return trimmedReason
  if (trimmedReason.startsWith(ERROR_PREFIX) || trimmedReason.startsWith(PANIC_ERROR_PREFIX))
    return trimmedReason

  try {
    const decodedString = toUtf8String(trimmedReason)

    // Return the decoded string if it contains valid Unicode letters
    return countUnicodeLettersAndNumbers(decodedString) > 0 ? decodedString : trimmedReason
  } catch {
    return trimmedReason
  }
}

const truncateReason = (reason?: string): string => {
  if (!reason || !isReasonValid(reason)) return ''

  return reason.length > 100 ? `${reason.slice(0, 100)}...` : reason
}

const getErrorCodeStringFromReason = (reason?: string, withSpace = true): string => {
  const truncatedReason = truncateReason(reason)

  if (!truncatedReason) return ''

  return `${withSpace ? ' ' : ''}Error code: ${truncatedReason}`
}

function getDataFromError(error: Error): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const errorData = (error as any).data ?? (error as any).error?.data

  if (errorData === undefined) {
    return ''
  }

  let returnData = typeof errorData === 'string' ? errorData : errorData.data

  if (typeof returnData === 'object' && returnData.data) {
    returnData = returnData.data
  }

  if (returnData === undefined || typeof returnData !== 'string') {
    return ''
  }

  return returnData
}

export {
  panicErrorCodeToReason,
  getErrorCodeStringFromReason,
  isReasonValid,
  getDataFromError,
  formatReason,
  countUnicodeLettersAndNumbers,
  truncateReason
}
