/* eslint-disable class-methods-use-this */
import { isReasonValid } from '../helpers'
import { DecodedError, ErrorHandler, ErrorType } from '../types'
import { USER_REJECTED_TRANSACTION_ERROR_CODE } from './userRejection'

export const RPC_HARDCODED_ERRORS = {
  lowGasLimit: 'Low gas limit',
  transactionUnderpriced: 'Transaction underpriced',
  rpcTimeout: 'rpc-timeout'
}

class RpcErrorHandler implements ErrorHandler {
  public matches(data: string, error: any) {
    // This is the only case in which we want to check for a specific error message
    // because it's a custom error that should be handled as an RPC error
    if (error?.message === RPC_HARDCODED_ERRORS.rpcTimeout) return true

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

    if (typeof rpcError?.code === 'string' && isReasonValid(rpcError.code)) {
      reason = rpcError.code
    }

    if (error?.message.includes('gas too low')) {
      reason = RPC_HARDCODED_ERRORS.lowGasLimit
    } else if (error?.message.includes('transaction underpriced')) {
      reason = RPC_HARDCODED_ERRORS.transactionUnderpriced
    }

    return {
      type: ErrorType.RpcError,
      reason,
      data
    }
  }
}

export default RpcErrorHandler