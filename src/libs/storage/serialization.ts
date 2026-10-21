import { StorageProps } from '../../interfaces/storage'
import { parse, stringify } from '../richJson/richJson'

// How deep HasNonJsonValue walks nested types. Recursive types (e.g. decoded Safe transaction
// data) never bottom out, so past this depth a type counts as unsafe rather than as safe.
type MaxJsonCheckDepth = 10

/**
 * `true` when a value of type T may hold something native JSON cannot round-trip: a BigInt (which
 * JSON.stringify throws on), an Error (which it turns into `{}`), a function or a symbol. `any`,
 * `unknown` and types nested deeper than MaxJsonCheckDepth count as unsafe too, since nothing is
 * known about them.
 */
type HasNonJsonValue<T, Depth extends unknown[] = []> = Depth['length'] extends MaxJsonCheckDepth
  ? true
  : unknown extends T
    ? true
    : T extends bigint | Error | symbol | ((...args: any[]) => any)
      ? true
      : T extends readonly (infer Item)[]
        ? HasNonJsonValue<Item, [...Depth, unknown]>
        : T extends object
          ? true extends { [K in keyof T]-?: HasNonJsonValue<T[K], [...Depth, unknown]> }[keyof T]
            ? true
            : false
          : false

/**
 * K itself when the storage value under K can safely skip richJson (it can never hold a BigInt or
 * an Error), `never` otherwise. Evaluated per key, so only the listed keys' types are walked.
 */
export type NativeJsonStorageKey<K extends keyof StorageProps> = K extends keyof StorageProps
  ? HasNonJsonValue<StorageProps[K]> extends false
    ? K
    : never
  : never

/**
 * Returns the keys as given, but fails to compile when the value type of one of them can hold a
 * BigInt or an Error - so such a key can never be switched to native JSON by mistake.
 */
const defineNativeJsonKeys = <K extends keyof StorageProps>(
  keys: readonly (K & NativeJsonStorageKey<K>)[]
): readonly (keyof StorageProps)[] => keys

const nativeJsonKeys = defineNativeJsonKeys(['phishing', 'dappsV2'])

/**
 * Storage keys whose values never hold a BigInt or an Error, so they are written and read with
 * the native JSON functions instead of richJson. richJson's stringify runs a replacer callback for
 * every node, which is what makes writing a large blob (e.g. the phishing list or the dApps catalog)
 * slow.
 *
 * Only keys whose type can never contain a BigInt or an Error can be added - enforced by the
 * NativeJsonStorageKey type: native JSON throws on a BigInt and silently turns an Error into `{}`. Values richJson wrote earlier for these keys are
 * still read correctly, since without BigInts or Errors richJson's output is plain JSON.
 */
export const NATIVE_JSON_STORAGE_KEYS: ReadonlySet<string> = new Set(nativeJsonKeys)

const isNativeJsonKey = (key: string): boolean => NATIVE_JSON_STORAGE_KEYS.has(key)

/** Serializes a storage value, with native JSON for the keys in NATIVE_JSON_STORAGE_KEYS. */
export const stringifyStorageValue = (key: string, value: any): string =>
  isNativeJsonKey(key) ? JSON.stringify(value) : stringify(value)

/** Parses a serialized storage value, with native JSON for the keys in NATIVE_JSON_STORAGE_KEYS. */
export const parseStorageValue = (key: string, serialized: string): any =>
  isNativeJsonKey(key) ? JSON.parse(serialized) : parse(serialized)
