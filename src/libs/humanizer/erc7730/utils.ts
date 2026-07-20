import { isAddress, isHexString } from 'ethers'

import { Message } from '../../../interfaces/userRequest'
import { Call } from '../../accountOp/types'
import { decodeMultiSend } from '../../safe/helpers'
import { getAbiBytesCalldataWithPadding, multiSendInterface } from './calldata'
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

export const getSafeTxCallsFromMessage = (message: Message): Call[] | null => {
  if (message.content.kind !== 'typedMessage') return null
  if (message.content.primaryType !== SAFE_TX_PRIMARY_TYPE) return null

  const { to, value, data, operation } = message.content.message
  if (typeof to !== 'string' || !isAddress(to)) return null
  if (typeof data !== 'string' || !isHexString(data)) return null

  try {
    const bigintValue = BigInt((value ?? 0) as string | number | bigint)
    const bigintOperation = BigInt((operation ?? 0) as string | number | bigint)

    if (bigintOperation === 0n) {
      return [
        {
          to,
          data,
          value: bigintValue
        }
      ]
    }

    if (bigintOperation !== 1n) return null

    const multiSendDecoded = multiSendInterface.decodeFunctionData(
      'multiSend',
      getAbiBytesCalldataWithPadding(data)
    )
    const transactionsHex = multiSendDecoded[0]
    if (typeof transactionsHex !== 'string') return null

    return decodeMultiSend(transactionsHex).map((transaction) => ({
      to: transaction.to,
      data: transaction.data,
      value: transaction.value
    }))
  } catch {
    return null
  }
}
