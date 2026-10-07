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
          // @ts-expect-error
          error[propName] = value[propName]
        })

        return error
      }

      return value
    },
    opts?.pretty ? 4 : 0
  )
}

// Markers that `stringify` writes only when a BigInt or Error is present.
// If neither appears in the raw string, the reviver below would be a no-op for
// every node, so we can take the native `JSON.parse` fast path instead. This
// matters for large all-string blobs (e.g. the multi-MB phishing list), where
// supplying any reviver forces V8 off its fast internal parser and invokes the
// callback once per node — hundreds of thousands of wasted calls that froze the
// mobile worker thread during boot.
// `$bigint` is the exact wrapper key. `"Error` matches the start of a
// serialized Error's `stack` value (`"stack": "Error...`) regardless of
// pretty-print spacing; the reviver still validates with `stack.startsWith`,
// so a coincidental `"Error` elsewhere only costs a reviver pass, never
// correctness.
const RICH_MARKERS = ['$bigint', '"Error']

export function parse(json: string) {
  const needsReviver = RICH_MARKERS.some((marker) => json.includes(marker))
  if (!needsReviver) return JSON.parse(json)

  return JSON.parse(json, (key, value) => {
    if (value?.$bigint) {
      return BigInt(value.$bigint)
    }

    if (value?.stack?.startsWith('Error')) {
      const error = new Error(value.message)
      Object.getOwnPropertyNames(value).forEach((propName) => {
        if (propName !== 'message') {
          // @ts-expect-error
          error[propName] = value[propName]
        }
      })

      return error
    }

    return value
  })
}

export function cloneDeep(value: any): any {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'function' || typeof value === 'symbol' || value === undefined) {
      return undefined
    }
    return value
  }

  if (value instanceof Error) {
    const error: any = new Error(value.message)
    Object.getOwnPropertyNames(value).forEach((propName) => {
      if (propName !== 'message') {
        error[propName] = (value as any)[propName]
      }
    })
    return error
  }

  if (Array.isArray(value)) {
    return value.map((item) => {
      const cloned = cloneDeep(item)
      // JSON.stringify turns undefined/functions in arrays into null
      return cloned === undefined ? null : cloned
    })
  }

  const objToClone = typeof value.toJSON === 'function' ? value.toJSON() : value

  // If toJSON returned a primitive, return it
  if (objToClone === null || typeof objToClone !== 'object') {
    return objToClone
  }

  const clone: any = {}
  for (const key in objToClone) {
    if (Object.prototype.hasOwnProperty.call(objToClone, key) && typeof key !== 'symbol') {
      const clonedVal = cloneDeep(objToClone[key])
      if (clonedVal !== undefined) {
        clone[key] = clonedVal
      }
    }
  }
  return clone
}
