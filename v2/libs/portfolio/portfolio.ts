// @TODO velcro batching
import fetch from 'node-fetch'
import { JsonRpcProvider, Provider } from 'ethers'
import { Deployless, DeploylessMode } from '../deployless/deployless'
import { multiOracle } from './multiOracle.json'
import batcher from './batcher'

const LIMITS = {
	// we have to be conservative with erc721Tokens because if we pass 30x20 (worst case) tokenIds, that's 30x20 extra words which is 19kb
	// proxy mode input is limited to 24kb
	deploylessProxyMode: { erc20: 100, erc721: 30, erc721TokensInput: 20, erc721Tokens: 50 },
	// theoretical capacity is 1666/450
	deploylessStateOverrideMode: { erc20: 500, erc721: 100, erc721TokensInput: 100, erc721Tokens: 100 }
}

// @TODO: another file?
interface Price {
	baseCurrency: string,
	price: number
}
interface TokenResult {
	amount: bigint,
	decimals: number,
	symbol: string,
	address: string,
	priceIn: Price[]
}

// @TODO: can this be better/be eliminated? at worst, we'll just move it out of this file
// maps our own networkId to coingeckoPlatform
const geckoNetworkIdMapper = (x: string) => ({
	polygon: 'polygon-pos',
	arbitrum: 'arbitrum-one'
})[x] || x
// @TODO some form of a constants list
const geckoIdMapper = (address: string, networkId: string): string | null => {
	if (address === '0x0000000000000000000000000000000000000000') return ({
		polygon: 'matic-network',
		'binance-smart-chain': 'binancecoin',
		avalanche: 'avalanche-2',
		arbitrum: 'ethereum',
		metis: 'metis-token',
		optimism: 'ethereum',
		// kucoin, gnosis, kc not added
	})[networkId] || networkId
	return null
}

// @TODO cached hints, fallback

// auto-pagination
// return and cache formats
export class Portfolio {
	private batchedVelcroDiscovery: Function
	private batchedGecko: Function

	constructor (fetch: Function) {
		this.batchedVelcroDiscovery = batcher(fetch, queue => [{ queueSegment: queue, url: `https://relayer.ambire.com/velcro-v3/multi-hints?networks=${queue.map(x => x.data.networkId).join(',')}&accounts=${queue.map(x => x.data.accountAddr).join(',')}` }])
		this.batchedGecko = batcher(fetch, queue => {
			const segments: {[key: string]: any[]} = {}
			for (const queueItem of queue) {
				let segmentId: string = queueItem.data.baseCurrency
				const geckoId = geckoIdMapper(queueItem.data.address, queueItem.data.networkId)
				if (geckoId) segmentId += ':natives'
				else segmentId += `:${queueItem.data.networkId}`
				if (!segments[segmentId]) segments[segmentId] = []
				segments[segmentId].push(queueItem)
			}
			return Object.entries(segments).map(([key, queueSegment]) => {
				// This is OK because we're segmented by baseCurrency
				const baseCurrency = queueSegment[0]!.data.baseCurrency
				const geckoPlatform = geckoNetworkIdMapper(queueSegment[0]!.data.networkId)
				// @TODO: API Key
				let url
				if (key.endsWith('natives')) url = `https://api.coingecko.com/api/v3/simple/price?ids=${queueSegment.map(x => geckoIdMapper(x.data.address, x.data.networkId))}&vs_currencies=${baseCurrency}`
				else url = `https://api.coingecko.com/api/v3/simple/token_price/${geckoPlatform}?contract_addresses=${queueSegment.map(x => x.data.address).join('%2C')}&vs_currencies=${baseCurrency}`
				return { url, queueSegment }
			})
		})
	}

