import { describe, expect, test } from '@jest/globals'

import { CallsUserRequest } from '../../interfaces/userRequest'
import { getShouldSimulateInTheBackground } from './main'

type RequestParams = {
  id: string
  chainId?: bigint
  isSafe?: boolean
  isSafeRejected?: boolean
  nonce?: bigint | null
  safeTxNonce?: bigint | number | string
}

const makeRequest = ({
  id,
  chainId = 1n,
  isSafe = true,
  isSafeRejected = false,
  nonce = 0n,
  safeTxNonce
}: RequestParams): CallsUserRequest =>
  ({
    id,
    meta: { isSafeRejected },
    signAccountOp: {
      account: {
        safeCreation: isSafe ? {} : undefined
      },
      accountOp: {
        chainId,
        nonce,
        safeTx:
          typeof safeTxNonce === 'undefined'
            ? undefined
            : {
                nonce: safeTxNonce
              }
      }
    }
  }) as CallsUserRequest

describe('getShouldSimulateInTheBackground', () => {
  test('allows background simulation for non-Safe requests', () => {
    const currentRequest = makeRequest({ id: 'current', isSafe: false, nonce: 2n })

    expect(getShouldSimulateInTheBackground(currentRequest)).toBe(true)
  })

  test('blocks background simulation for a Safe request', () => {
    const currentRequest = makeRequest({ id: 'current', isSafe: true, nonce: 2n })

    expect(getShouldSimulateInTheBackground(currentRequest)).toBe(false)
  })
})
