import { describe, expect, it, jest } from '@jest/globals'

import { SquidAPI } from './api'

describe('SquidAPI', () => {
  describe('getRouteStatus', () => {
    it('keeps polling when Squid temporarily returns transaction not found', async () => {
      const fetch = jest.fn(async () => ({
        ok: false,
        json: async () => ({
          message: 'Transaction not filled',
          statusCode: 404,
          type: 'NotFoundError'
        })
      }))
      const squidApi = new SquidAPI({ fetch: fetch as any, integratorId: 'test-integrator' })

      await expect(
        squidApi.getRouteStatus({
          txHash: '0x7d30e75ff66137d18494db9f40bb07701a667119a56fac20e5b891f947fa22d7',
          fromChainId: 4114,
          toChainId: 10,
          requestId: '1fb4fc49521869cc7dfb7e6065a05c94',
          routeId: '1fb4fc49521869cc7dfb7e6065a05c94'
        })
      ).resolves.toEqual({ status: null })
    })

    it('returns a completed status result with the receiving transaction id', async () => {
      const txnId = '0x7d30e75ff66137d18494db9f40bb07701a667119a56fac20e5b891f947fa22d7'
      const fetch = jest.fn(async () => ({
        ok: true,
        json: async () => ({
          squidTransactionStatus: 'success',
          toChain: {
            transactionUrl: `https://explorer.example/tx/${txnId}`
          }
        })
      }))
      const squidApi = new SquidAPI({ fetch: fetch as any, integratorId: 'test-integrator' })

      await expect(
        squidApi.getRouteStatus({
          txHash: '0x872bee0dc22d8edd4b476027f44e5b4fe8135584776b85f0ba685f2946a35a0d',
          fromChainId: 4114,
          toChainId: 10,
          requestId: '1fb4fc49521869cc7dfb7e6065a05c94',
          routeId: '1fb4fc49521869cc7dfb7e6065a05c94'
        })
      ).resolves.toEqual({ status: 'completed', txnId })
    })
  })
})
