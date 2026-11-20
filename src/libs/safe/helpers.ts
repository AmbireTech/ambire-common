import { concat, getBytes, hexlify, Interface, solidityPacked, toBeHex, ZeroAddress } from 'ethers'

import { getSigForCalculations } from '@/libs/estimate/estimateHelpers'

import { allowedMulticallContracts, execTransactionAbi, multiSendAddr } from '../../consts/safe'
import { AccountOnchainState } from '../../interfaces/account'
import { Hex } from '../../interfaces/hex'
import { SafeTx } from '../../interfaces/safe'
import { CallsUserRequest } from '../../interfaces/userRequest'
import isSameAddr from '../../utils/isSameAddr'
import { AccountOp, getSignableCalls } from '../accountOp/accountOp'
import { Call } from '../accountOp/types'
import { getAbiBytesCalldataWithPadding } from '../humanizer/erc7730/calldata'

import type { SafeMultisigTransactionResponse } from '@safe-global/types-kit'

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

const multiSendInterface = new Interface(multiCallAbi)

/** A call made by a Safe transaction, either on its own or as part of a multiSend batch */
type SafeTxCall = Pick<Call, 'to' | 'value' | 'data'>

/** What a Safe transaction does, without its gas and nonce: its target, value, data and operation */
type SafeTxAction = Pick<SafeMultisigTransactionResponse, 'to' | 'value' | 'data' | 'operation'>

/**
 * The `transactions` of a `multiSend` batch of the calls. Each one is made as a plain call, never
 * as a delegate call
 */
function encodeMultiSendTransactions(calls: { to: string; value: bigint; data: string }[]): Hex {
  return concat(
    calls.map(({ to, value, data }) =>
      solidityPacked(
        ['uint8', 'address', 'uint256', 'uint256', 'bytes'],
        [SAFE_CALL_OPERATION, to, value, BigInt(getBytes(data).length), data]
      )
    )
  ) as Hex
}

/**
 * The `multiSend` calldata that batches the calls. Each one is made as a plain call, never as a
 * delegate call
 */
function encodeMultiSendData(calls: { to: string; value: bigint; data: string }[]): Hex {
  return multiSendInterface.encodeFunctionData('multiSend', [
    encodeMultiSendTransactions(calls)
  ]) as Hex
}

/**
 * The `transactions` a multiSend contract runs for this calldata, or null if it isn't a
 * `multiSend` call. They are read the way the contract reads them, so a batch whose data isn't
 * padded to a full 32-byte word at its end (as some apps send it) is still read
 */
function getMultiSendTransactions(data?: string | null): string | null {
  if (!data) return null

  try {
    const [transactions] = multiSendInterface.decodeFunctionData(
      'multiSend',
      getAbiBytesCalldataWithPadding(data)
    )

    return typeof transactions === 'string' ? transactions : null
  } catch {
    // Not a multiSend call
    return null
  }
}

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

  const multiSendData = encodeMultiSendData(
    calls.map(([to, value, data]) => ({ to: to!, value: BigInt(value), data }))
  )

  return {
    to: multiSendAddr as Hex,
    value: 0n,
    data: multiSendData,
    operation: SAFE_DELEGATE_CALL_OPERATION
  }
}

const isSameData = (one?: string | null, two?: string | null) =>
  (one || '0x').toLowerCase() === (two || '0x').toLowerCase()

const isMultiSendContract = (addr: string) =>
  allowedMulticallContracts.some((multiSend) => isSameAddr(multiSend, addr))

/**
 * Whether the calls do exactly what the Safe transaction does, so what is shown (and simulated)
 * for them is what the owners sign: either a single call made by the Safe with the same target,
 * value and data, or a batch of plain calls run through a known multiSend contract with a
 * delegate call and no value, where the calls encode to exactly the batch the contract runs
 */
export function doCallsMatchSafeTx(calls: SafeTxCall[], safeTx: SafeTxAction): boolean {
  try {
    const operation = Number(safeTx.operation)

    if (operation === SAFE_CALL_OPERATION) {
      const [call] = calls
      return (
        calls.length === 1 &&
        !!call?.to &&
        isSameAddr(call.to, safeTx.to) &&
        call.value === BigInt(safeTx.value) &&
        isSameData(call.data, safeTx.data)
      )
    }

    if (operation !== SAFE_DELEGATE_CALL_OPERATION) return false
    if (!calls.length || !isMultiSendContract(safeTx.to)) return false
    // A delegate call doesn't send value, so a batch made by Ambire or the Safe app never has one
    if (BigInt(safeTx.value) !== 0n) return false

    const batchCalls = calls.flatMap(({ to, value, data }) => (to ? [{ to, value, data }] : []))
    if (batchCalls.length !== calls.length) return false

    const transactions = getMultiSendTransactions(safeTx.data)
    return !!transactions && isSameData(encodeMultiSendTransactions(batchCalls), transactions)
  } catch {
    // Malformed values (e.g. a value that isn't a number) can't match anything
    return false
  }
}

