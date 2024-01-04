import { isHexPrefixed } from './isHexPrefixed'

/**
 * Adds "0x" to a given `String` if it does not already start with "0x".
 */
export const addHexPrefix = (str: string) => {
  if (typeof str !== 'string') {
    return str
  }

  return isHexPrefixed(str) ? str : `0x${str}`
}
