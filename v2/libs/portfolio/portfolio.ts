import { Provider, JsonRpcProvider } from 'ethers'
import { Deployless, DeploylessMode, parseErr } from '../deployless/deployless'
import { AccountOp, callToTuple } from '../accountOp/accountOp'
import { Account, getAccountDeployParams } from '../account/account'
import { nftOracle, balanceOracle } from './multiOracle.json'
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
// 0x00..01 is the address from which simulation signatures are valid
const DEPLOYLESS_SIMULATION_FROM = '0x0000000000000000000000000000000000000001'

export interface UpdateOptionsSimulation {
	accountOps: AccountOp[],
	account: Account
}

type PriceCache = Map<string, [number, Price[]]>

export interface UpdateOptions {
	baseCurrency: string,
	blockTag: string | number,
	simulation?: UpdateOptionsSimulation,
	priceCache?: PriceCache,
	priceRecency: number
}

const defaultOptions: UpdateOptions = {
	baseCurrency: 'usd',
	blockTag: 'latest',
	priceRecency: 0
}

export class Portfolio {
	private batchedVelcroDiscovery: Function
	private batchedGecko: Function

	constructor (fetch: Function) {
		this.batchedVelcroDiscovery = batcher(fetch, queue => {
			const baseCurrencies = [ ...new Set(queue.map(x => x.data.baseCurrency)) ]
			return baseCurrencies.map(baseCurrency => {
				const queueSegment = queue.filter(x => x.data.baseCurrency === baseCurrency)
				const url = `https://relayer.ambire.com/velcro-v3/multi-hints?networks=${queueSegment.map(x => x.data.networkId).join(',')}&accounts=${queueSegment.map(x => x.data.accountAddr).join(',')}&baseCurrency=${baseCurrency}`
				return { queueSegment, url }
			})
		})
		this.batchedGecko = batcher(fetch, geckoRequestBatcher) 
	}

	async update(provider: Provider | JsonRpcProvider, networkId: string, accountAddr: string, opts: Partial<UpdateOptions> = {}) {
		opts = { ...defaultOptions, ...opts }
		const { baseCurrency } = opts
		if (opts.simulation && opts.simulation.account.addr !== accountAddr) throw new Error('wrong account passed')

		// Get hints (addresses to check on-chain) via Velcro
		const start = Date.now()
		const hints = await this.batchedVelcroDiscovery({ networkId, accountAddr, baseCurrency })
		// This also allows getting prices, this is used for more exotic tokens that cannot be retrieved via Coingecko
		const priceCache: PriceCache = opts.priceCache || new Map()
		for (const addr in (hints.prices || {})) {
			const priceHint = hints.prices[addr]
			// @TODO consider validating the external response here, before doing the .set; or validating the whole velcro response
			priceCache.set(addr, [start, Array.isArray(priceHint) ? priceHint : [priceHint]])
		}
		const discoveryDone = Date.now()

		// @TODO: pass binRuntime only if stateOverride is supported
		const deploylessTokens = new Deployless(provider, balanceOracle.abi, balanceOracle.bin, balanceOracle.binRuntime)
		const deploylessNfts = new Deployless(provider, nftOracle.abi, nftOracle.bin, nftOracle.binRuntime)
		const deploylessOpts = { blockTag: opts.blockTag, from: DEPLOYLESS_SIMULATION_FROM }
		// .isLimitedAt24kbData should be the same for both instances; @TODO more elegant check?
		const limits = deploylessTokens.isLimitedAt24kbData ? LIMITS.deploylessProxyMode : LIMITS.deploylessStateOverrideMode
		const collectionsHints = Object.entries(hints.erc721s)
		// Get balances and metadata from the provider directly
		const [ tokensWithErr, collectionsRaw ] = await Promise.all([
			flattenResults(paginate(hints.erc20s, limits.erc20)
				.map(page => getTokens(deploylessTokens, opts, accountAddr, page))),
			flattenResults(paginate(collectionsHints, limits.erc721)
				.map(async page => (await deploylessNfts.call('getAllNFTs', [
					accountAddr,
					page.map(([address]) => address),
					page.map(
						([_, x]) => x.enumerable ? [] : x.tokens.slice(0, limits.erc721TokensInput)
					),
					limits.erc721Tokens
				], deploylessOpts))[0]))
		])
		// Re-map/filter into our format
		const getPriceFromCache = (address: string) => {
			const cached = priceCache.get(address)
			if (!cached) return null
			const [ timestamp, entry ] = cached
			const eligible = entry.filter(x => x.baseCurrency === baseCurrency)
			// by using `start` instead of `Date.now()`, we make sure that prices updated from Velcro will not be updated again
			// even if priceRecency is 0
			if ((start - timestamp) <= opts.priceRecency! && eligible.length) return eligible
			return null
		}
		const collections = [ ...(collectionsRaw as any[]) ]
			.map((x, i) => {
				const address = collectionsHints[i][0] as unknown as string
				return {
					address: address,
					name: x[0],
					symbol: x[1],
					amount: BigInt(x[2].length),
					decimals: 1,
					priceIn: getPriceFromCache(address) || [],
					collectables: [ ...(x[2] as any[]) ].map((x: any) => ({ id: x[0], url: x[1] } as Collectable))
				} as TokenResult
			})
		const tokens = tokensWithErr
			.filter(([error, result]) => result.amount > 0 && error == '0x' && result.symbol !== '')
			.map(([_, result]) => result)
		const oracleCallDone = Date.now()

		// Update prices
		await Promise.all(tokens.map(async token => {
			const cachedPriceIn = getPriceFromCache(token.address)
			if (cachedPriceIn) {
				token.priceIn = cachedPriceIn
				return
			}
			const priceData = await this.batchedGecko({
				...token,
				networkId,
				baseCurrency,
				// this is what to look for in the coingecko response object
				responseIdentifier: geckoResponseIdentifier(token.address, networkId)
			})
			const priceIn: Price[] = Object.entries(priceData || {})
				.map(([ baseCurrency, price ]) => ({ baseCurrency, price: price as number }))
			if (priceIn.length) priceCache.set(token.address, [Date.now(), priceIn])
			token.priceIn = priceIn
		}))
		const priceUpdateDone = Date.now()

		return {
			updateStarted: start,
			discoveryTime: discoveryDone - start,
			oracleCallTime: oracleCallDone - discoveryDone,
			priceUpdateTime: priceUpdateDone - oracleCallDone,
			priceCache,
			tokens,
			tokenErrors: tokensWithErr
				.filter(([ error, result ]) => error !== '0x' || result.symbol === '')
				.map(([error, result]) => ({ error, address: result.address })),
			collections: collections.filter(x => x.collectables?.length),
			total: tokens.reduce((cur, token) => {
				for (const x of token.priceIn) {
					cur[x.baseCurrency] = (cur[x.baseCurrency] || 0) + Number(token.amount) / (10 ** token.decimals) * x.price
				}
				return cur
			}, {})
		}
	}
}


