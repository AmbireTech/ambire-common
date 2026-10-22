import { Interface } from 'ethers'
import { isHex } from 'viem'

import { DecodedCall, RecursivelyDecodedCallData } from '@/interfaces/decodeCall'

import { Call } from '../accountOp/types'
import { stringify } from '../richJson/richJson'

import type { IrCall } from '../humanizer/interfaces'
/** Length of the 0x prefixed function selector at the start of call data. */
export const CALLDATA_SELECTOR_HEX_LENGTH = 10

const ADDRESS_HEX_LENGTH = 42

/**
 *
 * @param type string of the type of the solidity function argument, should be tuple
 * example tuple(address,uint256[]), tuple(address,tuple(address,address,uint[]))
 * @returns the inner arguments in top-most tuple
 * For tuple(address,uint[],tuple(address)) => ['address', 'uint[]','tuple(address)']
 */
function splitTupleArgs(type: string): string[] | null {
  if (!type.startsWith('tuple(') || !type.endsWith(')')) return null
  type = type.slice(6, -1)
  const res = []
  let depth = 0
  let current = ''

  for (let c of type) {
    if (c === ',' && depth === 0) {
      res.push(current)
      current = ''
      continue
    }

    if (c === '(' || c === '[') depth++
    if (c === ')' || c === ']') depth--

    current += c
  }

  if (current) res.push(current)
  return res
}

function unknownToDecodedArgsToCustomType(
  key: string,
  val: unknown,
  type: string | null
): DecodedCall['args'][number] {
  if (typeof val === 'boolean') return { key: type || key, val }
  else if (typeof val === 'string') return { key: type || key, val }
  else if (typeof val === 'bigint' || typeof val === 'number')
    return { key: type || key, val: BigInt(val) }
  else if (typeof val === 'object') {
    if (!val) return { key: type || key, val: false }
    else if (Array.isArray(val)) {
      let innerTypes = undefined
      if (type && type.endsWith(']')) {
        const indexOfLastBracket = type.lastIndexOf('[')
        const typesOfInnerElements = type.slice(0, indexOfLastBracket)
        innerTypes = Array.from({ length: val.length }).map(() => typesOfInnerElements)
      } else if (type && type.startsWith('tuple')) {
        innerTypes = splitTupleArgs(type)
      }
      return { key, val: arrayUnknownDecodedArgsToCustomType(val, innerTypes || null) }
    } else {
      const entries = Object.entries(val).map(([k, v]) =>
        unknownToDecodedArgsToCustomType(k, v, null)
      )
      return { key: key, val: entries }
    }
  }
  // will reach here for symbol  or undefined
  return { key: type || key, val: false }
}

function arrayUnknownDecodedArgsToCustomType(
  args: readonly unknown[],
  types: string[] | null
): DecodedCall['args'] {
  const dataToReturn: DecodedCall['args'] = []
  args.forEach((val, i) => {
    let key = `param${i}`
    dataToReturn.push(unknownToDecodedArgsToCustomType(key, val, types?.[i] || null))
  })
  return dataToReturn
}

export function decodeCall(
  data: Call['data'],
  foundSignatures: { signature: string }[]
): DecodedCall | null {
  if (!isHex(data)) return null
  let resultWithDiff: { diff: number; decoded: DecodedCall | null } = {
    diff: Infinity,
    decoded: null
  }
  for (const { signature } of foundSignatures) {
    try {
      const iface = new Interface(['function ' + signature])
      const parsed = iface.parseTransaction({ data })
      if (!parsed) continue
      const argsToReturn = arrayUnknownDecodedArgsToCustomType(
        parsed.args,
        parsed.fragment.inputs.map((i) => i.type)
      )
      const reEncoded = iface.encodeFunctionData(parsed.fragment, parsed.args)
      const diffInBytes = (data.length - reEncoded.length) / 2
      const result = {
        diffInBytes,
        signature,
        selector: data.slice(0, CALLDATA_SELECTOR_HEX_LENGTH),
        args: argsToReturn
      }
      if (!diffInBytes) return result
      if (resultWithDiff.diff > diffInBytes) {
        resultWithDiff = {
          diff: diffInBytes,
          decoded: result
        }
      }
    } catch (e: any) {
      // we will not be able to decode the function if it is malformed
      console.warn(`decodeCall: ${e.message}`)
      // TODO should we ignore it?
    }
  }
  // this is just a false positive MITIGATION
  // in cases where the data part is 1 slot (32 bytes) and there is
  // a found function that does not have arguments
  // encountered as issue on a zero slot 0x00000.000000
  if (data.length === '0x'.length + 32 * 2 && resultWithDiff.diff === 32 - 4) return null
  // mitigation for false positive when there is no exact match
  if (resultWithDiff.diff && data.startsWith('0x00000000')) return null
  return resultWithDiff.decoded
}

