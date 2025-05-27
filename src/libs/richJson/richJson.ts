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

export function stringify(obj: any, opts?: Options): string {
  return JSON.stringify(
    obj,
    (key, value) => {
      if (typeof value === 'bigint') {
        return { $bigint: value.toString() }
      }

      if (value instanceof Error) {
        const error: any = {}

        Object.getOwnPropertyNames(value).forEach((propName) => {
          // @ts-ignore
          error[propName] = value[propName]
        })

        return error
      }

      return value
    },
    opts?.pretty ? 4 : 0
  )
}

export function parse(json: string) {
  return JSON.parse(json, (key, value) => {
    if (value?.$bigint) {
      return BigInt(value.$bigint)
    }

    if (value?.stack?.startsWith('Error')) {
      const error = new Error(value.message)
      Object.getOwnPropertyNames(value).forEach((propName) => {
        if (propName !== 'message') {
          // @ts-ignore
          error[propName] = value[propName]
        }
      })

      return error
    }

    return value
  })
}
