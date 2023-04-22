// @TODO velcro batching
import fetch from 'node-fetch'
import { JsonRpcProvider, Provider } from 'ethers'
import { Deployless, DeploylessMode } from '../deployless/deployless'
import { multiOracle } from './multiOracle.json'
import batchedVelcro from './batchedVelcro'

const LIMITS = {
	deploylessProxyMode: { erc20: 100, erc721: 50 },
	// theoretical capacity is 1666/450
	deploylessStateOverrideMode: { erc20: 500, erc721: 200 }
}

// @TODO: another file?
interface TokenResult {
	amount: bigint,
	decimals: number,
	symbol: string
}

// @TODO cached hints, fallback

// auto-pagination
// return and cache formats
export class Portfolio {
	// @TODO options
	async update(provider: Provider | JsonRpcProvider, networkId: string, accountAddr: string) {
		const hints = await batchedVelcro(fetch, 'https://relayer.ambire.com', networkId, accountAddr)
		// @TODO: pass binRuntime only if stateOverride is supported
		const deployless = new Deployless(provider, multiOracle.abi, multiOracle.bin, multiOracle.binRuntime)
		// @TODO: limits
		// @TODO: return format
		// @TODO block tag
		const n = Date.now()
		const [ erc20s, erc721s ] = await Promise.all([
			deployless.call('getBalances', [accountAddr, hints.erc20s.concat('0x0000000000000000000000000000000000000000')]),
			deployless.call('getAllNFTs', [
				accountAddr,
				Object.keys(hints.erc721s),
				(Object.values(hints.erc721s) as any[]).map(x => x.enumerable ? [] : x.tokens),
				// @TODO get rid of this hardcode
				50
			])
		])
		console.log(Date.now()-n)
		return {
			erc20s: (erc20s as any[])
				// @TODO: error handling; fourth item is an error for erc20s
				.filter(x => x.amount > 0 && x.error === '0x')
				.map(x => ({ amount: x.amount, decimals: new Number(x.decimals), symbol: x.symbol }) as TokenResult),
			erc721s: (erc721s as any[])
				.filter(x => x.nfts.length)
		}
	}
}

//const url = 'http://localhost:8545'
const url = 'https://mainnet.infura.io/v3/d4319c39c4df452286d8bf6d10de28ae'
const provider = new JsonRpcProvider(url)
new Portfolio()
	.update(provider, 'ethereum',
		'0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'
		)
	.then(console.log)

new Portfolio()
	.update(provider, 'ethereum',
		'0x8F493C12c4F5FF5Fd510549E1e28EA3dD101E850'
		)
	.then(console.log)
