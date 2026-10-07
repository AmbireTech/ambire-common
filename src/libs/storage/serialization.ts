import { StorageProps } from '../../interfaces/storage'
import { parse, stringify } from '../richJson/richJson'

const nativeJsonKeys: (keyof StorageProps)[] = ['phishing']

/**
 * Storage keys whose values never hold a BigInt or an Error, so they are written and read with
 * the native JSON functions instead of richJson. richJson's stringify runs a replacer callback for
 * every node, which is what makes writing a large all-string blob (e.g. the phishing list) slow.
 *
 * Only add a key here when its type can never contain a BigInt or an Error: native JSON throws on
 * a BigInt and silently turns an Error into `{}`. Values richJson wrote earlier for these keys are
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
