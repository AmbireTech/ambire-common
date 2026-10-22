import { StorageProps } from '../../interfaces/storage';
type MaxJsonCheckDepth = 10;
/**
 * `true` when a value of type T may hold something native JSON cannot round-trip: a BigInt (which
 * JSON.stringify throws on), an Error (which it turns into `{}`), a function or a symbol. `any`,
 * `unknown` and types nested deeper than MaxJsonCheckDepth count as unsafe too, since nothing is
 * known about them.
 */
type HasNonJsonValue<T, Depth extends unknown[] = []> = Depth['length'] extends MaxJsonCheckDepth ? true : unknown extends T ? true : T extends bigint | Error | symbol | ((...args: any[]) => any) ? true : T extends readonly (infer Item)[] ? HasNonJsonValue<Item, [...Depth, unknown]> : T extends object ? true extends {
    [K in keyof T]-?: HasNonJsonValue<T[K], [...Depth, unknown]>;
}[keyof T] ? true : false : false;
/**
 * K itself when the storage value under K can safely skip richJson (it can never hold a BigInt or
 * an Error), `never` otherwise. Evaluated per key, so only the listed keys' types are walked.
 */
export type NativeJsonStorageKey<K extends keyof StorageProps> = K extends keyof StorageProps ? HasNonJsonValue<StorageProps[K]> extends false ? K : never : never;
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
export declare const NATIVE_JSON_STORAGE_KEYS: ReadonlySet<string>;
/** Serializes a storage value, with native JSON for the keys in NATIVE_JSON_STORAGE_KEYS. */
export declare const stringifyStorageValue: (key: string, value: any) => string;
/** Parses a serialized storage value, with native JSON for the keys in NATIVE_JSON_STORAGE_KEYS. */
export declare const parseStorageValue: (key: string, serialized: string) => any;
export {};
//# sourceMappingURL=serialization.d.ts.map