async function getTokens (deployless: Deployless, opts: Partial<UpdateOptions>, accountAddr: string, tokenAddrs: string[]): Promise<[number, TokenResult][]> {
	const deploylessOpts = { blockTag: opts.blockTag, from: DEPLOYLESS_SIMULATION_FROM }
	if (!opts.simulation) {
		const [ results ] = await deployless.call('getBalances', [accountAddr, tokenAddrs], deploylessOpts)
		// we do [ ... ] to get rid of the ethers Result type
		return [ ...(results as any[]) ]
			.map((x, i) => [
				x.error,
				({ amount: x.amount, decimals: new Number(x.decimals), symbol: x.symbol, address: tokenAddrs[i] }) as TokenResult
			])

	}
	const { accountOps, account } = opts.simulation
	const [factory, factoryCalldata] = getAccountDeployParams(account)
	const [before, after, simulationErr] = await deployless.call('simulateAndGetBalances', [
		accountAddr, tokenAddrs,
		factory, factoryCalldata,
		accountOps.map(({ nonce, calls, signature }) => [nonce, calls.map(callToTuple), signature])
	], deploylessOpts)
	
	if (simulationErr !== '0x') throw new SimulationError(parseErr(simulationErr) || simulationErr, before[1], after[1])
	if (after[1] === 0n) throw new SimulationError('unknown error: simulation reverted', before[1], after[1])
	if (after[1] < before[1]) throw new SimulationError('lower "after" nonce', before[1], after[1])
	// no simulation was performed if the nonce is the same
	const results = (after[1] === before[1]) ? before[0] : after[0]
	return [ ...results ]
		.map((x, i) => [
			x.error,
			({
				amount: before[0][i].amount,
				amountPostSimulation: x.amount,
				decimals: new Number(x.decimals),
				symbol: x.symbol, address: tokenAddrs[i]
			}) as TokenResult
		])
}

class SimulationError extends Error {
	public simulationErrorMsg: string
	public beforeNonce: bigint
	public afterNonce: bigint
	constructor (message: string, beforeNonce: bigint, afterNonce: bigint) {
		super(`simulation error: ${message}`)
		this.simulationErrorMsg = message
		this.beforeNonce = beforeNonce
		this.afterNonce = afterNonce
	}
}
