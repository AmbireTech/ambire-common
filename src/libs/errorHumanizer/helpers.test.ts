import { describe, expect } from '@jest/globals'

import { suppressConsole } from '../../../test/helpers/console'
import { decodeError } from '../errorDecoder'
import { ErrorType } from '../errorDecoder/types'
import { MESSAGE_PREFIX } from './estimationErrorHumanizer'
import { getGenericMessageFromType } from './helpers'

describe('Generic error fallbacks work', () => {
  it('RPC error', () => {
    const messageWithCode = getGenericMessageFromType(
      ErrorType.RpcError,
      'Unsupported method',
      MESSAGE_PREFIX,
      ''
    )
    const messageWithoutCode = getGenericMessageFromType(
      ErrorType.RpcError,
      null,
      MESSAGE_PREFIX,
      ''
    )

    expect(messageWithCode).toBe(
      `${MESSAGE_PREFIX} of an unknown error (Origin: Rpc call). Error code: Unsupported method\nPlease try again or contact Ambire support for assistance.`
    )
    expect(messageWithoutCode).toBe(
      `${MESSAGE_PREFIX} of an unknown error (Origin: Rpc call).\nPlease try again or contact Ambire support for assistance.`
    )
  })
  it('Relayer error', () => {
    const message = getGenericMessageFromType(ErrorType.RelayerError, null, MESSAGE_PREFIX, '')

    expect(message).toBe(
      `${MESSAGE_PREFIX} of an unknown error (Origin: Relayer call).\nPlease try again or contact Ambire support for assistance.`
    )
  })
  it('Null error type', () => {
    const LAST_RESORT_ERROR_MESSAGE =
      'An unknown error occurred while estimating the transaction. Please try again or contact Ambire support for assistance.'
    // @ts-ignore
    const message = getGenericMessageFromType(null, null, MESSAGE_PREFIX, LAST_RESORT_ERROR_MESSAGE)

    expect(message).toBe(LAST_RESORT_ERROR_MESSAGE)
  })
  it('Code error', () => {
    const { restore } = suppressConsole()
    try {
      const variable = undefined
      // @ts-ignore
      const propertyOfUndefined = variable.property

      return propertyOfUndefined
    } catch (e: any) {
      const { reason, type } = decodeError(e)
      const message = getGenericMessageFromType(type, reason, MESSAGE_PREFIX, '')

      expect(message).toBe(
        `${MESSAGE_PREFIX} of an unknown error. Error code: TypeError\nPlease try again or contact Ambire support for assistance.`
      )
    }

    restore()
  })
  it('Innercall failure error with reason', () => {
    const message = getGenericMessageFromType(
      ErrorType.InnerCallFailureError,
      'The contract reverted',
      MESSAGE_PREFIX,
      ''
    )

    expect(message).toBe(
      `${MESSAGE_PREFIX} it will revert onchain. Error code: The contract reverted\n`
    )
  })
  it('Innercall failure error with no reason', () => {
    const message = getGenericMessageFromType(
      ErrorType.InnerCallFailureError,
      '0x',
      MESSAGE_PREFIX,
      ''
    )

    expect(message).toBe(
      `${MESSAGE_PREFIX} it will revert onchain with reason unknown.\nPlease try again or contact Ambire support for assistance.`
    )
  })
})
