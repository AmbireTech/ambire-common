import { concat, getBytes, hexlify, Interface, solidityPacked, toBeHex, ZeroAddress } from 'ethers'

import { getSigForCalculations } from '@/libs/estimate/estimateHelpers'

import { execTransactionAbi, multiSendAddr } from '../../consts/safe'
import { AccountOnchainState } from '../../interfaces/account'
import { Hex } from '../../interfaces/hex'
import { SafeTx } from '../../interfaces/safe'
import { CallsUserRequest } from '../../interfaces/userRequest'
import { AccountOp, getSignableCalls } from '../accountOp/accountOp'

import type { Call } from '../accountOp/types'

export const multiCallAbi = [
  { inputs: [], stateMutability: 'nonpayable', type: 'constructor' },
  {
    inputs: [{ internalType: 'bytes', name: 'transactions', type: 'bytes' }],
    name: 'multiSend',
    outputs: [],
    stateMutability: 'payable',
    type: 'function'
  }
]

export const SAFE_CALL_OPERATION = 0
export const SAFE_DELEGATE_CALL_OPERATION = 1
const SAFE_ORIGIN_MAX_LENGTH = 200

export function encodeCalls(op: AccountOp): {
  to: Hex
  value: bigint
  data: Hex
  operation: number
} {
  const calls = getSignableCalls(op)

  if (calls.length === 1) {
    const singleCall = calls[0]!
    return {
      to: singleCall[0] as Hex,
      value: BigInt(singleCall[1]),
      data: singleCall[2] as Hex,
      operation: SAFE_CALL_OPERATION
    }
  }

  const multiSendData = new Interface(multiCallAbi).encodeFunctionData('multiSend', [
    concat(
      calls.map((call) => {
        return solidityPacked(
          ['uint8', 'address', 'uint256', 'uint256', 'bytes'],
          [SAFE_CALL_OPERATION, call[0], BigInt(call[1]), BigInt(getBytes(call[2]).length), call[2]]
        )
      })
    )
  ])

  return {
    to: multiSendAddr as Hex,
    value: 0n,
    data: multiSendData as Hex,
    operation: SAFE_DELEGATE_CALL_OPERATION
  }
}

/**
 * Construct a Safe txn for signing
 */
export function getSafeTxn(op: AccountOp, state: AccountOnchainState): SafeTx {
  // todo: we're blindly trusting the returned txn from Safe Global, is this OK?
  if (op.safeTx) {
    return {
      to: op.safeTx.to as Hex,
      value: toBeHex(op.safeTx.value) as Hex,
      data: op.safeTx.data ? (op.safeTx.data as Hex) : '0x',
      operation: op.safeTx.operation,
      safeTxGas: toBeHex(op.safeTx.safeTxGas) as Hex,
      baseGas: toBeHex(op.safeTx.baseGas) as Hex,
      gasPrice: toBeHex(op.safeTx.gasPrice) as Hex,
      gasToken: op.safeTx.gasToken as Hex,
      refundReceiver: op.safeTx.refundReceiver ? (op.safeTx.refundReceiver as Hex) : '0x',
      nonce: toBeHex(op.safeTx.nonce) as Hex
    }
  }

  const { to, value, data, operation } = encodeCalls(op)

  return {
    to: to as Hex,
    value: toBeHex(value) as Hex,
    data: data as Hex,
    operation,
    safeTxGas: toBeHex(0) as Hex,
    baseGas: toBeHex(0) as Hex,
    gasPrice: toBeHex(0) as Hex,
    gasToken: ZeroAddress as Hex,
    refundReceiver: ZeroAddress as Hex,
    nonce: toBeHex(op.nonce || state.nonce || 0n) as Hex
  }
}

export function getSafeBroadcastTxn(
  op: AccountOp,
  state: AccountOnchainState
): { to: Hex; value: bigint; data: Hex } {
  const exec = new Interface(execTransactionAbi)
  const safeTxn = getSafeTxn(op, state)
  return {
    to: op.accountAddr as Hex,
    value: 0n,
    data: exec.encodeFunctionData('execTransaction', [
      safeTxn.to,
      safeTxn.value,
      safeTxn.data,
      safeTxn.operation,
      safeTxn.safeTxGas,
      safeTxn.baseGas,
      safeTxn.gasPrice,
      safeTxn.gasToken,
      safeTxn.refundReceiver,
      op.signature && op.signature !== '0x' ? op.signature : getSigForCalculations()
    ]) as Hex
  }
}

/**
 * A single Gnosis Safe MultiSend entry, decoded from its packed byte encoding.
 */
export interface SuccessfullyDecoded {
  success: true
  operation: number
  to: string
  value: bigint
  data: string
}

/**
 * A MultiSend entry that could not be decoded because the remaining bytes don't
 * hold a full, well-formed entry (e.g. truncated or malformed calldata).
 */
export interface FailedDecoded {
  success: false
  /** Human-readable reason the remaining bytes couldn't be read as a MultiSend entry */
  reason: string
}

// operation (1 byte) + to (20 bytes) + value (32 bytes) + dataLength (32 bytes)
const MULTI_SEND_HEADER_SIZE = 1 + 20 + 32 + 32

