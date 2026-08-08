import { QueueElement, Request } from '../portfolio/batcher'
import { paginate } from '../portfolio/pagination'

// Max tokens per request, mirroring the portfolio's gecko batcher
const BATCH_LIMIT = 40

const CENA_API_URL = 'https://cena.ambire.com'

/**
 * The key under which the market data of a token is exposed to the UI. Addresses are
 * lowercased, because the casing coming from the service provider token lists and the
 * casing coming from the cena response are not guaranteed to match.
 */
export function getTokenMarketDataKey(chainId: number | bigint, address: string): string {
  return `${chainId.toString()}:${address.toLowerCase()}`
}

/**
 * Splits the queued tokens into one request per CoinGecko platform (and per page
 * of BATCH_LIMIT tokens within it), because the cena token price route is keyed
 * by platform. Tokens on chains without a platform id must never reach the queue,
 * as the batcher leaves the promises of queue elements dropped here unresolved.
 */
export function marketDataRequestBatcher(queue: QueueElement[]): Request[] {
  const segments: { [platformId: string]: QueueElement[] } = {}

  queue.forEach((queueItem) => {
    const { platformId } = queueItem.data

    if (!segments[platformId]) segments[platformId] = []
    segments[platformId]!.push(queueItem)
  })

  return Object.entries(segments)
    .map(([platformId, queueSegment]) =>
      paginate(queueSegment, BATCH_LIMIT).map((page) => ({ platformId, queueSegment: page }))
    )
    .flat(1)
    .map(({ platformId, queueSegment }) => {
      const addresses = [...new Set<string>(queueSegment.map((x) => x.data.address))]
      const url = `${CENA_API_URL}/api/v3/simple/token_price/${platformId}?contract_addresses=${addresses.join(
        '%2C'
      )}&vs_currencies=usd`

      return { url, queueSegment }
    })
}
