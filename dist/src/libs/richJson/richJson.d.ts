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
export declare function stringify(obj: any): string;
export declare function parse(json: string): any;
//# sourceMappingURL=richJson.d.ts.map