"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseStorageValue = exports.stringifyStorageValue = exports.NATIVE_JSON_STORAGE_KEYS = void 0;
const richJson_1 = require("../richJson/richJson");
/**
 * Returns the keys as given, but fails to compile when the value type of one of them can hold a
 * BigInt or an Error - so such a key can never be switched to native JSON by mistake.
 */
const defineNativeJsonKeys = (keys) => keys;
const nativeJsonKeys = defineNativeJsonKeys(['phishing', 'dappsV2']);
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
exports.NATIVE_JSON_STORAGE_KEYS = new Set(nativeJsonKeys);
const isNativeJsonKey = (key) => exports.NATIVE_JSON_STORAGE_KEYS.has(key);
/** Serializes a storage value, with native JSON for the keys in NATIVE_JSON_STORAGE_KEYS. */
const stringifyStorageValue = (key, value) => isNativeJsonKey(key) ? JSON.stringify(value) : (0, richJson_1.stringify)(value);
exports.stringifyStorageValue = stringifyStorageValue;
/** Parses a serialized storage value, with native JSON for the keys in NATIVE_JSON_STORAGE_KEYS. */
const parseStorageValue = (key, serialized) => isNativeJsonKey(key) ? JSON.parse(serialized) : (0, richJson_1.parse)(serialized);
exports.parseStorageValue = parseStorageValue;
//# sourceMappingURL=serialization.js.map