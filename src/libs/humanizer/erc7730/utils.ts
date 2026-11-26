import { isAddress, isHexString } from 'ethers'

import { Message } from '../../../interfaces/userRequest'
import { Call } from '../../accountOp/types'
import { getExactSafeTxCalls } from '../../safe/helpers'
import { SAFE_TX_PRIMARY_TYPE } from './consts'

export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const isHexChar = (value: string) => {
  const charCode = value.charCodeAt(0)

  return (
    (charCode >= 48 && charCode <= 57) ||
    (charCode >= 65 && charCode <= 70) ||
    (charCode >= 97 && charCode <= 102)
  )
}

export const isHexOfLength = (value: string, hexLength: number) =>
  value.startsWith('0x') && value.length === hexLength + 2 && [...value.slice(2)].every(isHexChar)

export const parseIntegerLiteral = (value: string): number | null => {
  if (!value) return null

  const sign = value[0] === '-' ? -1 : 1
  const digits = sign === -1 ? value.slice(1) : value
  if (!digits || ![...digits].every((digit) => digit >= '0' && digit <= '9')) return null

  const parsed = Number(digits) * sign

  return Number.isInteger(parsed) ? parsed : null
}

/**
 * The calls a signed Safe transaction (a `SafeTx` typed message) makes, if they do exactly what it
 * does: the transaction itself if it's a plain call, or the calls of a batch it runs through a
 * known multiSend contract (see getExactSafeTxCalls). Null if it isn't a Safe transaction or it
 * can't be broken down into such calls
 */
export const getSafeTxCallsFromMessage = (message: Message): Call[] | null => {
  if (message.content.kind !== 'typedMessage') return null
  if (message.content.primaryType !== SAFE_TX_PRIMARY_TYPE) return null

  const { to, value, data, operation } = message.content.message
  if (typeof to !== 'string' || !isAddress(to)) return null
  if (typeof data !== 'string' || !isHexString(data)) return null

  try {
    const bigintValue = BigInt((value ?? 0) as string | number | bigint)
    const bigintOperation = BigInt((operation ?? 0) as string | number | bigint)

    // Only calls that do exactly what the signed transaction does are shown as its calls. If it
    // can't be broken down into them, it's shown as signed (see getSafeTxMessageWarnings)
    return getExactSafeTxCalls({
      to,
      value: bigintValue.toString(),
      data,
      operation: Number(bigintOperation)
    })
  } catch (error) {
    // Malformed values (e.g. a value that isn't a number) can't be broken down into calls
    console.error('Humanizer: failed to read the calls of a Safe transaction message', error)
    return null
  }
}

/** The key a descriptor is registered under, both in the registry index and in the resolved maps */
export const getRegistryKey = (chainId: bigint | number | string, address: string): string =>
  `eip155:${BigInt(chainId).toString()}:${address.toLowerCase()}`

/**
 * The key a Safe proxy's implementation is recorded under. Shared with the controller that answers
 * the lookup, so the two can't drift into writing and reading different keys.
 */
export const getSafeSingletonKey = (chainId: bigint, address: string): string =>
  `${chainId.toString()}:${address.toLowerCase()}`
