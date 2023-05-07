// @TODO velcro batching
import fetch from 'node-fetch'
import { JsonRpcProvider, Provider } from 'ethers'
import { Deployless, DeploylessMode } from '../deployless/deployless'
import { AccountOp } from '../accountOp/accountOp'
import { multiOracle } from './multiOracle.json'
import batcher from './batcher'
import { geckoRequestBatcher, geckoResponseIdentifier } from './gecko'
import { flattenResults, paginate } from './pagination'
import { TokenResult, Collectable, Price } from './interfaces'

const LIMITS = {
	// we have to be conservative with erc721Tokens because if we pass 30x20 (worst case) tokenIds, that's 30x20 extra words which is 19kb
	// proxy mode input is limited to 24kb
	deploylessProxyMode: { erc20: 100, erc721: 30, erc721TokensInput: 20, erc721Tokens: 50 },
	// theoretical capacity is 1666/450
	deploylessStateOverrideMode: { erc20: 500, erc721: 100, erc721TokensInput: 100, erc721Tokens: 100 }
}

export interface UpdateOptionsSimulation {
	accountOps: AccountOp[],
	// @TODO account
	// account: Account
}

export interface UpdateOptions {
	baseCurrency: string,
	blockTag: string | number,
	simulation?: UpdateOptionsSimulation,
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

		// @TODO: check account addr consistency
		//if (opts.simulation && opts.simulation.account.id !== accountAddr) throw new Error('wrong account passed')

		const start = Date.now()
		const hints = await this.batchedVelcroDiscovery({ networkId, accountAddr })
		const discoveryDone = Date.now()
		// @TODO: pass binRuntime only if stateOverride is supported
		const deployless = new Deployless(provider, multiOracle.abi, multiOracle.bin, multiOracle.binRuntime)
		// 0x00..01 is the address from which simulation signatures are valid
		const deploylessOpts = { blockTag, from: '0x0000000000000000000000000000000000000001' }
		// Add the native token
		const requestedTokens = hints.erc20s.concat('0x0000000000000000000000000000000000000000')
		const limits = deployless.isLimitedAt24kbData ? LIMITS.deploylessProxyMode : LIMITS.deploylessStateOverrideMode
		const collectionsHints = Object.entries(hints.erc721s)
		const getBalances = (page: string[]) => opts.simulation ?
			deployless.call('simulateAndGetBalances', [
				accountAddr, page,
				// @TODO factory, factoryCalldata
				'0x0000000000000000000000000000000000000000', '0x00',
				// @TODO beautify
				opts.simulation.accountOps.map(({ nonce, calls, signature }) => [nonce, calls.map(x => [x.to, x.value, x.data]), signature])
			], deploylessOpts).then(results => {
				const [before, after, simulationErr] = results
				// @TODO parse simulation error
				console.log(before, after, simulationErr)
				if (simulationErr !== '0x') throw new Error(`simulation error: ${simulationErr}`)
				if (after[1] === 0n) throw new Error(`simulation error: unknown error`)
				if (after[1] < before[1]) throw new Error(`simulation error: internal: lower after nonce`)
				// no simulation was performed
				if (after[1] === before[1]) return before[0]
				return after[0]
			})
			// @TODO this .then is ugly
			: deployless.call('getBalances', [accountAddr, page], deploylessOpts).then(x => x[0])
		const [ tokenBalances, collectionsRaw ] = await Promise.all([
			flattenResults(paginate(requestedTokens, limits.erc20)
				.map(getBalances)),
			flattenResults(paginate(collectionsHints, limits.erc721)
				.map(page => deployless.call('getAllNFTs', [
					accountAddr,
					page.map(([address]) => address),
					page.map(
						([_, x]) => x.enumerable ? [] : x.tokens.slice(0, limits.erc721TokensInput)
					),
					limits.erc721Tokens
					// @TODO this .then is ugly
				], deploylessOpts).then(x => x[0])))
		])
		// we do [ ... ] to get rid of the ethers Result type
		const tokensWithErr = [ ...(tokenBalances as any[]) ]
			.map((x, i) => [
				x.error,
				({ amount: x.amount, decimals: new Number(x.decimals), symbol: x.symbol, address: requestedTokens[i] }) as TokenResult
			])
		const collections = [ ...(collectionsRaw as any[]) ]
			.map((x, i) => ({
				address: collectionsHints[i][0] as unknown as string,
				name: x[0],
				symbol: x[1],
				amount: BigInt(x[2].length),
				decimals: 1,
				// @TODO: floor price
				priceIn: [],
				collectables: [ ...(x[2] as any[]) ].map((x: any) => ({ id: x[0], url: x[1] } as Collectable))
			} as TokenResult))
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
			collections: collections.filter(x => x.collectables?.length)
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

// @TODO batching test
/*portfolio
	.update(provider, 'ethereum', '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8')
	.then(x => console.dir({ valueInUSD: appraise(x.tokens, 'usd'), ...x }, { depth: null }))
	.catch(console.error)
portfolio
	.update(provider, 'ethereum', '0x8F493C12c4F5FF5Fd510549E1e28EA3dD101E850')
	.then(x => console.dir({ valueInUSD: appraise(x.tokens, 'usd'), ...x }, { depth: null }))
	.catch(console.error)
*/

const accountOp = {
	accountAddr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
	signingKeyAddr: '0xe5a4Dad2Ea987215460379Ab285DF87136E83BEA',
	gasLimit: null,
	gasFeePayment: null,
	network: { chainId: 0, name: 'ethereum' },
	nonce: 6,
	signature: '0x000000000000000000000000e5a4Dad2Ea987215460379Ab285DF87136E83BEA03',
	calls: [{ to: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', value: BigInt(0), data: '0xa9059cbb000000000000000000000000e5a4dad2ea987215460379ab285df87136e83bea00000000000000000000000000000000000000000000000000000000005040aa' }]
}
portfolio
	.update(provider, 'ethereum', '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8', { simulation: { accountOps: [accountOp]  } })
	.then(x => console.dir({ valueInUSD: appraise(x.tokens, 'usd'), ...x }, { depth: null }))
	.catch(console.error)
