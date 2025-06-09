import { describe, expect } from '@jest/globals'

import { RelayerPaymasterError } from '../errorDecoder/customErrors'
import { MockRpcError } from '../errorDecoder/errorDecoder.test'
import { RelayerError } from '../relayerCall/relayerCall'
import { getHumanReadableBroadcastError } from './index'

const PREFIX = 'The transaction cannot be broadcast because '
describe('Broadcast errors are humanized', () => {
  it('Paymaster: selected fee too low', async () => {
    // @TODO: Mock the error properly or adjust the condition in getHumanReadableBroadcastError
    const error = new MockRpcError(
      'pimlico_getUserOperationGasPrice',
      {
        error: {
          code: -32603,
          message: 'paymaster fee too low'
        }
      },
      'paymaster fee too low'
    )
    const humanizedError = getHumanReadableBroadcastError(error)

    expect(humanizedError.message).toBe(
      `${PREFIX}the selected fee is too low. Please select a higher transaction speed and try again.`
    )
  })
  it('Transaction underpriced', () => {
    const error = new RelayerPaymasterError({
      message: 'Error: Transaction underpriced. Please select a higher fee and try again.',
      isHumanized: true
    })

    expect(error.message).toBe(
      'Error: Transaction underpriced. Please select a higher fee and try again.'
    )
  })
  it('Relayer user nonce too low', () => {
    const error = new RelayerError('user nonce too low', {}, {})

    const humanizedError = getHumanReadableBroadcastError(error)

    expect(humanizedError.message).toBe(
      `${PREFIX}of a pending transaction. Please try broadcasting again.`
    )
  })
  it('Random relayer error is displayed to the user', () => {
    const error = new RelayerError('the hamsters have stopped running', {}, {})

    const humanizedError = getHumanReadableBroadcastError(error)

    expect(humanizedError.message).toBe(
      `${PREFIX}of an unknown error (Origin: Relayer call). Error code: the hamsters have stopped running\nPlease try again or contact Ambire support for assistance.`
    )
    expect(humanizedError.cause).toBe('the hamsters have stopped running')
  })
})
