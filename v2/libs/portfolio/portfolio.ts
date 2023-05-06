// @TODO velcro batching
import fetch from 'node-fetch'
import { JsonRpcProvider, Provider } from 'ethers'
import { Deployless, DeploylessMode } from '../deployless/deployless'
import { multiOracle } from './multiOracle.json'
import batcher from './batcher'
import { geckoRequestBatcher, geckoResponseIdentifier } from './gecko'
import { flattenResults, paginate } from './pagination'
import { AccountOp } from '../accountOp/accountOp'

const LIMITS = {
	// we have to be conservative with erc721Tokens because if we pass 30x20 (worst case) tokenIds, that's 30x20 extra words which is 19kb
	// proxy mode input is limited to 24kb
	deploylessProxyMode: { erc20: 100, erc721: 30, erc721TokensInput: 20, erc721Tokens: 50 },
	// theoretical capacity is 1666/450
	deploylessStateOverrideMode: { erc20: 500, erc721: 100, erc721TokensInput: 100, erc721Tokens: 100 }
}

export interface Price {
	baseCurrency: string,
	price: number
}

export interface TokenResult {
	address: string,
	symbol: string,
	amount: bigint,
	amountPostSimulation?: bigint,
	decimals: number,
	priceIn: Price[],
	// only applicable for NFTs
	name?: string,
	// tokens?:
}

export interface UpdateOptions {
	baseCurrency: string,
	blockTag: string | number,
}
const defaultOptions: UpdateOptions = {
	baseCurrency: 'usd',
	blockTag: 'latest'
}

// auto-pagination
// return and cache formats
export class Portfolio {
	private batchedVelcroDiscovery: Function
	private batchedGecko: Function

	constructor (fetch: Function) {
		this.batchedVelcroDiscovery = batcher(fetch, queue => [{ queueSegment: queue, url: `https://relayer.ambire.com/velcro-v3/multi-hints?networks=${queue.map(x => x.data.networkId).join(',')}&accounts=${queue.map(x => x.data.accountAddr).join(',')}` }])
		this.batchedGecko = batcher(fetch, geckoRequestBatcher) 
	}

	async update(provider: Provider | JsonRpcProvider, networkId: string, accountAddr: string, opts: Partial<UpdateOptions> = {}) {
		opts = { ...defaultOptions, ...opts }
		const { blockTag, baseCurrency } = opts

		const start = Date.now()
		const hints = await this.batchedVelcroDiscovery({ networkId, accountAddr })
		const discoveryDone = Date.now()
		// @TODO: pass binRuntime only if stateOverride is supported
		const deployless = new Deployless(provider, multiOracle.abi, multiOracle.bin, multiOracle.binRuntime)
		// @TODO block tag; segment cache by the block tag/simulation mode
		// Add the native token
		const requestedTokens = hints.erc20s.concat('0x0000000000000000000000000000000000000000')
		const limits = deployless.isLimitedAt24kbData ? LIMITS.deploylessProxyMode : LIMITS.deploylessStateOverrideMode
		const deploylessOpts = { blockTag }
		const [ tokenBalances, collectibles ] = await Promise.all([
			flattenResults(paginate(requestedTokens, limits.erc20)
				.map(page => deployless.call('getBalances', [accountAddr, page], deploylessOpts))),
			flattenResults(paginate(Object.entries(hints.erc721s), limits.erc721)
				.map(page => deployless.call('getAllNFTs', [
					accountAddr,
					page.map(([address]) => address),
					page.map(
						([_, x]) => x.enumerable ? [] : x.tokens.slice(0, limits.erc721TokensInput)
					),
					limits.erc721Tokens
				], deploylessOpts)))
		])
		// we do [ ... ] to get rid of the ethers Result type
		const tokensWithErr = [ ...(tokenBalances as any[]) ]
			.map((x, i) => [
				x.error,
				({ amount: x.amount, decimals: new Number(x.decimals), symbol: x.symbol, address: requestedTokens[i] }) as TokenResult
			])
		const oracleCallDone = Date.now()

		const tokens = tokensWithErr
			.filter(([error, result]) => result.amount > 0 && error == '0x' && result.symbol !== '')
			.map(([_, result]) => result)

		await Promise.all(tokens.map(async token => {
			const priceData = await this.batchedGecko({
				...token,
				networkId,
				baseCurrency,
				// this is what to look for in the coingecko response object
				responseIdentifier: geckoResponseIdentifier(token.address, networkId)
			})
			token.priceIn = Object.entries(priceData || {}).map(([ baseCurrency, price ]) => ({ baseCurrency, price }))
		}))
		const priceUpdateDone = Date.now()

		return {
			discoveryTime: discoveryDone - start,
			oracleCallTime: oracleCallDone - discoveryDone,
			priceUpdateTime: priceUpdateDone - oracleCallDone,
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
