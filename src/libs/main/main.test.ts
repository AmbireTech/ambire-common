import { describe, expect, test } from '@jest/globals'

import { SignAccountOpController } from '../../controllers/signAccountOp/signAccountOp'
import { CallsUserRequest } from '../../interfaces/userRequest'
import { getShouldSimulateInTheBackground } from './main'

type RequestParams = {
  id: string
  chainId?: bigint
  isSafe?: boolean
  nonce?: bigint | null
  safeTxNonce?: bigint | number | string
  signed?: string[]
  broadcastStatus?: SignAccountOpController['broadcastStatus']
}

const makeRequest = ({
  id,
  chainId = 1n,
  isSafe = true,
  nonce = 0n,
  safeTxNonce,
  signed,
  broadcastStatus = 'INITIAL'
}: RequestParams): CallsUserRequest =>
  ({
    id,
    signAccountOp: {
      broadcastStatus,
      account: {
        safeCreation: isSafe ? {} : undefined
      },
      accountOp: {
        chainId,
        nonce,
        signed,
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

  test('blocks background simulation for a signed Safe request', () => {
    const currentRequest = makeRequest({
      id: 'current',
      isSafe: true,
      nonce: 2n,
      signed: ['0xd6e371526cdaeE04cd8AF225D42e37Bc14688D9E']
    })

    expect(getShouldSimulateInTheBackground(currentRequest)).toBe(false)
  })

  test('allows background simulation for a not signed Safe request', () => {
    const currentRequest = makeRequest({ id: 'current', isSafe: true, nonce: 2n, signed: [] })

    expect(getShouldSimulateInTheBackground(currentRequest)).toBe(true)
  })

  test('allows background simulation for a signed Safe request that is being broadcast', () => {
    const currentRequest = makeRequest({
      id: 'current',
      isSafe: true,
      nonce: 2n,
      signed: [
        '0xd6e371526cdaeE04cd8AF225D42e37Bc14688D9E',
        '0x5Be214147EA1AE3653f289E17fE7Dc17A73AD175'
      ],
      broadcastStatus: 'LOADING'
    })

    expect(getShouldSimulateInTheBackground(currentRequest)).toBe(true)
  })

  test('blocks background simulation for a signed Safe request whose broadcast failed', () => {
    const currentRequest = makeRequest({
      id: 'current',
      isSafe: true,
      nonce: 2n,
      signed: ['0xd6e371526cdaeE04cd8AF225D42e37Bc14688D9E'],
      broadcastStatus: 'ERROR'
    })

    expect(getShouldSimulateInTheBackground(currentRequest)).toBe(false)
  })

  test('blocks background simulation for a signed Safe request after a finished broadcast', () => {
    const currentRequest = makeRequest({
      id: 'current',
      isSafe: true,
      nonce: 2n,
      signed: ['0xd6e371526cdaeE04cd8AF225D42e37Bc14688D9E'],
      broadcastStatus: 'SUCCESS'
    })

    expect(getShouldSimulateInTheBackground(currentRequest)).toBe(false)
  })
})