export function decodeMultiSend(transactionsHex: string): (SuccessfullyDecoded | FailedDecoded)[] {
  const bytes = getBytes(transactionsHex)
  let i = 0
  const results: (SuccessfullyDecoded | FailedDecoded)[] = []

  while (i < bytes.length) {
    const remaining = bytes.length - i

    // Not enough bytes left for a full header, so the remainder can't be a real entry.
    if (remaining < MULTI_SEND_HEADER_SIZE) {
      results.push({
        success: false,
        reason: `${remaining} byte(s) left, which is not enough for a transaction header (needs ${MULTI_SEND_HEADER_SIZE})`
      })
      break
    }

    const operation = bytes[i] as number
    i += 1

    const to = hexlify(bytes.slice(i, i + 20))
    i += 20

    const value = BigInt(hexlify(bytes.slice(i, i + 32)))
    i += 32

    const dataLength = Number(BigInt(hexlify(bytes.slice(i, i + 32))))
    i += 32

    // The declared data length doesn't fit in what's left, so the entry is truncated.
    if (dataLength > bytes.length - i) {
      results.push({
        success: false,
        reason: `declared data length ${dataLength} exceeds the ${bytes.length - i} byte(s) left`
      })
      break
    }

    const data = hexlify(bytes.slice(i, i + dataLength))
    i += dataLength

    results.push({
      success: true,
      operation,
      to,
      value,
      data
    })
  }

  return results
}

/**
 * The requesting dapp is only known on the device that originates the message.
 * We stamp its name and url into Safe's `origin` field so other owners co-signing
 * on a different device can see the request context (they fetch the message from
 * the Safe Transaction Service, which carries no dapp identity of its own).
 * `origin` is capped at 200 chars; if it doesn't fit we skip it rather than risk
 * the message proposal failing validation (missing metadata is recoverable).
 */
export function buildSafeMessageOrigin(
  dapp: { name?: string; url?: string } | null
): string | undefined {
  const name = dapp?.name || ''
  const url = dapp?.url || ''
  if (!name && !url) return undefined

  const origin = JSON.stringify({ name, url })
  if (origin.length > SAFE_ORIGIN_MAX_LENGTH) return undefined
  return origin
}

export function parseSafeMessageOrigin(origin?: string): { name?: string; url?: string } {
  if (!origin) return {}
  try {
    const parsed = JSON.parse(origin)
    if (parsed && typeof parsed === 'object') {
      const name = typeof parsed.name === 'string' ? parsed.name : undefined
      const url = typeof parsed.url === 'string' ? parsed.url : undefined
      return { name, url }
    }
  } catch {
    // origin may be a plain, non-JSON string set by another wallet; treat it as the name
    return { name: origin }
  }
  return {}
}

/**
 * Stores the catalogue dapp IDs for the calls in a Safe transaction. Calls from the same dapp are
 * grouped to keep the payload below Safe's 200-character `origin` limit.
 */
export function buildSafeTransactionOrigin(calls: Call[]): string | undefined {
  const callIndexesByDappId = new Map<string, number[]>()

  calls.forEach((call, index) => {
    if (!call.dapp?.id) return

    const callIndexes = callIndexesByDappId.get(call.dapp.id) || []
    callIndexes.push(index)
    callIndexesByDappId.set(call.dapp.id, callIndexes)
  })

  if (!callIndexesByDappId.size) return undefined

  const origin = JSON.stringify({
    name: 'Ambire',
    v: 1,
    calls: Array.from(callIndexesByDappId.entries())
  })

  if (origin.length > SAFE_ORIGIN_MAX_LENGTH) return undefined
  return origin
}

/**
 * Returns the catalogue dapp ID reported for each call index in an Ambire Safe transaction.
 * Invalid and foreign origin payloads are ignored.
 */
export function parseSafeTransactionOrigin(origin?: string): Map<number, string> {
  const dappIdByCallIndex = new Map<number, string>()
  if (!origin) return dappIdByCallIndex

  try {
    const parsed = JSON.parse(origin)
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      parsed.name !== 'Ambire' ||
      parsed.v !== 1 ||
      !Array.isArray(parsed.calls)
    ) {
      return dappIdByCallIndex
    }

    parsed.calls.forEach((entry: unknown) => {
      if (!Array.isArray(entry) || entry.length !== 2) return

      const [dappId, callIndexes] = entry
      if (typeof dappId !== 'string' || !dappId || !Array.isArray(callIndexes)) return

      callIndexes.forEach((callIndex: unknown) => {
        if (typeof callIndex !== 'number' || !Number.isInteger(callIndex) || callIndex < 0) return
        if (!dappIdByCallIndex.has(callIndex)) {
          dappIdByCallIndex.set(callIndex, dappId)
        }
      })
    })
  } catch {
    return dappIdByCallIndex
  }

  return dappIdByCallIndex
}

/**
 * Safe requests may have multiple "call" ones with the same nonce
 */
export function getSameNonceRequests(requests: CallsUserRequest[]) {
  return requests.reduce((acc: { [nonce: string]: CallsUserRequest[] }, r) => {
    const key = r.signAccountOp.accountOp.nonce?.toString() || '0'

    if (!acc[key]) {
      acc[key] = []
    }

    acc[key].push(r)
    return acc
  }, {})
}
