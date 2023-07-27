/**
 *
 * bigintJson lib
 *
 * JSON.serialize and JSON.parse don't support BigInt values.
 * To address this limitation, we have created this small library that adds support for BigInt numbers
 * during JSON serialization and parsing.
 *
 * Limitations: The library does not currently support BigInt values in new Map, Set, or Uint8Array.
 * However, extending and adding support can be easily accomplished if needed.
 * @credits: https://dev.to/benlesh/bigint-and-json-stringify-json-parse-2m8p
 */

export function stringify(obj: any): string {
  return JSON.stringify(obj, (key, value) => {
    return typeof value === 'bigint' ? { $bigint: value.toString() } : value
  })
}

export function parse(json: string) {
  return JSON.parse(json, (key, value) => {
    if (value?.$bigint) {
      return BigInt(value.$bigint)
    }

    return value
  })
}
