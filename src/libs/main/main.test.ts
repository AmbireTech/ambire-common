import { describe, expect, test } from '@jest/globals'

import { CallsUserRequest } from '../../interfaces/userRequest'
import { getShouldSimulateInTheBackground } from './main'

type RequestParams = {
  id: string
  chainId?: bigint
  isSafe?: boolean
  nonce?: bigint | null
  safeTxNonce?: bigint | number | string
}

const makeRequest = ({
  id,
  chainId = 1n,
  isSafe = true,
  nonce = 0n,
  safeTxNonce
}: RequestParams): CallsUserRequest =>
  ({
    id,
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
    const otherRequest = makeRequest({ id: 'other', nonce: 2n })

    expect(getShouldSimulateInTheBackground(currentRequest, [currentRequest, otherRequest])).toBe(
      true
    )
  })

  test('blocks background simulation when a Safe Global request conflicts with a local Safe nonce', () => {
    const currentRequest = makeRequest({ id: 'current', safeTxNonce: 2 })
    const otherRequest = makeRequest({ id: 'other', nonce: 2n })

    expect(getShouldSimulateInTheBackground(currentRequest, [currentRequest, otherRequest])).toBe(
      false
    )
  })

  test('blocks background simulation when a local Safe request conflicts with a Safe Global nonce', () => {
    const currentRequest = makeRequest({ id: 'current', nonce: 2n })
    const otherRequest = makeRequest({ id: 'other', safeTxNonce: '2' })

    expect(getShouldSimulateInTheBackground(currentRequest, [currentRequest, otherRequest])).toBe(
      false
    )
  })

  test('blocks background simulation for conflicting Safe nonce zero', () => {
    const currentRequest = makeRequest({ id: 'current', safeTxNonce: 0 })
    const otherRequest = makeRequest({ id: 'other', nonce: 0n })

    expect(getShouldSimulateInTheBackground(currentRequest, [currentRequest, otherRequest])).toBe(
      false
    )
  })

  test('allows background simulation for Safe requests with different nonces', () => {
    const currentRequest = makeRequest({ id: 'current', safeTxNonce: 2 })
    const otherRequest = makeRequest({ id: 'other', nonce: 3n })

    expect(getShouldSimulateInTheBackground(currentRequest, [currentRequest, otherRequest])).toBe(
      true
    )
  })

  test('allows background simulation for Safe requests with the same nonce on different chains', () => {
    const currentRequest = makeRequest({ id: 'current', chainId: 1n, nonce: 2n })
    const otherRequest = makeRequest({ id: 'other', chainId: 10n, safeTxNonce: 2 })

    expect(getShouldSimulateInTheBackground(currentRequest, [currentRequest, otherRequest])).toBe(
      true
    )
  })
})
