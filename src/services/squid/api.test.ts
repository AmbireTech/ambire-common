import { describe, expect, it, jest } from '@jest/globals'

import { SquidAPI } from './api'

describe('SquidAPI', () => {
  describe('getRouteStatus', () => {
    it('prefers Coralscan links for Squid intent transactions', async () => {
      const coralTransactionUrl =
        'https://v2.coralscan.squidrouter.com/tx/0x4e58f2d3615f2bc14f7cec581939ff1b4b2f1fb3d50f25af5889b5f6b550cffb'
      const fetch = jest.fn(async () => ({
        ok: true,
        json: async () => ({
          axelarTransactionUrl: '',
          coralTransactionUrl,
          squidTransactionStatus: 'success',
          toChain: {
            transactionUrl:
              'https://explorer.mainnet.citrea.xyz/tx/0x9972fff3be30020da28fd7693e94fd28f170cedaca9928a08e1be41cd4e8f90c'
          }
        })
      }))
      const squidApi = new SquidAPI({ fetch: fetch as any, integratorId: 'test-integrator' })

      await expect(
        squidApi.getRouteStatus({
          txHash: '0x4e58f2d3615f2bc14f7cec581939ff1b4b2f1fb3d50f25af5889b5f6b550cffb',
          fromChainId: 1,
          toChainId: 4114
        })
      ).resolves.toEqual({
        explorerUrl: coralTransactionUrl,
        routeStatus: 'completed'
      })
    })

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
      ).resolves.toEqual({ routeStatus: null })
    })
  })
})
