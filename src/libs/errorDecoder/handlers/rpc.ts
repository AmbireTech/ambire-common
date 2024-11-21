/* eslint-disable class-methods-use-this */
import { DecodedError, ErrorHandler, ErrorType } from '../types'
import { USER_REJECTED_TRANSACTION_ERROR_CODE } from './userRejection'

class RpcErrorHandler implements ErrorHandler {
  public matches(data: string, error: any) {
    if (error?.message === 'rpc-timeout') return true
    if (error?.message.includes('gas too low')) return true
    if (error?.message.includes('transaction underpriced')) return true

    return (
      !data &&
      !!error.message &&
      !error?.message?.includes('rejected transaction') &&
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      error?.code !== undefined &&
      error.code !== USER_REJECTED_TRANSACTION_ERROR_CODE
    )
  }

  public handle(data: string, error: Error): DecodedError {
    const rpcError = error as any
    let reason = rpcError.shortMessage || rpcError.message || rpcError.info?.error?.message

    if (typeof rpcError?.code === 'string') {
      reason = rpcError.code
    }

    if (error?.message.includes('gas too low')) {
      reason = 'Low gas limit'
    }

    if (error?.message.includes('transaction underpriced')) {
      reason = 'Transaction underpriced'
    }

    return {
      type: ErrorType.RpcError,
      reason,
      data
    }
  }
}

export default RpcErrorHandler
