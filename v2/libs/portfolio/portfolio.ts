// @TODO velcro batching
import fetch from 'node-fetch'
import { JsonRpcBatchProvider, JsonRpcProvider, BaseProvider } from '@ethersproject/providers'
import { Deployless, DeploylessMode } from '../deployless/deployless'
import { multiOracle } from './multiOracle.json'
type Provider = BaseProvider | JsonRpcBatchProvider | JsonRpcProvider

export class Portfolio {
	async update(provider: Provider, networkId: string, accountAddr: string) {
		const hintsBody = await fetch(`https://relayer.ambire.com/velcro-v3/${networkId}/${accountAddr}/hints`)
		const hints = await hintsBody.json()
		// @TODO: pass binRuntime only if stateOverride is supported
		const deployless = new Deployless(provider, multiOracle.abi, multiOracle.bin, multiOracle.binRuntime)
		// @TODO: limits
		// @TODO: return format
		// @TODO block tag
		const n = Date.now()
		const [ erc20s, erc721s ] = await Promise.all([
			deployless.call('getBalances', [accountAddr, hints.erc20s]),
			deployless.call('getAllNFTs', [
				accountAddr,
				Object.keys(hints.erc721s),
				(Object.values(hints.erc721s) as any[]).map(x => x.enumerable ? [] : x.tokens),
				50
			])
		])
		console.log(Date.now()-n)
		return (erc20s as any[]).filter(x => x.amount > 0).concat((erc721s as any[]).filter(x => x.nfts.length))
	}
}

// Monkey-patch BigInt to make it serializable
// @ts-ignore: Unreachable code error
BigInt.prototype.toJSON = function() { return this.toString() }

//const url = 'http://localhost:8545'
const url = 'https://mainnet.infura.io/v3/d4319c39c4df452286d8bf6d10de28ae'
const provider = new JsonRpcBatchProvider(url)
new Portfolio()
	.update(provider, 'ethereum',
		'0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'
		//'0x8F493C12c4F5FF5Fd510549E1e28EA3dD101E850'
		)
	.then(x => console.log(JSON.stringify(x, null, 4)))
