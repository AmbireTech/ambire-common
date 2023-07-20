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
    // Note: If we consider that concatenating `n` is not secure enough, we can include additional symbols
    return typeof value === 'bigint' ? `${value.toString()}n` : value
  })
}

export function parse(json: string) {
  return JSON.parse(json, (key, value) => {
    // Validating for a numeric value, ending with n, i.e. `5000n`.
    if (typeof value === 'string' && /^\d+n$/.test(value)) {
      // Remove the last concatenated `n`
      return BigInt(value.substr(0, value.length - 1))
    }
    return value
  })
}
