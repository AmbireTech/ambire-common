/* eslint-disable class-methods-use-this */
import { DecodedError, ErrorHandler, ErrorType } from '../types'

class RpcErrorHandler implements ErrorHandler {
  public matches(data: string, error: Error) {
    if (error?.message === 'rpc-timeout') return true

    return (
      !data &&
      !!error.message &&
      !error?.message?.includes('rejected transaction') &&
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (error as any).code !== undefined
    )
  }

  public handle(data: string, error: Error): DecodedError {
    const rpcError = error as any
    const reason =
      rpcError.code ?? rpcError.shortMessage ?? rpcError.message ?? rpcError.info?.error?.message

    return {
      type: ErrorType.RpcError,
      reason,
      data
    }
  }
}

export default RpcErrorHandler