	// @TODO options
	async update(provider: Provider | JsonRpcProvider, networkId: string, accountAddr: string, baseCurrency: string = 'usd') {
		const hints = await this.batchedVelcroDiscovery({ networkId, accountAddr })
		// @TODO: pass binRuntime only if stateOverride is supported
		const deployless = new Deployless(provider, multiOracle.abi, multiOracle.bin, multiOracle.binRuntime)
		// @TODO block tag; segment cache by the block tag/simulation mode
		const start = Date.now()
		// Add the native token
		const requestedTokens = hints.erc20s.concat('0x0000000000000000000000000000000000000000')
		const limits = deployless.isLimitedAt24kbData ? LIMITS.deploylessProxyMode : LIMITS.deploylessStateOverrideMode
		const [ tokenBalances, collectibles ] = await Promise.all([
			flattenResults(paginate(requestedTokens, limits.erc20)
				.map(page => deployless.call('getBalances', [accountAddr, page]))),
			flattenResults(paginate(Object.entries(hints.erc721s), limits.erc721)
				.map(page => deployless.call('getAllNFTs', [
					accountAddr,
					page.map(([address]) => address),
					page.map(
						([_, x]) => x.enumerable ? [] : x.tokens.slice(0, limits.erc721TokensInput)
					),
					limits.erc721Tokens
				])))
		])
		// we do [ ... ] to get rid of the ethers Result type
		const tokensWithErr = [ ...(tokenBalances as any[]) ]
			.map((x, i) => [
				x.error,
				({ amount: x.amount, decimals: new Number(x.decimals), symbol: x.symbol, address: requestedTokens[i] }) as TokenResult
			])
		const oracleCallTime = Date.now() - start

		const tokens = tokensWithErr
			.filter(([error, result]) => result.amount > 0 && error == '0x' && result.symbol !== '')
			.map(([_, result]) => result)

		await Promise.all(tokens.map(async token => {
			const priceData = await this.batchedGecko({
				...token,
				networkId,
				baseCurrency,
				// this is what to look for in the coingecko response object
				responseIdentifier: geckoIdMapper(token.address, networkId) || token.address.toLowerCase()
			})
			token.priceIn = Object.entries(priceData || {}).map(([ baseCurrency, price ]) => ({ baseCurrency, price }))
		}))
		const priceUpdateTime = Date.now() - start - oracleCallTime

		return {
			oracleCallTime,
			priceUpdateTime,
			tokens,
			tokenErrors: tokensWithErr
				.filter(([ error, result ]) => error !== '0x' || result.symbol === '')
				.map(([error, result]) => ({ error, address: result.address })),
			collectibles: [ ...(collectibles as any[]) ]
				.filter(x => x.nfts.length)
		}
	}
}

function paginate (input: any[], limit: number): any[][] {
	let pages = []
	let from = 0
	for (let i = 1; i <= Math.ceil(input.length / limit); i++) {
		pages.push(input.slice(from, i * limit))
		from += limit
	}
	return pages
}

async function flattenResults(everything: Promise<any[]>[]): Promise<any[]> {
	return Promise.all(everything).then(results => results.flat())
}

//const url = 'http://localhost:8545'
const url = 'https://mainnet.infura.io/v3/d4319c39c4df452286d8bf6d10de28ae'
const provider = new JsonRpcProvider(url)
const portfolio = new Portfolio(fetch)
const appraise = (tokens: TokenResult[], inBase: string) => tokens.map(x => {
	const priceEntry = x.priceIn.find(y => y.baseCurrency === inBase)
	const price = priceEntry ? priceEntry.price : 0
	return Number(x.amount) / Math.pow(10, x.decimals) * price
}).reduce((a, b) => a + b, 0)

portfolio
	.update(provider, 'ethereum',
		'0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'
		)
	.then(x => console.dir({ valueInUSD: appraise(x.tokens, 'usd'), ...x }, { depth: null }))
	.catch(console.error)

portfolio
	.update(provider, 'ethereum',
		'0x8F493C12c4F5FF5Fd510549E1e28EA3dD101E850'
		)
	.then(x => console.dir({ valueInUSD: appraise(x.tokens, 'usd'), ...x }, { depth: null }))
	.catch(console.error)
