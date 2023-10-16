import { Request, QueueElement } from './batcher'
import { paginate } from './pagination'
import { geckoIdMapper, geckoNetworkIdMapper } from '../../consts/coingecko'
import 'dotenv/config'

// max tokens per request; we seem to have faster results when it's lower
const BATCH_LIMIT = 40

export function geckoResponseIdentifier(tokenAddr: string, networkId: string): string {
  return geckoIdMapper(tokenAddr, networkId) || tokenAddr.toLowerCase()
}

export function geckoRequestBatcher(queue: QueueElement[]): Request[] {
  const segments: { [key: string]: any[] } = {}
  for (const queueItem of queue) {
    let segmentId: string = queueItem.data.baseCurrency
    const geckoId = geckoIdMapper(queueItem.data.address, queueItem.data.networkId)
    if (geckoId) segmentId += ':natives'
    else segmentId += `:${queueItem.data.networkId}`
    if (!segments[segmentId]) segments[segmentId] = []
    segments[segmentId].push(queueItem)
  }
  // deduplicating is OK because we use a key-based mapping (responseIdentifier) to map the responses
  // @TODO deduplication should happen BEFORE the pagination but without dropping items from queueSegment
  const pages = Object.entries(segments)
    .map(([key, queueSegment]) =>
      paginate(queueSegment, BATCH_LIMIT).map((page) => ({ key, queueSegment: page }))
    )
    .flat(1)
  const dedup = (x: any[]) => x.filter((y, i) => x.indexOf(y) === i)
  return pages.map(({ key, queueSegment }) => {
    // This is OK because we're segmented by baseCurrency
    const baseCurrency = queueSegment[0]!.data.baseCurrency
    const geckoPlatform = geckoNetworkIdMapper(queueSegment[0]!.data.networkId)

    const cgKey = process.env.COINGECKO_PRO_API_KEY
    if (cgKey) {
      console.log('COINGECKO_PRO_API_KEY ==> available')
    } else {
      console.warn('COINGECKO_PRO_API_KEY ==> not available')
    }
    const mainApiUrl = cgKey ? 'https://pro-api.coingecko.com' : 'https://api.coingecko.com'
    const apiKeyString = cgKey ? `&x_cg_pro_api_key=${cgKey}` : ''

    let url
    if (key.endsWith('natives'))
      url = `${mainApiUrl}/api/v3/simple/price?ids=${dedup(
        queueSegment.map((x) => geckoIdMapper(x.data.address, x.data.networkId))
      ).join('%2C')}&vs_currencies=${baseCurrency}${apiKeyString}`
    else
      url = `${mainApiUrl}/api/v3/simple/token_price/${geckoPlatform}?contract_addresses=${dedup(
        queueSegment.map((x) => x.data.address)
      ).join('%2C')}&vs_currencies=${baseCurrency}${apiKeyString}`
    return { url, queueSegment }
  })
}
