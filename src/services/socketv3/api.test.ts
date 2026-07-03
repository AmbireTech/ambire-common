import { SocketV3API } from './api'

describe('SocketV3API', () => {
  it('clears the response timeout when the fetch rejects first', async () => {
    jest.useFakeTimers()

    try {
      const fetch = jest.fn().mockRejectedValue(new Error('network error'))
      const api = new SocketV3API({ fetch: fetch as any, apiKey: 'test-api-key' })

      await expect(api.getSupportedChains()).rejects.toThrow('network error')

      expect(jest.getTimerCount()).toBe(0)
    } finally {
      jest.useRealTimers()
    }
  })

  it('maps fulfilled bridge status responses to completed', async () => {
    const destinationTxHash = '0xaeb80e8fb7a01c8cf0332a91473a30dfbedbf115214d3f3fb9bda4ed02cd1cbc'
    const fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        success: true,
        statusCode: 200,
        result: {
          quoteId: '0xb91d4ddc9649d8cbece4e8976c4e9a38237f1a16ba3a67485ebca244178fc410',
          userOp: 'tx',
          status: 'COMPLETED',
          statusCode: 'FULFILLED',
          origin: {
            chainId: 8453,
            status: 'COMPLETED',
            txHash: '0x173e02dc31b2277c60a73d0e644290d28f1a29082ffd0e1ff86b6e025b19ab4b'
          },
          destination: {
            chainId: 10,
            status: 'COMPLETED',
            txHash: destinationTxHash
          },
          refund: null
        },
        message: null
      })
    })
    const api = new SocketV3API({ fetch: fetch as any, apiKey: 'test-api-key' })

    await expect(
      api.getRouteStatus({
        txHash: '0x173e02dc31b2277c60a73d0e644290d28f1a29082ffd0e1ff86b6e025b19ab4b',
        routeId: '0xb91d4ddc9649d8cbece4e8976c4e9a38237f1a16ba3a67485ebca244178fc410'
      })
    ).resolves.toEqual({
      status: 'completed',
      txnId: destinationTxHash
    })
  })

  it('maps direct fulfilled statuses to completed', async () => {
    const destinationTxHash = '0xaeb80e8fb7a01c8cf0332a91473a30dfbedbf115214d3f3fb9bda4ed02cd1cbc'
    const fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        success: true,
        statusCode: 200,
        result: {
          quoteId: '0xb91d4ddc9649d8cbece4e8976c4e9a38237f1a16ba3a67485ebca244178fc410',
          userOp: 'tx',
          status: 'FULFILLED',
          statusCode: 'FULFILLED',
          destination: {
            chainId: 10,
            status: 'COMPLETED',
            txHash: destinationTxHash
          },
          refund: null
        },
        message: null
      })
    })
    const api = new SocketV3API({ fetch: fetch as any, apiKey: 'test-api-key' })

    await expect(
      api.getRouteStatus({
        txHash: '0x173e02dc31b2277c60a73d0e644290d28f1a29082ffd0e1ff86b6e025b19ab4b',
        routeId: '0xb91d4ddc9649d8cbece4e8976c4e9a38237f1a16ba3a67485ebca244178fc410'
      })
    ).resolves.toEqual({
      status: 'completed',
      txnId: destinationTxHash
    })
  })
})
