import { describe, expect } from '@jest/globals'

import { RelayerPaymasterError } from '../errorDecoder/customErrors'
import { MockRpcError } from '../errorDecoder/errorDecoder.test'
import { getHumanReadableBroadcastError } from './index'

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
      'The transaction cannot be broadcast because the selected fee is too low. Please select a higher transaction speed and try again.'
    )
  })
  it('Transaction underpriced', () => {
    const error = new RelayerPaymasterError({
      errorState: [
        {
          message: 'Error: Transaction underpriced. Please select a higher fee and try again.'
        }
      ]
    })
    const humanizedError = getHumanReadableBroadcastError(error)

    expect(humanizedError.message).toBe(
      'The transaction cannot be broadcast because it is underpriced. Please select a higher transaction speed and try again.'
    )
  })
})
