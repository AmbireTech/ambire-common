import { Interface, toBigInt, hexlify } from 'ethers'
import fetch from 'node-fetch'
import { readFile, exists } from 'fs'
import { promisify } from 'util'
const _readFile = promisify(readFile)
const _exists = promisify(exists)

const iface = new Interface(['function execute(bytes,bytes[],uint256)'])

async function fetchJson (url: string, body: object, args: object = {}) {
	const headers = { 'Content-Type': 'application/json' }
	const res = await fetch(url, { method: 'POST', body: JSON.stringify(body), headers, ...args })
	return res.json()
}

async function fetchRpc(url: string, method: string, params: any[] = []) {
	// @TODO: fix any?
	const response: any = await fetchJson(url, { method, params, id: 1, jsonrpc: '2.0' })
	// @TODO is this the right way to handle errors; this should be ok?
	if (response.error) throw response.error
	return response.result
}

// @TODO dynamic URL
const url = 'https://invictus.ambire.com/ethereum'
async function scrapeSignatures () {
	const mostFrequent = new Map()
	const latestBlock = toBigInt(await fetchRpc(url, 'eth_blockNumber'))
	for (let i = latestBlock - 1000n; i <= latestBlock; i++) {
		const block = await fetchRpc(url,'eth_getBlockByNumber', ['0x'+i.toString(16), true])
		for (const txn of block.transactions) { 
			if (txn.input.length >= 10) {
				const sig = txn.input.slice(2, 10)
				mostFrequent.set(sig, (mostFrequent.get(sig) ?? 0) + 1)
			}
		}
	}
	const sorted = [...mostFrequent.entries()].sort((a,b) => b[1] - a[1])
	const signatures = await Promise.all(sorted.slice(0, 2500).map(async ([sigHash, hits]) => {
		const path = `/home/ivo/storage/repos/4bytes/signatures/${sigHash}`
		const exists = await _exists(path)
		const sig = exists ? (await _readFile(path)).toString() : null
		return sig && [sig, sigHash, hits]
	}))
  const signaturesFiltered = signatures.filter(x => x)

	console.log(JSON.stringify(signaturesFiltered))
}

/*
scrapeSignatures()
	.catch((e: any) => console.error(e))

*/

console.log(iface.parseTransaction({
  data: '0x3593564c000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000066229ac300000000000000000000000000000000000000000000000000000000000000040b000604000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000280000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000de0b6b3a7640000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000de0b6b3a7640000000000000000000000000000000000000000000000001906999cbae477f0296c00000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002bc02aaa39b223fe8d0a0e5c4f27ead9083c756cc200271088800092ff476844f74dc2fc427974bbee2794ae000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000088800092ff476844f74dc2fc427974bbee2794ae00000000000000000000000037a8f295612602f2774d331e562be9e61b83a3270000000000000000000000000000000000000000000000000000000000000019000000000000000000000000000000000000000000000000000000000000006000000000000000000000000088800092ff476844f74dc2fc427974bbee2794ae0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000001906999cbae477f0296c',
  value: 1000000000000000000n
}))

// @TODO: import from common
// @TODO call the entire module parser
type NetworkId = string

interface TokenInParsedCall {
	// nothing other than an address and network, retrieving meta is the responsibility of the token component + service
	address: string,
	networkId: NetworkId,
	role?: string,
}

interface InteracteeInParsedCall {
	address: string,
	role?: string
}

// Designed to be used as an intersection type with Call
// like this: `ParsedCall & Call`
// see https://www.typescriptlang.org/docs/handbook/unions-and-intersections.html#intersection-types
interface ParsedCall {
	actionName: string,
	interactedWith: InteracteeInParsedCall[],
	tokens: TokenInParsedCall[]
}

// @TODO: ParsedMessage??