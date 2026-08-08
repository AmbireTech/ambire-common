import { QueueElement } from '../portfolio/batcher'
import { getTokenMarketDataKey, marketDataRequestBatcher } from './tokenMarketData'

const buildQueueElement = (address: string, platformId: string): QueueElement =>
  ({
    resolve: () => {},
    reject: () => {},
    fetch: (() => {}) as any,
    data: { address, platformId, responseIdentifier: address.toLowerCase() }
  }) as QueueElement

describe('getTokenMarketDataKey', () => {
  test('lowercases the address so that the casing of the source does not matter', () => {
    const checksummed = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'

    expect(getTokenMarketDataKey(1, checksummed)).toEqual(
      getTokenMarketDataKey(1, checksummed.toLowerCase())
    )
  })

  test('keys tokens with the same address on different chains separately', () => {
    const address = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'

    expect(getTokenMarketDataKey(1, address)).not.toEqual(getTokenMarketDataKey(10, address))
  })

  test('handles both number and bigint chain ids', () => {
    const address = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'

    expect(getTokenMarketDataKey(1, address)).toEqual(getTokenMarketDataKey(1n, address))
  })
})

describe('marketDataRequestBatcher', () => {
  test('returns no requests for an empty queue', () => {
    expect(marketDataRequestBatcher([])).toEqual([])
  })

  test('builds one request per platform, as the price API route is keyed by platform', () => {
    const requests = marketDataRequestBatcher([
      buildQueueElement('0xaaa', 'ethereum'),
      buildQueueElement('0xbbb', 'optimistic-ethereum'),
      buildQueueElement('0xccc', 'ethereum')
    ])

    expect(requests).toHaveLength(2)

    const ethereumRequest = requests.find((r) => r.url.includes('/ethereum?'))
    expect(ethereumRequest?.queueSegment).toHaveLength(2)
    expect(ethereumRequest?.url).toContain('contract_addresses=0xaaa%2C0xccc')
    expect(ethereumRequest?.url).toContain('vs_currencies=usd')

    const optimismRequest = requests.find((r) => r.url.includes('/optimistic-ethereum?'))
    expect(optimismRequest?.queueSegment).toHaveLength(1)
  })

  test('paginates at 40 tokens per request', () => {
    const queue = Array.from({ length: 95 }, (_, i) =>
      buildQueueElement(`0x${i.toString(16)}`, 'ethereum')
    )

    const requests = marketDataRequestBatcher(queue)

    expect(requests).toHaveLength(3)
    expect(requests[0]!.queueSegment).toHaveLength(40)
    expect(requests[1]!.queueSegment).toHaveLength(40)
    expect(requests[2]!.queueSegment).toHaveLength(15)
    // Every queued token must end up in exactly one request, otherwise its promise never settles
    expect(requests.flatMap((r) => r.queueSegment)).toHaveLength(95)
  })

  test('does not repeat the same address in the request url', () => {
    const requests = marketDataRequestBatcher([
      buildQueueElement('0xaaa', 'ethereum'),
      buildQueueElement('0xaaa', 'ethereum')
    ])

    expect(requests).toHaveLength(1)
    expect(requests[0]!.url).toContain('contract_addresses=0xaaa&')
    // Both queue elements are still resolved, only the url is deduplicated
    expect(requests[0]!.queueSegment).toHaveLength(2)
  })
})
