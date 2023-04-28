// @TODO velcro batching
import fetch from 'node-fetch'
import { JsonRpcProvider, Provider } from 'ethers'
import { Deployless, DeploylessMode } from '../deployless/deployless'
import { multiOracle } from './multiOracle.json'
import batcher from './batcher'

const LIMITS = {
	deploylessProxyMode: { erc20: 100, erc721: 50 },
	// theoretical capacity is 1666/450
	deploylessStateOverrideMode: { erc20: 500, erc721: 200 }
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
const geckoMapping = (x: string) => ({
	polygon: 'polygon-pos',
	arbitrum: 'arbitrum-one'
})[x] || x

// @TODO cached hints, fallback

// auto-pagination
// return and cache formats
export class Portfolio {
	private batchedVelcroDiscovery: Function
	private batchedGecko: Map<string, Function>

	constructor (fetch: Function) {
		this.batchedVelcroDiscovery = batcher(fetch, queue => `https://relayer.ambire.com/velcro-v3/multi-hints?networks=${queue.map(x => x.networkId).join(',')}&accounts=${queue.map(x => x.accountAddr).join(',')}`)
		this.batchedGecko = new Map()
	}

	// @TODO options
	async update(provider: Provider | JsonRpcProvider, networkId: string, accountAddr: string) {
		const hints = await this.batchedVelcroDiscovery({ networkId, accountAddr })
		// @TODO: pass binRuntime only if stateOverride is supported
		const deployless = new Deployless(provider, multiOracle.abi, multiOracle.bin, multiOracle.binRuntime)
		// @TODO: limits
		// @TODO: return format for NFTs
		// @TODO block tag; segment cache by the block tag/simulation mode
		const n = Date.now()
		// Add the native token
		const requestedTokens = hints.erc20s.concat('0x0000000000000000000000000000000000000000')
		const [ tokenBalances, collectibles ] = await Promise.all([
			deployless.call('getBalances', [accountAddr, requestedTokens]),
			deployless.call('getAllNFTs', [
				accountAddr,
				Object.keys(hints.erc721s),
				(Object.values(hints.erc721s) as any[]).map(x => x.enumerable ? [] : x.tokens),
				// @TODO get rid of this hardcode
				50
			])
		])
		// we do [ ... ] to get rid of the ethers Result type
		const tokensWithErr = [ ...(tokenBalances as any[]) ]
			.map((x, i) => [
				x.error,
				({ amount: x.amount, decimals: new Number(x.decimals), symbol: x.symbol, address: requestedTokens[i] }) as TokenResult
			])
		console.log('1: ' + (Date.now()-n))
		const tokens = tokensWithErr
			.filter(([error, result]) => result.amount > 0 && error == '0x' && result.symbol !== '')
			.map(([_, result]) => result)
		if (!this.batchedGecko.has(networkId)) {
			// @TODO: API key
			const geckoPlatform = geckoMapping(networkId)
			this.batchedGecko.set(networkId, batcher(fetch, queue => `https://api.coingecko.com/api/v3/simple/token_price/${geckoPlatform}?contract_addresses=${queue.map(x => x.address).join('%2C')}&vs_currencies=usd`))
		}

		await Promise.all(tokens.map(async token => {
			const priceData = await this.batchedGecko.get(networkId)!({ ...token, responseIdentifier: token.address.toLowerCase() })
			token.priceIn = [{ baseCurrency: 'usd', price: priceData?.usd }]
		}))

		console.log('2: ' + (Date.now()-n))
		return {
			tokens,
			tokenErrors: tokensWithErr
				.filter(([ error, result ]) => error !== '0x' || result.symbol === '')
				.map(([error, result]) => ({ error, address: result.address })),
			collectibles: [ ...(collectibles as any[]) ]
				.filter(x => x.nfts.length)
		}
	}
}

//const url = 'http://localhost:8545'
const url = 'https://mainnet.infura.io/v3/d4319c39c4df452286d8bf6d10de28ae'
const provider = new JsonRpcProvider(url)
const portfolio = new Portfolio(fetch)
portfolio
	.update(provider, 'ethereum',
		'0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'
		)
	.then(x => console.dir(x, { depth: null }))
	.catch(console.error)

portfolio
	.update(provider, 'ethereum',
		'0x8F493C12c4F5FF5Fd510549E1e28EA3dD101E850'
		)
	.then(x => console.dir(x, { depth: null }))
	.catch(console.error)
