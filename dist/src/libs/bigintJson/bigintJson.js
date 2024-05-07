"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.parse = exports.stringify = void 0;
function stringify(obj) {
    return JSON.stringify(obj, (key, value) => {
        return typeof value === 'bigint' ? { $bigint: value.toString() } : value;
    });
}
exports.stringify = stringify;
function parse(json) {
    return JSON.parse(json, (key, value) => {
        if (value?.$bigint) {
            return BigInt(value.$bigint);
        }
        return value;
    });
}
exports.parse = parse;
//# sourceMappingURL=bigintJson.js.map