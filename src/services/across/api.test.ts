import { describe, expect, it, jest } from '@jest/globals'

import { AcrossAPI } from './api'

const makeResponse = (body: any, ok = true, status = ok ? 200 : 400) => ({
  ok,
  status,
  json: async () => body
})

const txHash = '0x1111111111111111111111111111111111111111111111111111111111111111'
const fillTxnRef = '0x2222222222222222222222222222222222222222222222222222222222222222'
const depositRefundTxnRef = '0x3333333333333333333333333333333333333333333333333333333333333333'

describe('AcrossAPI', () => {
  it('returns the fill transaction id for completed bridges', async () => {
    const fetch = jest.fn(async () => makeResponse({ status: 'filled', fillTxnRef }))
    const acrossApi = new AcrossAPI({ fetch: fetch as any })

    await expect(acrossApi.getRouteStatus({ txHash })).resolves.toEqual({
      status: 'completed',
      txnId: fillTxnRef
    })
    expect(fetch).toHaveBeenCalledWith(
      `https://app.across.to/api/deposit/status?depositTxnRef=${txHash}`
    )
  })

  it('returns the refund transaction id for refunded bridges', async () => {
    const fetch = jest.fn(async () => makeResponse({ status: 'refunded', depositRefundTxnRef }))
    const acrossApi = new AcrossAPI({ fetch: fetch as any })

    await expect(acrossApi.getRouteStatus({ txHash })).resolves.toEqual({
      status: 'refunded',
      txnId: depositRefundTxnRef
    })
  })

  it('keeps polling expired bridges until the refund transaction is available', async () => {
    const fetch = jest.fn(async () => makeResponse({ status: 'expired' }))
    const acrossApi = new AcrossAPI({ fetch: fetch as any })

    await expect(acrossApi.getRouteStatus({ txHash })).resolves.toEqual({ status: null })
  })

  it('keeps polling while Across indexes the deposit', async () => {
    const fetch = jest.fn(async () =>
      makeResponse(
        {
          error: 'DepositNotFoundException',
          message: 'Deposit not found given the provided constraints'
        },
        false,
        404
      )
    )
    const acrossApi = new AcrossAPI({ fetch: fetch as any })

    await expect(acrossApi.getRouteStatus({ txHash })).resolves.toEqual({ status: null })
  })
})
