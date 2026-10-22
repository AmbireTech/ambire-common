import {
  FetchRequest,
  FetchResponse,
  JsonRpcPayload,
  JsonRpcProvider,
  JsonRpcResult,
  makeError,
  toUtf8Bytes
} from 'ethers'

const JSON_RPC_CONTENT_TYPE = 'application/json'

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
export class FetchJsonRpcProvider extends JsonRpcProvider {
  async _send(payload: JsonRpcPayload | JsonRpcPayload[]): Promise<JsonRpcResult[]> {
    const connection = this._getConnection()

    if (connection.preflightFunc || connection.processFunc) return super._send(payload)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), connection.timeout)

    try {
      const response = await fetch(connection.url, {
        method: 'POST',
        headers: { ...connection.headers, 'content-type': JSON_RPC_CONTENT_TYPE },
        body: JSON.stringify(payload),
        signal: controller.signal
      })

      if (response.ok) return FetchJsonRpcProvider.#readResult(connection, response)

      const failed = await FetchJsonRpcProvider.#toFetchResponse(connection, response)

      // Throws, and does it with ethers' own error for the status
      failed.assertOk()
      return []
    } catch (error: any) {
      if (error?.name !== 'AbortError') throw error

      throw makeError('timeout', 'TIMEOUT', {
        operation: 'request.send',
        reason: 'timeout',
        request: connection
      })
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * The parsed body, as one or more JSON-RPC responses. A batch answers with an
   * array and a single payload with an object, and the caller matches results to
   * payloads over an array either way.
   */
  static async #readResult(connection: FetchRequest, response: Response): Promise<JsonRpcResult[]> {
    // Read as text and parsed here rather than through `response.json()`, so an
    // RPC that answers 200 with something that is not JSON - an error page from
    // whatever sits in front of it - still has its body in the error.
    const body = await response.text()

    try {
      const result = JSON.parse(body)

      return Array.isArray(result) ? result : [result]
    } catch (error) {
      throw makeError('response body is not valid JSON', 'UNSUPPORTED_OPERATION', {
        operation: 'bodyJson',
        info: {
          // Carried along rather than dropped, since it says where the body
          // stopped being JSON, which the body alone does not
          parseError: error,
          response: new FetchResponse(
            response.status,
            response.statusText,
            FetchJsonRpcProvider.#getHeaders(response),
            toUtf8Bytes(body),
            connection
          )
        }
      })
    }
  }

  /**
   * The response as ethers would have built it, so that the errors made from it
   * carry what the app reads off them - the status code among it.
   */
  static async #toFetchResponse(
    connection: FetchRequest,
    response: Response
  ): Promise<FetchResponse> {
    // A body that cannot be read must not hide the status that comes with it,
    // which is what the failure is reported by
    const body = await response.text().catch(() => '')

    return new FetchResponse(
      response.status,
      response.statusText,
      FetchJsonRpcProvider.#getHeaders(response),
      body === '' ? null : toUtf8Bytes(body),
      connection
    )
  }

  /** The response headers as the plain, lower-cased object ethers keeps them in. */
  static #getHeaders(response: Response): Record<string, string> {
    const headers: Record<string, string> = {}

    response.headers.forEach((value, name) => {
      headers[name.toLowerCase()] = value
    })

    return headers
  }
}