function decodeNestedArg(
  arg: DecodedCall['args'][number],
  getSignatures: (selector: string) => { signature: string }[],
  lookedUpSelectors: Set<string>
): DecodedCall['args'][number] {
  if (
    typeof arg.val === 'string' &&
    isHex(arg.val) &&
    arg.val.length >= CALLDATA_SELECTOR_HEX_LENGTH &&
    arg.val.length !== ADDRESS_HEX_LENGTH
  )
    return {
      key: arg.key,
      val: decodeCallDataWithNesting(arg.val, getSignatures, lookedUpSelectors) || arg.val
    }
  if (Array.isArray(arg.val))
    return {
      key: arg.key,
      val: arg.val.map((nestedArg) => decodeNestedArg(nestedArg, getSignatures, lookedUpSelectors))
    }
  return arg
}

function decodeCallDataWithNesting(
  data: string,
  getSignatures: (selector: string) => { signature: string }[],
  lookedUpSelectors: Set<string>
): DecodedCall | null {
  if (!isHex(data) || data.length < CALLDATA_SELECTOR_HEX_LENGTH) return null

  const selector = data.slice(0, CALLDATA_SELECTOR_HEX_LENGTH)
  lookedUpSelectors.add(selector)

  const signatures = getSignatures(selector)
  if (!signatures.length) return null

  const decoded = decodeCall(data, signatures)
  if (!decoded) return null

  return {
    ...decoded,
    args: decoded.args.map((arg) => decodeNestedArg(arg, getSignatures, lookedUpSelectors))
  }
}

/**
 * Decodes call data with the signatures known for its selector, then keeps decoding every
 * argument that is call data itself. `getSignatures` gives the known signatures of a selector,
 * or an empty list. Nothing is fetched, so the result also lists every selector that was looked
 * up, letting the caller fetch the unknown ones and decode again.
 */
export function decodeCallDataRecursively(
  data: string,
  getSignatures: (selector: string) => { signature: string }[]
): RecursivelyDecodedCallData {
  const lookedUpSelectors = new Set<string>()
  const decodedCall = decodeCallDataWithNesting(data, getSignatures, lookedUpSelectors)

  return { decodedCall, selectors: [...lookedUpSelectors] }
}

/**
 * Returns the calls with `decodedCall` set from `getDecodedCall`, which is asked once per
 * distinct call data and gives null when the data can't be decoded. A call that isn't decoded
 * gets `isDecodingCall` when `isDecoding` says its signatures are still on the way. Calls that
 * come out the same are kept as they are, and so is the whole array when none of them changed,
 * so a caller that re-renders on a reference change only does so when the decoding actually
 * changed.
 */
export function withDecodedCalls(
  calls: IrCall[],
  getDecodedCall: (data: string) => DecodedCall | null,
  isDecoding: (data: string) => boolean
): IrCall[] {
  const decodedCallsByData = new Map<string, DecodedCall | undefined>()
  let hasChanged = false

  const callsWithDecodedData = calls.map((call) => {
    if (!decodedCallsByData.has(call.data)) {
      decodedCallsByData.set(call.data, getDecodedCall(call.data) || undefined)
    }
    const decodedCall = decodedCallsByData.get(call.data)
    const isDecodingCall = !decodedCall && isDecoding(call.data) ? true : undefined

    if (
      stringify(call.decodedCall) === stringify(decodedCall) &&
      call.isDecodingCall === isDecodingCall
    )
      return call

    hasChanged = true

    return { ...call, decodedCall, isDecodingCall }
  })

  return hasChanged ? callsWithDecodedData : calls
}
