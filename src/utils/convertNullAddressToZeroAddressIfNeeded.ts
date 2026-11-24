import { ethAddress, zeroAddress } from 'viem'

import isSameAddr from './isSameAddr'

/**
 * Some providers (e.g. Socket) use the 0xEeee...EEeE "null address" for the native token,
 * while the wallet uses the zero address. Converts the former to the latter, ignoring case,
 * as providers may return lowercased addresses. Other addresses are returned unchanged.
 */
const convertNullAddressToZeroAddressIfNeeded = (address: string) =>
  isSameAddr(address, ethAddress) ? zeroAddress : address

export default convertNullAddressToZeroAddressIfNeeded
