import { describe, expect } from '@jest/globals'

import { getHumanReadableBroadcastError } from './index'

const MockRpcError = class extends Error {
  public constructor(
    public code?: string | number,
    public info?: { error: { code: number; message: string } },
    public shortMessage?: string
  ) {
    super(info?.error.message || shortMessage)
  }
}

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
      'The transaction cannot be broadcast as the selected fee is too low. Please select a higher transaction speed and try again.'
    )
  })
})