/** The calls of a multiSend batch, or null if the data isn't a batch that could be fully read */
function decodeMultiSendCalls(data?: string | null): SafeTxCall[] | null {
  const transactions = getMultiSendTransactions(data)
  if (!transactions) return null

  try {
    const decoded = decodeMultiSend(transactions)
    if (!decoded.every((call): call is SuccessfullyDecoded => call.success)) return null

    return decoded.map(({ to, value, data: callData }) => ({ to, value, data: callData }))
  } catch {
    // The batch can't be read
    return null
  }
}

/** The Safe transaction as one call with its target, value and data, without its operation */
const toSingleSafeTxCall = (safeTx: SafeTxAction): SafeTxCall => ({
  to: safeTx.to,
  value: BigInt(safeTx.value),
  data: safeTx.data || '0x'
})

/**
 * The calls that do exactly what a Safe transaction does (see doCallsMatchSafeTx): the
 * transaction itself if it's a plain call, or the calls of a batch it runs through a known
 * multiSend contract. Null if it can't be broken down into such calls, e.g. a delegate call to
 * an unknown contract, a batch with a value, or a batch with a delegate call in it
 */
export function getExactSafeTxCalls(safeTx: SafeTxAction): SafeTxCall[] | null {
  const batchCalls = decodeMultiSendCalls(safeTx.data)
  if (batchCalls && doCallsMatchSafeTx(batchCalls, safeTx)) return batchCalls

  const singleCall = toSingleSafeTxCall(safeTx)
  return doCallsMatchSafeTx([singleCall], safeTx) ? [singleCall] : null
}

/**
 * The calls to show and simulate for a Safe transaction from the Safe Transaction Service.
 * A batch is split into its calls only if they encode back to exactly the same transaction
 * (see getExactSafeTxCalls). Otherwise the transaction is shown as it will be sent, as one call
 * with its target, value and data. A call can't carry the operation, so a delegate call shown
 * this way gets a warning on the sign screen (see getSafeTxNotShownAsCallsWarning)
 */
export function getSafeTxCalls(safeTx: SafeTxAction): SafeTxCall[] {
  return getExactSafeTxCalls(safeTx) ?? [toSingleSafeTxCall(safeTx)]
}

/** The Safe transaction its owners sign, from a Safe Transaction Service response */
export function toSafeTx(safeTx: SafeMultisigTransactionResponse): SafeTx {
  return {
    to: safeTx.to as Hex,
    value: toBeHex(safeTx.value) as Hex,
    data: safeTx.data ? (safeTx.data as Hex) : '0x',
    operation: safeTx.operation,
    safeTxGas: toBeHex(safeTx.safeTxGas) as Hex,
    baseGas: toBeHex(safeTx.baseGas) as Hex,
    gasPrice: toBeHex(safeTx.gasPrice) as Hex,
    gasToken: safeTx.gasToken as Hex,
    refundReceiver: safeTx.refundReceiver ? (safeTx.refundReceiver as Hex) : '0x',
    nonce: toBeHex(safeTx.nonce) as Hex
  }
}

/** An empty address (`0x`) is hashed as the zero address */
const isSameSafeTxAddr = (one: string, two: string) =>
  isSameAddr(one === '0x' ? ZeroAddress : one, two === '0x' ? ZeroAddress : two)

/** Whether two Safe transactions are the same, i.e. their owners sign the same thing */
export function isSameSafeTx(one: SafeTx, two: SafeTx): boolean {
  return (
    isSameSafeTxAddr(one.to, two.to) &&
    BigInt(one.value) === BigInt(two.value) &&
    isSameData(one.data, two.data) &&
    Number(one.operation) === Number(two.operation) &&
    BigInt(one.safeTxGas) === BigInt(two.safeTxGas) &&
    BigInt(one.baseGas) === BigInt(two.baseGas) &&
    BigInt(one.gasPrice) === BigInt(two.gasPrice) &&
    isSameSafeTxAddr(one.gasToken, two.gasToken) &&
    isSameSafeTxAddr(one.refundReceiver, two.refundReceiver) &&
    BigInt(one.nonce) === BigInt(two.nonce)
  )
}

/**
 * Construct a Safe txn for signing
 */
export function getSafeTxn(op: AccountOp, state: AccountOnchainState): SafeTx {
  // A Safe txn from the Safe Transaction Service is signed as it was fetched. It's taken only
  // if it matches its Safe transaction hash (see SafeController.fetchPending), and it never
  // changes while its request is open (see RequestsController)
  if (op.safeTx) return toSafeTx(op.safeTx)

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
  if (origin.length > 200) return undefined
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
