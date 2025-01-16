/* eslint-disable class-methods-use-this */
import { InnerCallFailureError } from '../customErrors'
import { DecodedError, ErrorHandler, ErrorType } from '../types'

class InnerCallFailureHandler implements ErrorHandler {
  type = ErrorType.InnerCallFailureError

  public matches(data: string, error: Error) {
    return error.name === 'InnerCallFailureError'
  }

  public handle(data: string, error: Error): DecodedError {
    const innerCallError = error as InnerCallFailureError
    const isError0x = innerCallError.message === '0x'

    // if an error has been found, report it back
    if (!isError0x) {
      const reason = innerCallError.message
      return {
        type: this.type,
        reason,
        data: reason
      }
    }

    // if the error is 0x but we don't have info on the portfolio value
    // because of an RPC failure or something, return error unknown
    if (innerCallError.nativePortfolioValue === undefined) {
      const reason = 'Inner call: 0x'
      return {
        type: this.type,
        reason,
        data: reason
      }
    }

    let callsNative = 0n
    innerCallError.calls.forEach((call) => {
      callsNative += call.value ?? 0n
    })
    const isCallsNativeMoreThanPortfolio = callsNative > innerCallError.nativePortfolioValue!
    const reason = isCallsNativeMoreThanPortfolio
      ? `Insufficient ${innerCallError.network.nativeAssetSymbol} for transaction calls`
      : 'Inner call: 0x'

    return {
      type: this.type,
      reason,
      data: reason
    }
  }
}

export default InnerCallFailureHandler
