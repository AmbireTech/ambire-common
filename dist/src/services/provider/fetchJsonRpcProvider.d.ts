import { JsonRpcPayload, JsonRpcProvider, JsonRpcResult } from 'ethers';
/**
 * A JSON-RPC provider that puts the request on the wire itself instead of
 * routing it through ethers' `FetchRequest`.
 *
 * ethers converts every request body to bytes and every response body back to
 * a string in JS (`toUtf8Bytes`/`toUtf8String`) and reads the response as an
 * `ArrayBuffer` instead of text. `fetch`, `Response#text()` and `JSON.parse`
 * do the same conversions natively, so routing through them avoids that work.
 *
 * Only `_send` is replaced, which is the one method `JsonRpcApiProvider` leaves
 * to its subclasses.
 */
export declare class FetchJsonRpcProvider extends JsonRpcProvider {
    #private;
    _send(payload: JsonRpcPayload | JsonRpcPayload[]): Promise<JsonRpcResult[]>;
}
//# sourceMappingURL=fetchJsonRpcProvider.d.ts.map