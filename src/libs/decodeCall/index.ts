import { Interface } from 'ethers'
import { decodeFunctionData, Hex, isHex, parseAbi } from 'viem'

import { Call } from '../accountOp/types'

// TODO should we move this
export type DecodedCall = {
  args: { key: string; val: DecodedArgument }[]
  selector: string
  signature: string
  data: string
  diffInBytes: number
}
type DecodedArgument = bigint | string | boolean | DecodedCall['args'] | DecodedCall

function unknownToDecodedArgsToCustomType(key: string, val: unknown): DecodedCall['args'][number] {
  if (typeof val === 'boolean') return { key, val }
  else if (typeof val === 'string') return { key, val }
  else if (typeof val === 'bigint') return { key, val }
  else if (typeof val === 'object') {
    if (!val) return { key, val: false }
    else if (Array.isArray(val)) return { key: key, val: arrayUnknownDecodedArgsToCustomType(val) }
    else {
      const entries = Object.entries(val).map(([k, v]) => unknownToDecodedArgsToCustomType(k, v))
      return { key, val: entries }
    }
  }
  // TODO: how should we handle this
  return { key, val: false }
}

function arrayUnknownDecodedArgsToCustomType(args: readonly unknown[]): DecodedCall['args'] {
  const dataToReturn: DecodedCall['args'] = []
  args.forEach((val, i) => {
    let key = `param${i}`
    dataToReturn.push(unknownToDecodedArgsToCustomType(key, val))
  })
  return dataToReturn
}

export function decodeCall(
  data: Call['data'],
  foundSignatures: { signature: string; filtered: boolean }[]
): DecodedCall | null {
  if (!isHex(data)) return null
  let resultWithDiff: { diff: number; decoded: DecodedCall | null } = {
    diff: Infinity,
    decoded: null
  }
  for (const { signature } of foundSignatures) {
    const iface = new Interface(['function ' + signature])
    // TODO: this is extremely buggy and does not work yet
    // TODO: test if it throws when unable to decode
    try {
      const parsed = iface.parseTransaction({ data })

      if (!parsed) continue
      const argsToReturn = arrayUnknownDecodedArgsToCustomType(parsed.args)
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
    } catch (e) {
      console.log('ERROR DECODING')
      console.log(e)
      // TODO should we ignore it?
    }
  }
  // this is just a false positive MITIGATION
  // in cases where the data part is 1 slot (32 bytes) and there is
  // a found function that does not have arguments
  // encountered as issue on a zero slot 0x00000.000000
  if (data.length === '0x'.length + 64 && resultWithDiff.diff === 16) return null
  // mitigation for false positive when there is no exact match
  if (resultWithDiff.diff && data.startsWith('0x00000000')) return null
  return resultWithDiff.decoded
}
