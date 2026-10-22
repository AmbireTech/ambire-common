import SwapAndBridgeProviderApiError from '../../classes/SwapAndBridgeProviderApiError'
import { CustomResponse, Fetch } from '../../interfaces/fetch'
import { SwapAndBridgeRouteStatusResult } from '../../interfaces/swapAndBridge'
import { ACROSS_API_BASE_URL } from './constants'

interface AcrossDepositStatusResponse {
  status: 'filled' | 'pending' | 'expired' | 'refunded'
  fillTxnRef?: string | null
  depositRefundTxnRef?: string | null
}

interface AcrossDepositStatusErrorResponse {
  error: string
  message: string
}

const isAcrossDepositNotFound = (
  response: AcrossDepositStatusResponse | AcrossDepositStatusErrorResponse
): response is AcrossDepositStatusErrorResponse =>
  'error' in response && response.error === 'DepositNotFoundException'

export class AcrossAPI {
  #fetch: Fetch

  #requestTimeoutMs = 15000

  constructor({ fetch }: { fetch: Fetch }) {
    this.#fetch = fetch
  }

  async getRouteStatus({ txHash }: { txHash: string }): Promise<SwapAndBridgeRouteStatusResult> {
    const params = new URLSearchParams({
      depositTxnRef: txHash
    })

    let response: CustomResponse
    let timeoutPromise: NodeJS.Timeout | undefined

    try {
      response = await Promise.race([
        this.#fetch(`${ACROSS_API_BASE_URL}/deposit/status?${params.toString()}`),
        new Promise<CustomResponse>((_, reject) => {
          timeoutPromise = setTimeout(() => {
            reject(
              new SwapAndBridgeProviderApiError(
                'Our service provider Across is temporarily unavailable or your internet connection is too slow.'
              )
            )
          }, this.#requestTimeoutMs)
        })
      ])
    } catch (e: any) {
      if (e instanceof SwapAndBridgeProviderApiError) throw e

      const message = e?.message || 'no message'
      const status = e?.status ? `, status: <${e.status}>` : ''
      throw new SwapAndBridgeProviderApiError(
        `Unable to get the route status. Please check back later to proceed. Our service provider Across could not be reached: <${message}>${status}`
      )
    } finally {
      if (timeoutPromise) clearTimeout(timeoutPromise)
    }

    let responseBody: AcrossDepositStatusResponse | AcrossDepositStatusErrorResponse
    try {
      responseBody = await response.json()
    } catch (e: any) {
      const message = e?.message || 'no message'
      throw new SwapAndBridgeProviderApiError(
        `Unable to get the route status. Please check back later to proceed. Error details: <Unexpected non-JSON response from our service provider Across>, message: <${message}>`
      )
    }

    if (!response.ok && !isAcrossDepositNotFound(responseBody)) {
      const upstreamMessage =
        'message' in responseBody
          ? responseBody.message
          : JSON.stringify(responseBody).slice(0, 250)
      throw new SwapAndBridgeProviderApiError(
        `Unable to get the route status. Please check back later to proceed. Our service provider Across responded: <${upstreamMessage}>`
      )
    }

    if (isAcrossDepositNotFound(responseBody)) return { status: null }
    if (responseBody.status === 'filled' && responseBody.fillTxnRef) {
      return { status: 'completed', txnId: responseBody.fillTxnRef }
    }
    if (responseBody.status === 'refunded' && responseBody.depositRefundTxnRef) {
      return { status: 'refunded', txnId: responseBody.depositRefundTxnRef }
    }

    return { status: null }
  }
}
