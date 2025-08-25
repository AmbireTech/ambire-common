/**
 *
 * richJson lib
 *
 * JSON.serialize and JSON.parse don't support BigInt values.
 * To address this limitation, we have created this small library that adds support for BigInt numbers
 * during JSON serialization and parsing.
 *
 * Limitations: The library does not currently support BigInt values in new Map, Set, or Uint8Array.
 * However, extending and adding support can be easily accomplished if needed.
 * @credits: https://dev.to/benlesh/bigint-and-json-stringify-json-parse-2m8p
 *
 *
 * Additionally, JSON.serialize and JSON.parse do not properly serialize the Error object, so we extend that functionality here as well.
 */

interface Options {
  pretty?: boolean
}

const BIGINT_MARKER = '__BIGINT__'
const ERROR_MARKER = '__ERROR__'
const END_MARKER = '__END__'

export function stringify(obj: any, opts?: Options): string {
  return JSON.stringify(
    obj,
    (key, value) => {
      switch (typeof value) {
        case 'bigint':
          return `${BIGINT_MARKER}${value.toString()}${END_MARKER}`
        case 'object':
          if (value instanceof Error) {
            return `${ERROR_MARKER}${value.name}|${value.message}|${value.stack || ''}${END_MARKER}`
          }
          return value
        default:
          return value
      }
    },
    opts?.pretty ? 4 : 0
  )
}

export function parse(json: string) {
  return JSON.parse(json, (key, value) => {
    if (typeof value === 'string') {
      if (value.startsWith(BIGINT_MARKER)) {
        return BigInt(value.slice(BIGINT_MARKER.length, -7))
      }
      if (value.startsWith(ERROR_MARKER)) {
        const [name, message, stack] = value.slice(9, -5).split('|')
        const error = new Error(message)
        error.name = name
        if (stack) error.stack = stack
        return error
      }
    }
    // Compatibility with the old format
    if (typeof value === 'object' && value?.$bigint) {
      return BigInt(value.$bigint)
    }
    return value
  })
}
