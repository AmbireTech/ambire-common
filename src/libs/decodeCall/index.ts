import { Interface } from 'ethers'
import { isHex } from 'viem'

import { DecodedCall } from '@/interfaces/decodeCall'

import { Call } from '../accountOp/types'

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
        selector: data.slice(0, 10),
        args: argsToReturn,
        data
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
