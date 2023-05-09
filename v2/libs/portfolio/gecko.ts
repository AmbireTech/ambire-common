import { Request, QueueElement } from './batcher'
import { paginate } from './pagination'

// max tokens per request; we seem to have faster results when it's lower
const BATCH_LIMIT = 40

// @TODO: can this be better/be eliminated? at worst, we'll just move it out of this file
// maps our own networkId to coingeckoPlatform
export function geckoNetworkIdMapper (x: string): string {
	return ({
		polygon: 'polygon-pos',
		arbitrum: 'arbitrum-one'
	})[x] || x
}

// @TODO some form of a constants list
export function geckoIdMapper (address: string, networkId: string): string | null {
	if (address === '0x0000000000000000000000000000000000000000') return ({
		polygon: 'matic-network',
		'binance-smart-chain': 'binancecoin',
		avalanche: 'avalanche-2',
		arbitrum: 'ethereum',
		metis: 'metis-token',
		optimism: 'ethereum',
		// kucoin, gnosis, kc not added
	})[networkId] || networkId
	if (address === '0x4da27a545c0c5B758a6BA100e3a049001de870f5') return 'aave'
	return null
}

export function geckoResponseIdentifier (tokenAddr: string, networkId: string): string {
	return geckoIdMapper(tokenAddr, networkId) || tokenAddr.toLowerCase()
}

export function geckoRequestBatcher (queue: QueueElement[]): Request[] {
	const segments: {[key: string]: any[]} = {}
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
	const pages = Object.entries(segments).map(([key, queueSegment]) =>
		paginate(queueSegment, BATCH_LIMIT).map(page => ({ key, queueSegment: page }))
	).flat(1)
	const dedup = (x: any[]) => x.filter((y, i) => x.indexOf(y) === i)
	return pages.map(({ key, queueSegment }) => {
		// This is OK because we're segmented by baseCurrency
		const baseCurrency = queueSegment[0]!.data.baseCurrency
		const geckoPlatform = geckoNetworkIdMapper(queueSegment[0]!.data.networkId)
		// @TODO: API Key
		let url
		if (key.endsWith('natives')) url = `https://api.coingecko.com/api/v3/simple/price?ids=${dedup(queueSegment.map(x => geckoIdMapper(x.data.address, x.data.networkId))).join('%2C')}&vs_currencies=${baseCurrency}`
		else url = `https://api.coingecko.com/api/v3/simple/token_price/${geckoPlatform}?contract_addresses=${dedup(queueSegment.map(x => x.data.address)).join('%2C')}&vs_currencies=${baseCurrency}`
		return { url, queueSegment }
	})
}
